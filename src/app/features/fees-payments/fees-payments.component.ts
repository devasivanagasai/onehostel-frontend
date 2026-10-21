import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../core/services/app-format.service';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { FeeInput, FeesService, OneTimeChargeInput, RecordPaymentInput } from './fees.service';
import {
  Charge,
  ChargeStatus,
  FEE_STATUSES,
  FeeConfig,
  OFFLINE_METHODS,
  PAYMENT_STATUSES,
  Payment,
  describeDueRule,
  describeFrequency,
  describeLateFee,
  feeDisplayName,
} from './fees.models';
import { FeeConfigDialogComponent, FeeConfigDialogData } from './fee-config-dialog/fee-config-dialog.component';
import { RecordPaymentDialogComponent, RecordPaymentDialogData } from './record-payment-dialog/record-payment-dialog.component';
import { ChargeDialogComponent } from './charge-dialog/charge-dialog.component';
import { PaymentViewDialogComponent, PaymentViewDialogData } from './payment-view-dialog/payment-view-dialog.component';
import { ReasonDialogComponent, ReasonDialogData } from './reason-dialog.component';
import { downloadReceipt } from './receipt';

export type FeesTab = 'payments' | 'charges' | 'fees';

const AVATAR_TONES = ['blue', 'purple', 'green', 'amber'] as const;

const PAYMENT_TONES: Record<string, string> = {
  Successful: 'success',
  Pending: 'warning',
  Failed: 'danger',
  Reversed: 'neutral',
  Refunded: 'info',
};

const CHARGE_TONES: Record<ChargeStatus, string> = {
  Paid: 'success',
  'Partially Paid': 'info',
  Due: 'warning',
  Overdue: 'danger',
  Cancelled: 'neutral',
};

const FEE_TONES: Record<string, string> = { Active: 'success', Draft: 'warning', Inactive: 'neutral' };

@Component({
  selector: 'app-fees-payments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatTableModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './fees-payments.component.html',
  styleUrl: './fees-payments.component.scss',
})
export class FeesPaymentsComponent {
  readonly fees = inject(FeesService);
  readonly fmt = inject(AppFormatService);
  private readonly settings = inject(SystemSettingsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly stats$ = this.fees.stats$;
  readonly gateway = this.settings.settings.payment.paymentGateway || 'Online';

  readonly feeDisplayName = feeDisplayName;
  readonly describeDueRule = describeDueRule;
  readonly describeFrequency = describeFrequency;
  readonly describeLateFee = describeLateFee;

  /** Restored from ?tab= so a refresh or shared link opens the same tab. */
  tab: FeesTab = 'payments';
  pageSize = 10;
  currentPage = 0;

  // ---- Filters (one set per tab) ----
  paymentFilters = { search: '', status: 'All', method: 'All', period: 'All' };
  chargeFilters = { search: '', status: 'Open', fee: 'All' };
  feeFilters = { search: '', status: 'All' };

  readonly paymentStatusOptions = ['All', ...PAYMENT_STATUSES];
  readonly methodOptions = ['All', ...OFFLINE_METHODS, 'Online'];
  readonly periodOptions = [
    { value: 'All', label: 'Any date' },
    { value: 'month', label: 'This month' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
  ];
  readonly chargeStatusOptions = [
    { value: 'Open', label: 'Open (unpaid)' },
    { value: 'All', label: 'All Status' },
    ...(['Overdue', 'Due', 'Partially Paid', 'Paid', 'Cancelled'] as ChargeStatus[]).map((s) => ({ value: s, label: s })),
  ];
  readonly feeStatusOptions = ['All', ...FEE_STATUSES];

  readonly paymentColumns = ['payment', 'resident', 'charge', 'amount', 'method', 'date', 'status', 'actions'];
  readonly chargeColumns = ['invoice', 'resident', 'description', 'total', 'balance', 'due', 'status', 'actions'];
  readonly feeColumns = ['fee', 'amount', 'frequency', 'due', 'appliesTo', 'status', 'actions'];

  constructor() {
    this.syncTabFromUrl();
  }

  // ---- Tabs -------------------------------------------------------------------

  setTab(tab: FeesTab): void {
    this.tab = tab;
    this.currentPage = 0;
    this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ---- Payments tab -----------------------------------------------------------

  get filteredPayments(): Payment[] {
    const f = this.paymentFilters;
    const q = f.search.trim().toLowerCase();
    const from = this.periodFrom(f.period);
    return this.fees.payments
      .filter((p) => {
        if (q && ![p.id, p.receiptId ?? '', p.residentName, p.residentId, p.chargeId, p.transactionRef ?? ''].join(' ').toLowerCase().includes(q)) return false;
        if (f.status !== 'All' && p.status !== f.status) return false;
        if (f.method !== 'All' && p.method !== f.method) return false;
        if (from && p.paidAt.slice(0, 10) < from) return false;
        return true;
      })
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }

  get paymentFiltersActive(): boolean {
    const f = this.paymentFilters;
    return !!f.search.trim() || f.status !== 'All' || f.method !== 'All' || f.period !== 'All';
  }

  clearPaymentFilters(): void {
    this.paymentFilters = { search: '', status: 'All', method: 'All', period: 'All' };
    this.currentPage = 0;
  }

  // ---- Charges tab ------------------------------------------------------------

  get filteredCharges(): Charge[] {
    const f = this.chargeFilters;
    const q = f.search.trim().toLowerCase();
    return this.fees.charges
      .filter((c) => {
        if (q && ![c.id, c.residentName, c.residentId, c.description].join(' ').toLowerCase().includes(q)) return false;
        const status = this.fees.chargeStatus(c);
        if (f.status === 'Open' && (status === 'Paid' || status === 'Cancelled')) return false;
        if (f.status !== 'Open' && f.status !== 'All' && status !== f.status) return false;
        if (f.fee === 'one-time' && c.feeId) return false;
        if (f.fee !== 'All' && f.fee !== 'one-time' && c.feeId !== f.fee) return false;
        return true;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  }

  get chargeFiltersActive(): boolean {
    const f = this.chargeFilters;
    return !!f.search.trim() || f.status !== 'Open' || f.fee !== 'All';
  }

  clearChargeFilters(): void {
    this.chargeFilters = { search: '', status: 'Open', fee: 'All' };
    this.currentPage = 0;
  }

  /** Overdue charges visible in the current filter — the target of "Remind all". */
  get remindable(): Charge[] {
    return this.filteredCharges.filter((c) => this.fees.chargeStatus(c) === 'Overdue');
  }

  // ---- Fee setup tab ----------------------------------------------------------

  get filteredFees(): FeeConfig[] {
    const f = this.feeFilters;
    const q = f.search.trim().toLowerCase();
    return this.fees.fees.filter(
      (fee) =>
        (!q || [fee.id, fee.name, fee.label ?? '', fee.category].join(' ').toLowerCase().includes(q)) &&
        (f.status === 'All' || fee.status === f.status),
    );
  }

  get feeFiltersActive(): boolean {
    return !!this.feeFilters.search.trim() || this.feeFilters.status !== 'All';
  }

  clearFeeFilters(): void {
    this.feeFilters = { search: '', status: 'All' };
    this.currentPage = 0;
  }

  appliesTo(fee: FeeConfig): string {
    const a = fee.applicability;
    if (a.mode === 'Types') return a.residentTypes.join(', ');
    if (a.mode === 'Residents') return `${a.residentIds.length} selected resident${a.residentIds.length === 1 ? '' : 's'}`;
    return 'All residents';
  }

  // ---- Paging (shared by the active tab) --------------------------------------

  get activeRowCount(): number {
    return this.tab === 'payments' ? this.filteredPayments.length : this.tab === 'charges' ? this.filteredCharges.length : this.filteredFees.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.activeRowCount / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  page<T>(rows: T[]): T[] {
    const start = this.safePage * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Actions ----------------------------------------------------------------

  openRecordPayment(chargeId?: string): void {
    this.dialog
      .open<RecordPaymentDialogComponent, RecordPaymentDialogData, RecordPaymentInput>(RecordPaymentDialogComponent, {
        width: '640px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
        data: { chargeId },
      })
      .afterClosed()
      .subscribe((input) => {
        if (!input) return;
        this.run(() => {
          const p = this.fees.recordPayment(input);
          this.snackBar.open(
            p.status === 'Pending'
              ? `${p.id} recorded as Pending. Confirm it once ${this.gateway} reports the result.`
              : `₹${p.amount} collected from ${p.residentName}. Receipt ${p.receiptId} issued.`,
            p.receiptId ? 'View' : 'Close',
            { duration: 5000 },
          ).onAction().subscribe(() => this.openPayment(p));
        });
      });
  }

  openPayment(p: Payment): void {
    this.dialog.open<PaymentViewDialogComponent, PaymentViewDialogData>(PaymentViewDialogComponent, {
      width: '580px',
      maxWidth: '94vw',
      autoFocus: false,
      data: { paymentId: p.id },
    });
  }

  downloadReceipt(p: Payment): void {
    const charge = this.fees.chargeById(p.chargeId);
    downloadReceipt(p, {
      appName: this.settings.settings.general.applicationName || 'OneHostel',
      money: (n) => this.fmt.money(n),
      date: (iso) => this.fmt.date(iso, iso.length > 10 ? 'datetime' : 'date'),
      balanceAfter: Math.max(0, Math.round((p.amountDue - p.amount) * 100) / 100),
      charge,
    });
  }

  openOneTimeCharge(): void {
    this.dialog
      .open<ChargeDialogComponent, unknown, OneTimeChargeInput>(ChargeDialogComponent, { width: '560px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((input) => {
        if (!input) return;
        this.run(() => {
          const created = this.fees.createOneTimeCharge(input);
          this.snackBar.open(`${created.length} charge${created.length === 1 ? '' : 's'} created.`, 'Close', { duration: 3500 });
        });
      });
  }

  remind(charges: Charge[]): void {
    if (!charges.length) return;
    const one = charges.length === 1;
    this.confirmDialog
      .confirm({
        title: one ? `Send reminder to ${charges[0].residentName}?` : `Send ${charges.length} overdue reminders?`,
        message: one
          ? `${charges[0].description} — ₹${this.fees.balance(charges[0])} ${this.fees.chargeStatus(charges[0]) === 'Overdue' ? 'is overdue' : 'is due'}.`
          : 'Each resident gets a reminder for their overdue balance.',
        confirmLabel: 'Send reminder' + (one ? '' : 's'),
        tone: 'primary',
        icon: 'notifications_active',
        details: [{ icon: 'sms', label: 'Channels', value: 'SMS & Email' }],
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.run(() => {
          const sent = this.fees.sendReminders(charges.map((c) => c.id));
          this.snackBar.open(`${sent} reminder${sent === 1 ? '' : 's'} sent.`, 'Close', { duration: 3000 });
        });
      });
  }

  cancelCharge(c: Charge): void {
    this.dialog
      .open<ReasonDialogComponent, ReasonDialogData, string>(ReasonDialogComponent, {
        width: '460px',
        maxWidth: '94vw',
        data: {
          title: `Cancel ${c.id}?`,
          message: `${c.description} for ${c.residentName} (₹${c.total}) is closed as an adjustment. It stays in the list for history.`,
          confirmLabel: 'Cancel charge',
        },
      })
      .afterClosed()
      .subscribe((reason) => {
        if (!reason) return;
        this.run(() => {
          this.fees.cancelCharge(c.id, reason);
          this.snackBar.open(`${c.id} cancelled.`, 'Close', { duration: 3000 });
        });
      });
  }

  openFee(fee?: FeeConfig): void {
    this.dialog
      .open<FeeConfigDialogComponent, FeeConfigDialogData, FeeInput>(FeeConfigDialogComponent, {
        width: '700px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
        data: { fee },
      })
      .afterClosed()
      .subscribe((input) => {
        if (!input) return;
        this.run(() => {
          const saved = this.fees.saveFee(input, fee?.id);
          this.snackBar.open(`${feeDisplayName(saved)} ${fee ? 'updated' : 'created'} (${saved.status}).`, 'Close', { duration: 3000 });
          if (saved.status === 'Active' && fee?.status !== 'Active') this.generate(saved);
        });
      });
  }

  activate(fee: FeeConfig): void {
    this.confirmDialog
      .confirm({
        title: `Activate ${feeDisplayName(fee)}?`,
        message: 'Active fees can generate resident charges. You can generate this period\'s charges straight after.',
        confirmLabel: 'Activate',
        tone: 'primary',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.run(() => {
          this.fees.setFeeStatus(fee.id, 'Active');
          this.generate(this.fees.feeById(fee.id)!);
        });
      });
  }

  /** Generates the current period's charges after showing what will happen. */
  generate(fee: FeeConfig): void {
    let preview;
    try {
      preview = this.fees.previewGeneration(fee.id);
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Cannot generate charges.', 'Close', { duration: 4000 });
      return;
    }
    if (preview.toCreate === 0) {
      this.snackBar.open(
        `${feeDisplayName(fee)} · ${preview.period}: nothing to generate${preview.existing ? ` (${preview.existing} already exist)` : ''}.`,
        'Close',
        { duration: 4000 },
      );
      return;
    }
    this.confirmDialog
      .confirm({
        title: `Generate ${feeDisplayName(fee)} charges?`,
        message: `Creates one invoice per applicable resident for ${preview.period}.`,
        confirmLabel: `Generate ${preview.toCreate}`,
        tone: 'primary',
        icon: 'receipt_long',
        details: [
          { icon: 'group', label: 'New charges', value: String(preview.toCreate) },
          { icon: 'event', label: 'Due', value: describeDueRule(fee.dueRule) },
          ...(preview.existing ? [{ icon: 'block', label: 'Skipped (already charged)', value: String(preview.existing) }] : []),
        ],
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.run(() => {
          const res = this.fees.generateCharges(fee.id);
          this.snackBar.open(`${res.created} charge${res.created === 1 ? '' : 's'} generated for ${res.period}.`, 'View', { duration: 4000 })
            .onAction()
            .subscribe(() => {
              this.chargeFilters = { search: '', status: 'Open', fee: fee.id };
              this.setTab('charges');
            });
        });
      });
  }

  // ---- View helpers -----------------------------------------------------------

  paymentTone(p: Payment): string {
    return PAYMENT_TONES[p.status];
  }

  chargeTone(c: Charge): string {
    return CHARGE_TONES[this.fees.chargeStatus(c)];
  }

  feeTone(f: FeeConfig): string {
    return FEE_TONES[f.status];
  }

  canCancel(c: Charge): boolean {
    return this.fees.canReverse && !c.cancelledAt && this.fees.paidFor(c.id) === 0 && !this.fees.paymentsFor(c.id).some((p) => p.status === 'Pending');
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  tone(id: string): string {
    const n = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return AVATAR_TONES[n % AVATAR_TONES.length];
  }

  // ---------------------------------------------------------------------------

  private syncTabFromUrl(): void {
    const t = this.route.snapshot.queryParamMap.get('tab');
    if (t === 'payments' || t === 'charges' || t === 'fees') this.tab = t;
  }

  private periodFrom(period: string): string | undefined {
    const d = new Date();
    if (period === 'month') return `${d.toISOString().slice(0, 7)}-01`;
    if (period === '30' || period === '90') {
      d.setDate(d.getDate() - Number(period));
      return d.toISOString().slice(0, 10);
    }
    return undefined;
  }

  private run(fn: () => void): void {
    try {
      fn();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }
}
