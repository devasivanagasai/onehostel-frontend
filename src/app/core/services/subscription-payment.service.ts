import { Injectable, inject } from '@angular/core';
import { AppFormatService } from './app-format.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { SystemSettingsService } from './system-settings.service';
import {
  HostelSubscription,
  LateFeePolicy,
  MOCK_PAYMENTS,
  MOCK_SUBSCRIPTIONS,
  PaymentGateway,
  PaymentMethod,
  PaymentTransaction,
  TaxBreakdown,
  TaxPolicy,
  applyTax,
  daysLateBetween,
  isOpenSubscription,
  lateFeeFor,
  paymentDueDate,
  renewSubscription,
} from '../models/subscription-payment.models';

/** What paying today would cost: the billed amount plus any late fee. */
export interface AmountDue extends TaxBreakdown {
  /** yyyy-mm-dd the payment was due. */
  dueDate: string;
  /** Days past the due date today (0 = on time). */
  daysLate: number;
  /** Late fee per Settings → Fees (0 when on time, within the grace period, or disabled). */
  lateFee: number;
  /** totalAmount + lateFee. */
  payable: number;
}

export interface RecordPaymentInput {
  paymentMethod: PaymentMethod;
  paymentGateway: PaymentGateway;
}

/** Today as yyyy-mm-dd in local time. */
const todayIso = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * Single source of truth for subscriptions and payments on the Subscription &
 * Payment screen. Recording a payment updates both lists, so the table, stat
 * tiles and the detail panel's Payment History all refresh immediately.
 *
 * Follows the subscription lifecycle rule (see HostelSubscription): payments
 * never create a new subscription ID — they settle the pending payment or renew
 * the same subscription.
 *
 * There is no manual "Record Payment" action in the Admin UI — payments are
 * made by the hostel. `recordPayment` is the single entry point for a completed
 * payment (e.g. the payment-gateway callback / webhook once the backend exists);
 * calling it updates Payment History, both tables and the totals at once.
 * UI-only build: data is kept in memory.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionPaymentService {
  /** Currency, date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  private readonly subscriptionsSubject = new BehaviorSubject<HostelSubscription[]>([...MOCK_SUBSCRIPTIONS]);
  private readonly paymentsSubject = new BehaviorSubject<PaymentTransaction[]>([...MOCK_PAYMENTS]);

  readonly subscriptions$ = this.subscriptionsSubject.asObservable();
  readonly payments$ = this.paymentsSubject.asObservable();

  constructor(
    private auditLog: AuditLogService,
    private snackBar: MatSnackBar,
    private settings: SystemSettingsService,
  ) {}

  /** GST rule currently configured in Settings → Fees; applied to NEW payments only. */
  get taxPolicy(): TaxPolicy {
    const p = this.settings.settings.fees;
    return { gstEnabled: p.gstEnabled, gstRate: p.gstRate, pricesIncludeTax: p.pricesIncludeTax, gstin: p.gstin };
  }

  /** Late-fee rule currently configured in Settings → Fees; applied when a payment is recorded. */
  get lateFeePolicy(): LateFeePolicy {
    const f = this.settings.settings.fees;
    return {
      enabled: f.lateFeeEnabled,
      type: f.lateFeeType,
      value: Number(f.lateFeeValue) || 0,
      graceDays: Number(f.lateFeeGraceDays) || 0,
    };
  }

  /**
   * What paying this subscription today would cost (null when nothing can be paid):
   * the pending bill (tax as billed) or the next renewal (tax per current Settings),
   * plus the late fee once the due date + grace period has passed. The fee is a
   * fixed amount or a % of the amount due including GST, and is not itself taxed —
   * the same calculation as the Settings → Fees preview.
   */
  amountDueNow(sub: HostelSubscription, on = todayIso()): AmountDue | null {
    if (this.paymentBlockedReason(sub)) return null;
    const pending = this.pendingPaymentFor(sub);
    const breakdown: TaxBreakdown = pending
      ? {
          amount: pending.amount,
          tax: pending.tax,
          totalAmount: pending.totalAmount - (pending.lateFee ?? 0),
          taxRate: pending.taxRate,
          taxInclusive: pending.taxInclusive,
          gstin: pending.gstin,
        }
      : applyTax(sub.amount, this.taxPolicy);
    const dueDate = paymentDueDate(sub, pending);
    const daysLate = Math.max(0, daysLateBetween(dueDate, on));
    const lateFee = lateFeeFor(breakdown.totalAmount, daysLate, this.lateFeePolicy);
    return { ...breakdown, dueDate, daysLate, lateFee, payable: Math.round((breakdown.totalAmount + lateFee) * 100) / 100 };
  }

  get subscriptions(): HostelSubscription[] {
    return this.subscriptionsSubject.value;
  }

  get payments(): PaymentTransaction[] {
    return this.paymentsSubject.value;
  }

  bySubscriptionId(subscriptionId: string): HostelSubscription | undefined {
    return this.subscriptions.find((s) => s.subscriptionId === subscriptionId);
  }

  /** Why a payment can't be recorded for this subscription, or null if it can. */
  paymentBlockedReason(sub: HostelSubscription): string | null {
    if (!isOpenSubscription(sub)) return `This subscription is ${sub.status}. Start a new subscription to collect payment.`;
    if (sub.amount <= 0) return 'Free plans and trials have nothing to pay.';
    return null;
  }

  /** The pending payment that recording a payment would settle, if any. */
  pendingPaymentFor(sub: HostelSubscription): PaymentTransaction | undefined {
    return this.payments.find((p) => p.subscriptionId === sub.subscriptionId && p.paymentStatus === 'Pending');
  }

  /**
   * Records a successful payment for an open subscription:
   *  - a Pending payment exists → it is marked Paid (same transaction, invoice issued);
   *  - otherwise → a new Paid renewal payment is added and the expiry moves forward one cycle.
   * Either way the subscription keeps its ID and becomes Active / Paid.
   */
  recordPayment(subscriptionId: string, input: RecordPaymentInput): PaymentTransaction {
    const sub = this.bySubscriptionId(subscriptionId);
    if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);
    const blocked = this.paymentBlockedReason(sub);
    if (blocked) throw new Error(blocked);

    const pending = this.pendingPaymentFor(sub);
    const due = this.amountDueNow(sub)!;
    // Stored on the payment, so the invoice never changes if the late-fee settings do.
    const lateFeeFields: Pick<PaymentTransaction, 'lateFee' | 'daysLate'> =
      due.lateFee > 0 ? { lateFee: due.lateFee, daysLate: due.daysLate } : { lateFee: undefined, daysLate: undefined };
    let recorded: PaymentTransaction;
    let updatedSub: HostelSubscription;

    if (pending) {
      // The amount was billed when the pending payment was raised, so its tax stays as billed.
      recorded = {
        ...pending,
        ...input,
        ...lateFeeFields,
        totalAmount: due.payable,
        paymentDate: todayIso(),
        paymentStatus: 'Paid',
        invoiceNumber: this.nextInvoiceNumber(),
      };
      this.paymentsSubject.next(this.payments.map((p) => (p.transactionId === pending.transactionId ? recorded : p)));
      updatedSub = { ...sub, status: 'Active', paymentStatus: 'Paid' };
    } else {
      // New billing period: GST follows the current Settings and is stored on the payment.
      recorded = {
        transactionId: this.nextTransactionId(),
        subscriptionId: sub.subscriptionId,
        hostelName: sub.hostelName,
        planName: sub.planName,
        billingCycle: sub.billingCycle,
        ...applyTax(sub.amount, this.taxPolicy),
        ...lateFeeFields,
        totalAmount: due.payable,
        paymentDate: todayIso(),
        ...input,
        paymentStatus: 'Paid',
        invoiceNumber: this.nextInvoiceNumber(),
      };
      this.paymentsSubject.next([recorded, ...this.payments]);
      updatedSub = renewSubscription(sub);
    }

    this.subscriptionsSubject.next(this.subscriptions.map((s) => (s.subscriptionId === sub.subscriptionId ? updatedSub : s)));

    const amount = this.fmt.money(recorded.totalAmount);
    this.auditLog.record('Record Payment', `${sub.subscriptionId} · ${sub.hostelName}`, {
      details: `${amount} via ${recorded.paymentMethod} (${recorded.paymentGateway}) · ${recorded.invoiceNumber}${
        recorded.lateFee ? ` · includes late fee ${this.fmt.money(recorded.lateFee)} (${recorded.daysLate} days late)` : ''
      }`,
      changes: [
        ...(sub.status !== updatedSub.status ? [{ field: 'Status', oldValue: sub.status, newValue: updatedSub.status }] : []),
        ...(sub.paymentStatus !== updatedSub.paymentStatus
          ? [{ field: 'Payment Status', oldValue: sub.paymentStatus, newValue: updatedSub.paymentStatus }]
          : []),
        ...(sub.expiryDate !== updatedSub.expiryDate
          ? [{ field: 'Expiry Date', oldValue: sub.expiryDate, newValue: updatedSub.expiryDate }]
          : []),
      ],
    });

    this.snackBar.open(`Payment of ${amount} recorded · ${recorded.invoiceNumber}`, 'x', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['app-snackbar--success', 'green-snackbar'],
    });

    return recorded;
  }

  /** TXN10000430 → TXN10000431 (one above the highest existing). */
  private nextTransactionId(): string {
    const max = Math.max(0, ...this.payments.map((p) => parseInt(p.transactionId.replace(/\D/g, ''), 10) || 0));
    return `TXN${String(max + 1).padStart(8, '0')}`;
  }

  /**
   * <Invoice Prefix from Settings><year>-<seq>, e.g. INV-2026-0143.
   * Numbering restarts each calendar year (per prefix).
   */
  private nextInvoiceNumber(): string {
    const year = new Date().getFullYear();
    const prefix = `${this.settings.settings.payment.invoicePrefix || 'INV-'}${year}-`;
    const max = Math.max(
      0,
      ...this.payments
        .filter((p) => p.invoiceNumber?.startsWith(prefix))
        .map((p) => parseInt(p.invoiceNumber!.slice(prefix.length), 10) || 0),
    );
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }
}
