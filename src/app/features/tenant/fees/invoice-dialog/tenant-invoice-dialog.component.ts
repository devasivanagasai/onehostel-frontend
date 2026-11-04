import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppDialogComponent } from '../../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../../core/services/app-format.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { TenantPaymentService } from '../../../../core/services/tenant-payment.service';
import { residentFullName } from '../../../../core/models/residents.models';
import { INVOICE_TONES, TRANSACTION_TONES, TenantInvoice, TenantTransaction } from '../../../../core/models/tenant-payment.models';
import { TenantDocContext, downloadInvoice, downloadTenantReceipt, printInvoice, printTenantReceipt } from '../tenant-documents';

export type TenantInvoiceDialogAction = 'pay';

/** Invoice details: breakdown, the Tenant's payments against it, receipts and downloads. */
@Component({
  selector: 'app-tenant-invoice-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-invoice-dialog.component.html',
  styleUrl: './tenant-invoice-dialog.component.scss',
})
export class TenantInvoiceDialogComponent {
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TenantInvoiceDialogComponent, TenantInvoiceDialogAction>);
  private readonly snackBar = inject(MatSnackBar);
  private readonly tenant = inject(TenantContextService);
  readonly service = inject(TenantPaymentService);
  readonly fmt = inject(AppFormatService);

  readonly invoiceTone = INVOICE_TONES;
  readonly txTone = TRANSACTION_TONES;

  /** Looked up through the Tenant's own invoices only, so another resident's id finds nothing. */
  readonly inv: TenantInvoice | undefined = this.service.invoiceById(this.data.id);
  readonly payments: TenantTransaction[] = this.inv ? this.service.transactionsFor(this.inv.id) : [];

  get canPay(): boolean {
    const i = this.inv;
    return !!i && i.outstanding > 0 && i.status !== 'Cancelled' && i.status !== 'Waived';
  }

  private get ctx(): TenantDocContext {
    const r = this.tenant.requireResident();
    return { hostelName: this.tenant.hostelName, residentName: residentFullName(r), residentId: r.residentId, money: (n) => this.fmt.money(n), date: (d) => this.fmt.date(d) };
  }

  downloadInvoice(print = false): void {
    if (!this.inv) return;
    this.run(() => (print ? printInvoice(this.service.requireInvoice(this.inv!.id), this.ctx) : downloadInvoice(this.service.requireInvoice(this.inv!.id), this.ctx)));
  }

  receipt(t: TenantTransaction, print = false): void {
    this.run(() => {
      if (!t.paymentId) throw new Error('A receipt is available only for successful payments.');
      const src = this.service.receiptFor(t.paymentId);
      if (print) printTenantReceipt(src, this.ctx);
      else downloadTenantReceipt(src, this.ctx);
    });
  }

  pay(): void {
    this.dialogRef.close('pay');
  }

  close(): void {
    this.dialogRef.close();
  }

  private run(action: () => void): void {
    try {
      action();
    } catch (err) {
      this.snackBar.open(err instanceof Error ? err.message : 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }
}
