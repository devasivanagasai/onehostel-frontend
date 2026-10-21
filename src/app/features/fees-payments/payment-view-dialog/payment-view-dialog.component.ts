import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFormatService } from '../../../core/services/app-format.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { FeesService } from '../fees.service';
import { Payment } from '../fees.models';
import { downloadReceipt } from '../receipt';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';

export interface PaymentViewDialogData {
  paymentId: string;
}

type PendingAction = 'Reversed' | 'Refunded' | null;

@Component({
  selector: 'app-payment-view-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatFormFieldModule, MatInputModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './payment-view-dialog.component.html',
  styleUrl: './payment-view-dialog.component.scss',
})
export class PaymentViewDialogComponent {
  readonly fees = inject(FeesService);
  readonly fmt = inject(AppFormatService);
  private readonly settings = inject(SystemSettingsService);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<PaymentViewDialogData>(MAT_DIALOG_DATA);

  readonly gateway = this.settings.settings.payment.paymentGateway || 'provider';

  /** Reverse / refund form shown inline. */
  action: PendingAction = null;
  reason = '';
  error = '';

  get p(): Payment {
    return this.fees.paymentById(this.data.paymentId)!;
  }

  get charge() {
    return this.fees.chargeById(this.p.chargeId);
  }

  get balanceNow(): number {
    return this.charge ? this.fees.balance(this.charge) : 0;
  }

  /** Balance just after this payment, as printed on its receipt. */
  get balanceAfter(): number {
    return Math.max(0, Math.round((this.p.amountDue - this.p.amount) * 100) / 100);
  }

  statusTone(status: string): string {
    return { Successful: 'success', Pending: 'warning', Failed: 'danger', Reversed: 'neutral', Refunded: 'info' }[status] ?? 'neutral';
  }

  confirm(success: boolean): void {
    this.run(() => {
      const next = this.fees.confirmOnline(this.p.id, success);
      this.snackBar.open(
        next.status === 'Successful' ? `${next.id} confirmed. Receipt ${next.receiptId} issued.` : `${next.id} marked Failed — not counted as collected.`,
        'Close',
        { duration: 3500 },
      );
    });
  }

  startAction(kind: Exclude<PendingAction, null>): void {
    this.action = kind;
    this.reason = '';
    this.error = '';
  }

  submitAction(): void {
    if (!this.action) return;
    const kind = this.action;
    this.run(() => {
      this.fees.reverseOrRefund(this.p.id, kind, this.reason);
      this.action = null;
      this.snackBar.open(`${this.p.id} ${kind.toLowerCase()}. The original record is kept.`, 'Close', { duration: 3500 });
    });
  }

  download(): void {
    downloadReceipt(this.p, {
      appName: this.settings.settings.general.applicationName || 'OneHostel',
      money: (n) => this.fmt.money(n),
      date: (iso) => this.fmt.date(iso, iso.length > 10 ? 'datetime' : 'date'),
      balanceAfter: this.balanceAfter,
      charge: this.charge,
    });
  }

  private run(fn: () => void): void {
    this.error = '';
    try {
      fn();
    } catch (err: any) {
      this.error = err?.message ?? 'Something went wrong.';
    }
  }
}
