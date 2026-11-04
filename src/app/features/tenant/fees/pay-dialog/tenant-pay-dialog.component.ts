import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../../core/services/app-format.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { TenantPaymentService } from '../../../../core/services/tenant-payment.service';
import { residentFullName } from '../../../../core/models/residents.models';
import {
  GatewayResult,
  TENANT_PAYMENT_METHODS,
  TENANT_PAYMENT_METHOD_ICONS,
  TenantInvoice,
  TenantPaymentAttempt,
  TenantPaymentMethod,
} from '../../../../core/models/tenant-payment.models';
import { TenantDocContext, downloadTenantReceipt, printTenantReceipt } from '../tenant-documents';

export interface TenantPayDialogData {
  invoiceId: string;
  /** An Initiated / Pending payment on this invoice: reopen it instead of starting a new one. */
  resumeRef?: string;
}

type Step = 'form' | 'gateway' | 'result';

const GATEWAY_DELAY_MS = 1200;

const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

/**
 * Pay Now: choose amount and method, then complete the payment in a clearly labelled gateway simulation.
 * The invoice only changes when the gateway result is confirmed through TenantPaymentService.
 */
@Component({
  selector: 'app-tenant-pay-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-pay-dialog.component.html',
  styleUrl: './tenant-pay-dialog.component.scss',
})
export class TenantPayDialogComponent implements OnDestroy {
  private readonly data = inject<TenantPayDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TenantPayDialogComponent>);
  private readonly tenant = inject(TenantContextService);
  readonly service = inject(TenantPaymentService);
  readonly fmt = inject(AppFormatService);

  readonly methods = TENANT_PAYMENT_METHODS;
  readonly methodIcons = TENANT_PAYMENT_METHOD_ICONS;
  readonly policy = this.service.policy;

  step: Step = 'form';
  /** Fresh per payment attempt: a double click or repeated submit returns the same attempt. */
  private idempotencyKey = newKey();
  amount: number | null = null;
  method: TenantPaymentMethod = 'UPI';
  submitted = false;
  busy = false;
  connecting = false;
  error = '';
  attempt?: TenantPaymentAttempt;
  receiptError = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    const inv = this.invoice;
    this.amount = inv ? inv.outstanding : null;
    if (this.data.resumeRef) {
      const a = this.service.attemptByRef(this.data.resumeRef);
      if (a) this.show(a);
    }
  }

  /** Looked up among the Tenant's own invoices; null for anything else. */
  get invoice(): TenantInvoice | undefined {
    return this.service.invoiceById(this.data.invoiceId);
  }

  get outstanding(): number {
    return this.invoice?.outstanding ?? 0;
  }

  get amountError(): string {
    if (!this.invoice) return 'This invoice isn’t available.';
    return this.service.validateAmount(this.outstanding, this.amount as number) ?? '';
  }

  get title(): string {
    return this.step === 'result' ? 'Payment result' : this.step === 'gateway' ? 'Complete payment' : 'Pay invoice';
  }

  get active(): boolean {
    return !!this.attempt && (this.attempt.status === 'Initiated' || this.attempt.status === 'Pending');
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  payFull(): void {
    this.amount = this.outstanding;
  }

  // ---- Steps ------------------------------------------------------------------

  start(): void {
    this.submitted = true;
    this.error = '';
    if (this.amountError || this.busy) return;
    this.busy = true;
    try {
      this.show(this.service.startPayment({ invoiceId: this.data.invoiceId, amount: this.amount as number, method: this.method, idempotencyKey: this.idempotencyKey }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not start the payment.';
    } finally {
      this.busy = false;
    }
  }

  private show(a: TenantPaymentAttempt): void {
    this.attempt = a;
    this.step = a.status === 'Initiated' || a.status === 'Pending' ? 'gateway' : 'result';
    if (a.status === 'Initiated') {
      this.connecting = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => (this.connecting = false), GATEWAY_DELAY_MS);
    } else {
      this.connecting = false;
    }
  }

  /** The gateway simulation reports a result; the service decides what that does to the invoice. */
  report(result: GatewayResult): void {
    const a = this.attempt;
    if (!a || this.busy || this.connecting) return;
    this.busy = true;
    this.error = '';
    try {
      this.show(this.service.confirmGatewayPayment(a.ref, result));
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not confirm the payment.';
    } finally {
      this.busy = false;
    }
  }

  checkStatus(): void {
    const a = this.attempt;
    if (!a) return;
    this.error = '';
    try {
      const next = this.service.checkStatus(a.ref);
      if (next.status === 'Pending') this.error = 'Still pending. Your bank has not confirmed yet. Please wait before trying again; do not pay twice.';
      this.show(next);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not check the status.';
    }
  }

  abandon(): void {
    const a = this.attempt;
    if (!a) return;
    try {
      this.show(this.service.abandonAttempt(a.ref));
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not cancel the payment.';
    }
  }

  retry(): void {
    this.attempt = undefined;
    this.idempotencyKey = newKey();
    this.error = '';
    this.submitted = false;
    this.amount = this.outstanding;
    this.step = 'form';
  }

  // ---- Receipt ----------------------------------------------------------------

  private get ctx(): TenantDocContext {
    const r = this.tenant.requireResident();
    return { hostelName: this.tenant.hostelName, residentName: residentFullName(r), residentId: r.residentId, money: (n) => this.fmt.money(n), date: (d) => this.fmt.date(d) };
  }

  receipt(print = false): void {
    this.receiptError = '';
    try {
      const paymentId = this.attempt?.paymentId;
      if (!paymentId) throw new Error('A receipt is available only for successful payments.');
      const src = this.service.receiptFor(paymentId);
      if (print) printTenantReceipt(src, this.ctx);
      else downloadTenantReceipt(src, this.ctx);
    } catch (err) {
      this.receiptError = err instanceof Error ? err.message : 'Could not open the receipt.';
    }
  }

  receiptNumber(): string | undefined {
    const id = this.attempt?.paymentId;
    return id ? this.service.transactions.find((t) => t.paymentId === id)?.receiptNumber : undefined;
  }

  close(): void {
    this.dialogRef.close();
  }
}
