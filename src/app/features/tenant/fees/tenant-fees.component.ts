import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { combineLatest } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { TenantContextService } from '../../../core/services/tenant-context.service';
import { TenantPaymentService } from '../../../core/services/tenant-payment.service';
import { residentFullName } from '../../../core/models/residents.models';
import {
  INVOICE_TONES,
  TENANT_INVOICE_STATUSES,
  TRANSACTION_TONES,
  TenantFeesSummary,
  TenantInvoice,
  TenantTransaction,
} from '../../../core/models/tenant-payment.models';
import { TenantDocContext, downloadInvoice, downloadTenantReceipt } from './tenant-documents';
import { TenantInvoiceDialogComponent, TenantInvoiceDialogAction } from './invoice-dialog/tenant-invoice-dialog.component';
import { TenantPayDialogComponent, TenantPayDialogData } from './pay-dialog/tenant-pay-dialog.component';

type LoadState = 'loading' | 'ready' | 'error';
type Tab = 'invoices' | 'transactions';

interface FeeFilters {
  search: string;
  status: string;
  feeType: string;
}

const DEFAULT_FILTERS: FeeFilters = { search: '', status: 'All', feeType: 'All' };

/** Fees & Payments (FRD 5.5): the Tenant's own invoices, Pay Now through the simulated gateway, receipts and history. */
@Component({
  selector: 'app-tenant-fees',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatDialogModule, MatSnackBarModule, MatTooltipModule, AppButtonComponent, AppTableCardComponent],
  templateUrl: './tenant-fees.component.html',
  styleUrl: './tenant-fees.component.scss',
})
export class TenantFeesComponent implements OnInit {
  readonly service = inject(TenantPaymentService);
  readonly fmt = inject(AppFormatService);
  private readonly tenant = inject(TenantContextService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly statuses = TENANT_INVOICE_STATUSES;
  readonly invoiceTone = INVOICE_TONES;
  readonly txTone = TRANSACTION_TONES;

  state: LoadState = 'loading';
  tab: Tab = 'invoices';
  invoices: TenantInvoice[] = [];
  transactions: TenantTransaction[] = [];
  summary: TenantFeesSummary = { outstandingTotal: 0, overdueCount: 0 };

  filters: FeeFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;
  txPageSize = 10;
  txPage = 0;

  ngOnInit(): void {
    combineLatest([this.service.invoices$, this.service.transactions$, this.service.summary$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([invoices, transactions, summary]) => {
        this.invoices = invoices;
        this.transactions = transactions;
        this.summary = summary;
      });
    this.load();
  }

  /** Shows the loading state briefly, then the page (or the error state with Retry). */
  load(): void {
    this.state = 'loading';
    setTimeout(() => (this.state = this.tenant.residentId && this.tenant.resident ? 'ready' : 'error'), 250);
  }

  // ---- Invoice list -------------------------------------------------------------

  get feeTypes(): string[] {
    return [...new Set(this.invoices.map((i) => i.feeType))].sort();
  }

  get filtered(): TenantInvoice[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.invoices.filter((i) => {
      if (f.status !== 'All' && i.status !== f.status) return false;
      if (f.feeType !== 'All' && i.feeType !== f.feeType) return false;
      return !q || [i.id, i.feeType, i.description, i.period].join(' ').toLowerCase().includes(q);
    });
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.feeType !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): TenantInvoice[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  get txTotalPages(): number {
    return Math.max(1, Math.ceil(this.transactions.length / this.txPageSize));
  }

  get txSafePage(): number {
    return Math.min(this.txPage, this.txTotalPages - 1);
  }

  get txPaged(): TenantTransaction[] {
    const start = this.txSafePage * this.txPageSize;
    return this.transactions.slice(start, start + this.txPageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  onTxPageSizeChange(size: number): void {
    this.txPageSize = size;
    this.txPage = 0;
  }

  canPay(i: TenantInvoice): boolean {
    return i.outstanding > 0 && i.status !== 'Cancelled' && i.status !== 'Waived' && i.status !== 'Paid';
  }

  get latestTone(): string {
    return this.summary.latestPayment ? this.txTone[this.summary.latestPayment.status] : 'neutral';
  }

  // ---- Actions ----------------------------------------------------------------

  private get docContext(): TenantDocContext {
    const r = this.tenant.requireResident();
    return { hostelName: this.tenant.hostelName, residentName: residentFullName(r), residentId: r.residentId, money: (n) => this.fmt.money(n), date: (d) => this.fmt.date(d) };
  }

  openInvoice(i: TenantInvoice): void {
    this.dialog
      .open<TenantInvoiceDialogComponent, { id: string }, TenantInvoiceDialogAction>(TenantInvoiceDialogComponent, {
        width: '760px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { id: i.id },
      })
      .afterClosed()
      .subscribe((action) => {
        if (action === 'pay') this.pay(i);
      });
  }

  /** Opens the payment window: a new payment, or (when one is waiting for its result) its status. */
  pay(i: TenantInvoice): void {
    const data: TenantPayDialogData = { invoiceId: i.id, resumeRef: i.activeAttemptRef };
    this.dialog.open<TenantPayDialogComponent, TenantPayDialogData>(TenantPayDialogComponent, {
      width: '560px',
      maxWidth: '94vw',
      autoFocus: false,
      disableClose: true,
      data,
    });
  }

  downloadInvoice(i: TenantInvoice): void {
    try {
      downloadInvoice(this.service.requireInvoice(i.id), this.docContext);
    } catch (err) {
      this.snackBar.open(err instanceof Error ? err.message : 'Could not download the invoice.', 'Close', { duration: 4500 });
    }
  }

  downloadReceipt(t: TenantTransaction): void {
    try {
      if (!t.paymentId) throw new Error('A receipt is available only for successful payments.');
      downloadTenantReceipt(this.service.receiptFor(t.paymentId), this.docContext);
    } catch (err) {
      this.snackBar.open(err instanceof Error ? err.message : 'Could not download the receipt.', 'Close', { duration: 4500 });
    }
  }

  checkStatus(t: TenantTransaction): void {
    try {
      const a = this.service.checkStatus(t.ref);
      this.snackBar.open(a.status === 'Pending' ? `${t.ref} is still pending. Please wait; do not pay again.` : `${t.ref} is now ${a.status}.`, 'Close', { duration: 4500 });
    } catch (err) {
      this.snackBar.open(err instanceof Error ? err.message : 'Could not check the status.', 'Close', { duration: 4500 });
    }
  }

  /** Pending gateway payments can be re-checked or settled from the payment window. */
  openPending(t: TenantTransaction): void {
    const inv = this.invoices.find((i) => i.id === t.invoiceId);
    if (inv) this.pay(inv);
  }

  isOpenAttempt(t: TenantTransaction): boolean {
    return (t.status === 'Pending' || t.status === 'Initiated') && !!this.service.attemptByRef(t.ref);
  }
}
