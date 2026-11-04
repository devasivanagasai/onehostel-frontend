import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { FeesService } from './fees.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { localDateIso } from '../../shared/utils/local-date';
import { Charge, Payment, feeDisplayName } from '../models/fees.models';
import {
  GatewayResult,
  TENANT_PAYMENT_METHODS,
  TenantFeesSummary,
  TenantInvoice,
  TenantInvoiceStatus,
  TenantPaymentAttempt,
  TenantPaymentMethod,
  TenantPaymentPolicy,
  TenantTransaction,
  TenantTransactionStatus,
} from '../models/tenant-payment.models';

const STORAGE_KEY = 'onehostel_tenant_payments_v1';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, '0');
const nowLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
/** Amount for notification text: grouped, so it never reads like a one-time code. */
const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

export interface StartPaymentInput {
  invoiceId: string;
  amount: number;
  method: TenantPaymentMethod;
  /** One per payment dialog; submitting twice with the same key returns the same attempt. */
  idempotencyKey: string;
}

/**
 * The Tenant's invoices and payments (FRD 5.5).
 *
 * Payment flow (simulated gateway): `startPayment` records an 'Initiated' attempt and returns a gateway
 * reference. Nothing is paid until `confirmGatewayPayment(ref, result)` — the server-side-style confirm —
 * reports 'success'. 'pending' keeps the invoice unpaid and blocks a duplicate payment; 'failed' leaves it
 * unpaid. The invoice balance changes only through FeesService (Pending online payment, then confirmOnline).
 * Every call reads the Tenant from TenantContextService and checks the invoice / attempt is theirs.
 */
@Injectable({ providedIn: 'root' })
export class TenantPaymentService {
  private readonly tenant = inject(TenantContextService);
  private readonly fees = inject(FeesService);
  private readonly notifications = inject(TenantNotificationService);

  private readonly attemptsSubject = new BehaviorSubject<TenantPaymentAttempt[]>(this.load());

  /** Partial payments are allowed (same as staff collection); paying more than the outstanding amount is not. */
  readonly policy: TenantPaymentPolicy = { allowPartial: true, allowAdvance: false, minAmount: 1 };
  readonly methods = TENANT_PAYMENT_METHODS;

  readonly invoices$: Observable<TenantInvoice[]> = this.changes().pipe(map(() => this.invoices));
  readonly transactions$: Observable<TenantTransaction[]> = this.changes().pipe(map(() => this.transactions));
  readonly summary$: Observable<TenantFeesSummary> = this.changes().pipe(map(() => this.summary));

  private changes(): Observable<unknown> {
    return combineLatest([this.fees.charges$, this.fees.payments$, this.attemptsSubject]);
  }

  // ---- Reads (own data only) ----------------------------------------------------

  /** The signed-in Tenant's invoices, newest issue date first. */
  get invoices(): TenantInvoice[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    return this.fees.charges
      .filter((c) => c.residentId === me)
      .map((c) => this.toInvoice(c, me))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id.localeCompare(a.id));
  }

  invoiceById(id: string): TenantInvoice | undefined {
    return this.invoices.find((i) => i.id === id);
  }

  /** The signed-in Tenant's payment attempts and payments, newest first. */
  get transactions(): TenantTransaction[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    const attempts = this.attemptsSubject.value.filter((a) => a.residentId === me);
    const linked = new Set(attempts.map((a) => a.paymentId).filter((x): x is string => !!x));
    const label = (chargeId: string): string => this.fees.chargeById(chargeId)?.description ?? chargeId;

    const rows: TenantTransaction[] = attempts.map((a) => {
      const p = a.paymentId ? this.fees.paymentById(a.paymentId) : undefined;
      const status: TenantTransactionStatus = p ? p.status : a.status;
      return {
        ref: a.ref,
        invoiceId: a.invoiceId,
        invoiceLabel: label(a.invoiceId),
        amount: a.amount,
        method: a.method,
        status,
        date: a.updatedAt,
        receiptNumber: p?.status === 'Successful' ? p.receiptId : undefined,
        paymentId: p?.id,
        note: a.failureReason,
      };
    });
    for (const p of this.fees.payments) {
      if (p.residentId !== me || linked.has(p.id)) continue;
      rows.push({
        ref: p.transactionRef ?? p.id,
        invoiceId: p.chargeId,
        invoiceLabel: label(p.chargeId),
        amount: p.amount,
        method: p.method,
        status: p.status,
        date: p.paidAt,
        receiptNumber: p.status === 'Successful' ? p.receiptId : undefined,
        paymentId: p.id,
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
  }

  transactionsFor(invoiceId: string): TenantTransaction[] {
    return this.transactions.filter((t) => t.invoiceId === invoiceId);
  }

  get summary(): TenantFeesSummary {
    const list = this.invoices;
    const open = list.filter((i) => i.outstanding > 0);
    const today = localDateIso();
    const upcoming = open.filter((i) => i.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const earliestOverdue = open.filter((i) => i.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const next = upcoming ?? earliestOverdue;
    const latest = this.transactions[0];
    return {
      outstandingTotal: round2(open.reduce((s, i) => s + i.outstanding, 0)),
      nextDue: next ? { date: next.dueDate, invoiceId: next.id, amount: next.outstanding } : undefined,
      latestPayment: latest ? { status: latest.status, amount: latest.amount, date: latest.date } : undefined,
      overdueCount: open.filter((i) => i.status === 'Overdue').length,
    };
  }

  /** An own attempt by gateway reference. */
  attemptByRef(ref: string): TenantPaymentAttempt | undefined {
    const me = this.tenant.residentId;
    return me ? this.attemptsSubject.value.find((a) => a.ref === ref && a.residentId === me) : undefined;
  }

  /** The Initiated / Pending attempt on an own invoice, if any. */
  activeAttempt(invoiceId: string): TenantPaymentAttempt | undefined {
    const me = this.tenant.residentId;
    return me ? this.attemptsSubject.value.find((a) => a.residentId === me && a.invoiceId === invoiceId && (a.status === 'Initiated' || a.status === 'Pending')) : undefined;
  }

  /** Why the amount cannot be paid, or null. */
  validateAmount(outstanding: number, amount: number): string | null {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'Enter the amount to pay.';
    const a = round2(amount);
    if (!(a > 0)) return 'The amount must be greater than zero.';
    if (a < this.policy.minAmount) return `The minimum payment is ${rupees(this.policy.minAmount)}.`;
    if (!this.policy.allowAdvance && a > outstanding) return `You can pay at most the outstanding amount (${rupees(outstanding)}).`;
    if (!this.policy.allowPartial && a !== outstanding) return `Partial payments are not enabled. Pay the full ${rupees(outstanding)}.`;
    return null;
  }

  // ---- Pay (simulated gateway) --------------------------------------------------

  /** Starts a payment on one of the Tenant's own invoices. Creates an 'Initiated' attempt; the invoice is untouched. */
  startPayment(input: StartPaymentInput): TenantPaymentAttempt {
    const me = this.tenant.requireResidentId();
    const key = (input.idempotencyKey ?? '').trim();
    if (!key) throw new Error('Missing payment request key. Reopen the payment window and try again.');
    const repeat = this.attemptsSubject.value.find((a) => a.residentId === me && a.idempotencyKey === key);
    if (repeat) return repeat;

    const charge = this.requireOwnCharge(input.invoiceId, me);
    if (!TENANT_PAYMENT_METHODS.includes(input.method)) throw new Error('Choose UPI, Card or Net Banking.');
    if (charge.cancelledAt) throw new Error('This invoice is closed and cannot be paid.');
    const outstanding = this.fees.balance(charge);
    if (outstanding <= 0) throw new Error('This invoice is already paid.');
    const active = this.activeAttempt(charge.id);
    const heldByPending = this.fees.paymentsFor(charge.id).some((p) => p.status === 'Pending');
    if (active || heldByPending) {
      throw new Error(`A payment${active ? ` (${active.ref})` : ''} is still waiting for its result. Check its status before paying again.`);
    }
    const problem = this.validateAmount(outstanding, input.amount);
    if (problem) throw new Error(problem);

    const now = nowLocal();
    const attempt: TenantPaymentAttempt = {
      ref: this.newReference(),
      idempotencyKey: key,
      residentId: me,
      invoiceId: charge.id,
      amount: round2(input.amount),
      method: input.method,
      status: 'Initiated',
      createdAt: now,
      updatedAt: now,
    };
    this.save([attempt, ...this.attemptsSubject.value]);
    return attempt;
  }

  /**
   * The gateway's confirmed result for an attempt (the server-side confirm step; the page calls it from the
   * "Payment gateway simulation"). Only 'success' changes the invoice. A settled attempt (Successful / Failed)
   * ignores any further result, so a repeated confirm can never charge twice.
   */
  confirmGatewayPayment(ref: string, result: GatewayResult): TenantPaymentAttempt {
    const me = this.tenant.requireResidentId();
    const a = this.requireOwnAttempt(ref, me);
    if (a.status === 'Successful' || a.status === 'Failed') return a;
    if (result === 'pending' && a.status === 'Pending') return a;
    this.requireOwnCharge(a.invoiceId, me);

    if (result === 'failed') {
      if (a.paymentId) this.fees.confirmOnline(a.paymentId, false);
      return this.settle(a, 'Failed', 'The gateway reported the payment as failed.');
    }

    // 'pending' and 'success' both need the payment recorded as Pending online first.
    let paymentId = a.paymentId;
    if (!paymentId) {
      try {
        paymentId = this.fees.recordPayment({
          chargeId: a.invoiceId,
          amount: a.amount,
          method: 'Online',
          transactionRef: a.ref,
          paidAt: nowLocal(),
          notes: `Tenant online payment via ${a.method}`,
        }).id;
      } catch (err) {
        return this.settle(a, 'Failed', err instanceof Error ? err.message : 'The invoice balance changed.');
      }
    }
    if (result === 'pending') {
      const next = this.update({ ...a, paymentId, status: 'Pending', updatedAt: nowLocal() });
      this.notify('Payment pending', `Your payment of ${rupees(a.amount)} for ${a.invoiceId} is awaiting confirmation. Do not pay again; check its status in Fees & Payments.`);
      return next;
    }

    const confirmed = this.fees.confirmOnline(paymentId, true);
    const linked = { ...a, paymentId };
    if (confirmed.status !== 'Successful') {
      return this.settle(linked, 'Failed', 'The invoice was settled by another payment, so this one was not applied.');
    }
    const next = this.update({ ...linked, status: 'Successful', updatedAt: nowLocal() });
    this.notify('Payment received', `Your payment of ${rupees(a.amount)} for ${a.invoiceId} was successful.${confirmed.receiptId ? ` Receipt ${confirmed.receiptId} is ready.` : ''}`);
    return next;
  }

  /**
   * "Check status": re-reads an own attempt. A Pending payment that the hostel office has since confirmed
   * or rejected is brought up to date here; otherwise it stays Pending.
   */
  checkStatus(ref: string): TenantPaymentAttempt {
    const me = this.tenant.requireResidentId();
    const a = this.requireOwnAttempt(ref, me);
    const p = a.paymentId ? this.fees.paymentById(a.paymentId) : undefined;
    if (p && a.status === 'Pending') {
      if (p.status === 'Successful') {
        this.notify('Payment received', `Your payment of ${rupees(a.amount)} for ${a.invoiceId} was confirmed.`);
        return this.update({ ...a, status: 'Successful', updatedAt: nowLocal() });
      }
      if (p.status === 'Failed') return this.settle(a, 'Failed', 'The payment was not confirmed by the provider.');
    }
    return a;
  }

  /** Closes an Initiated attempt that was never completed (the gateway window was closed). Pending ones cannot be abandoned. */
  abandonAttempt(ref: string): TenantPaymentAttempt {
    const me = this.tenant.requireResidentId();
    const a = this.requireOwnAttempt(ref, me);
    if (a.status !== 'Initiated') return a;
    return this.update({ ...a, status: 'Failed', failureReason: 'Payment was not completed.', updatedAt: nowLocal() });
  }

  // ---- Receipts -----------------------------------------------------------------

  /** The payment and invoice for a receipt. Only the Tenant's own Successful payments have one. */
  receiptFor(paymentId: string): { payment: Payment; charge: Charge; balanceAfter: number } {
    const me = this.tenant.requireResidentId();
    const payment = this.fees.paymentById(paymentId);
    if (!payment || payment.residentId !== me) throw new Error('Receipt not found.');
    if (payment.status !== 'Successful' || !payment.receiptId) throw new Error('A receipt is available only for successful payments.');
    const charge = this.requireOwnCharge(payment.chargeId, me);
    return { payment, charge, balanceAfter: Math.max(0, round2(payment.amountDue - payment.amount)) };
  }

  /** Own invoice for printing / download. */
  requireInvoice(id: string): TenantInvoice {
    const me = this.tenant.requireResidentId();
    this.requireOwnCharge(id, me);
    return this.invoiceById(id)!;
  }

  // ---------------------------------------------------------------------------

  private toInvoice(c: Charge, me: string): TenantInvoice {
    const fee = this.fees.feeById(c.feeId);
    const paid = this.fees.paidFor(c.id);
    const raw = this.fees.chargeStatus(c);
    const status: TenantInvoiceStatus =
      raw === 'Cancelled' ? (/waive/i.test(c.cancelReason ?? '') ? 'Waived' : 'Cancelled') : raw === 'Due' ? 'Unpaid' : raw;
    const active = this.attemptsSubject.value.find((a) => a.residentId === me && a.invoiceId === c.id && (a.status === 'Initiated' || a.status === 'Pending'));
    return {
      id: c.id,
      feeType: fee ? feeDisplayName(fee) : 'One-time charge',
      description: c.description,
      period: this.periodLabel(c),
      issueDate: c.issueDate,
      dueDate: c.dueDate,
      baseAmount: c.baseAmount,
      taxAmount: c.taxAmount,
      lateFeeAmount: c.lateFeeAmount,
      total: c.total,
      paid,
      outstanding: this.fees.balance(c),
      status,
      activeAttemptRef: active?.ref,
      pendingAmount: round2(this.fees.paymentsFor(c.id).filter((p) => p.status === 'Pending').reduce((s, p) => s + p.amount, 0)),
    };
  }

  private periodLabel(c: Charge): string {
    const m = /^(\d{4})-(\d{2})$/.exec(c.period ?? '');
    return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : 'One-time';
  }

  private requireOwnCharge(id: string, me: string): Charge {
    const c = this.fees.chargeById(id);
    if (!c || c.residentId !== me) throw new Error('Invoice not found.');
    return c;
  }

  private requireOwnAttempt(ref: string, me: string): TenantPaymentAttempt {
    const a = this.attemptsSubject.value.find((x) => x.ref === ref);
    if (!a || a.residentId !== me) throw new Error('Payment not found.');
    return a;
  }

  private settle(a: TenantPaymentAttempt, status: 'Failed', reason: string): TenantPaymentAttempt {
    const next = this.update({ ...a, status, failureReason: reason, updatedAt: nowLocal() });
    this.notify('Payment failed', `Your payment of ${rupees(a.amount)} for ${a.invoiceId} did not go through. Nothing was charged to the invoice; you can try again.`);
    return next;
  }

  private notify(title: string, body: string): void {
    const me = this.tenant.residentId;
    if (!me) return;
    try {
      this.notifications.push(me, { category: 'Payment', title, body, route: '/my/fees' });
    } catch {
      /* a notification problem must never undo a payment result */
    }
  }

  private newReference(): string {
    const existing = new Set(this.attemptsSubject.value.map((a) => a.ref));
    let ref: string;
    do {
      ref = `GW-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    } while (existing.has(ref));
    return ref;
  }

  private update(next: TenantPaymentAttempt): TenantPaymentAttempt {
    this.save(this.attemptsSubject.value.map((a) => (a.ref === next.ref ? next : a)));
    return next;
  }

  private load(): TenantPaymentAttempt[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as TenantPaymentAttempt[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* start empty */
    }
    return [];
  }

  private save(list: TenantPaymentAttempt[]): void {
    this.attemptsSubject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable; kept in memory */
    }
  }
}
