import { Component, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNativeDateAdapter } from '@angular/material/core';
import {
  ExportTable,
  HOSTEL_TYPES,
  REPORT_HOSTELS,
  ReportHostel,
  ReportKey,
} from './report.models';
import {
  HostelSubscription,
  MOCK_PAYMENTS,
  MOCK_SUBSCRIPTIONS,
  PAYMENT_STATUSES,
  PaymentTransaction,
  SUBSCRIPTION_STATUSES,
} from '../subscription-payments/subscription-payment.models';
import { ReportExportService } from './report-export.service';
import { ReportBarListComponent, BarItem } from './report-bar-list.component';
import { statusTone } from '../../shared/constants/status.constants';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

interface ReportFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  hostel: string;
  city: string;
  hostelType: string;
  plan: string;
  status: string;
}

interface OccupancyRow {
  hostelName: string;
  city: string;
  totalBeds: number;
  occupied: number;
  available: number;
  occupancyPct: number;
}

interface ReportTab {
  key: ReportKey;
  label: string;
  icon: string;
  /** Which date the Date range filter is matched against; undefined = snapshot report, filter disabled. */
  dateField?: string;
}

const ALL = 'All';

const emptyFilters = (): ReportFilters => ({
  dateFrom: null,
  dateTo: null,
  hostel: ALL,
  city: ALL,
  hostelType: ALL,
  plan: ALL,
  status: ALL,
});

/** Local-time yyyy-mm-dd, so a picked date compares correctly against ISO date strings. */
const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Platform-level reports across every hostel. Filters are edited as a draft and
 * only take effect on Search, so the numbers on screen always match what
 * Export Excel / Export PDF will produce.
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    AppDatePipe,
    AppCurrencyPipe,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatIconModule,
    MatTooltipModule,
    ReportBarListComponent,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  /** Currency, date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  readonly tabs: ReportTab[] = [
    { key: 'hostels', label: 'Hostel Report', icon: 'apartment', dateField: 'onboarding date' },
    { key: 'residents', label: 'Tenant Report', icon: 'groups' },
    { key: 'occupancy', label: 'Occupancy Report', icon: 'bed' },
    { key: 'subscriptions', label: 'Subscription Report', icon: 'card_membership', dateField: 'start date' },
    { key: 'revenue', label: 'Revenue Report', icon: 'payments', dateField: 'payment date' },
  ];

  activeReport: ReportKey = 'hostels';

  /** What the filter bar is showing. */
  draft: ReportFilters = emptyFilters();
  /** What the report is computed from — updated on Search / Reset. */
  applied: ReportFilters = emptyFilters();

  readonly tone = statusTone;
  readonly hostelTypes = HOSTEL_TYPES;
  readonly hostelNames = REPORT_HOSTELS.map((h) => h.hostelName).sort();
  readonly cities = [...new Set(REPORT_HOSTELS.map((h) => h.city))].sort();
  readonly plans = [...new Set(REPORT_HOSTELS.map((h) => h.plan))].sort();

  constructor(
    private exporter: ReportExportService,
    private snackBar: MatSnackBar,
  ) {}

  get activeTab(): ReportTab {
    return this.tabs.find((t) => t.key === this.activeReport)!;
  }

  get statusOptions(): string[] {
    switch (this.activeReport) {
      case 'subscriptions':
        return SUBSCRIPTION_STATUSES;
      case 'revenue':
        return PAYMENT_STATUSES;
      default:
        return ['Active', 'Inactive'];
    }
  }

  selectReport(key: ReportKey): void {
    if (key === this.activeReport) return;
    this.activeReport = key;
    // Status values differ per report; the rest of the filters carry over.
    this.draft.status = ALL;
    this.applied = { ...this.applied, status: ALL };
    if (!this.activeTab.dateField) {
      this.draft.dateFrom = this.draft.dateTo = null;
      this.applied = { ...this.applied, dateFrom: null, dateTo: null };
    }
  }

  onSearch(): void {
    this.applied = { ...this.draft };
  }

  onReset(): void {
    this.draft = emptyFilters();
    this.applied = emptyFilters();
  }

  get hasPendingChanges(): boolean {
    const a = this.applied;
    const d = this.draft;
    const sameDate = (x: Date | null, y: Date | null) => (x ? toIsoDate(x) : '') === (y ? toIsoDate(y) : '');
    return !(
      sameDate(a.dateFrom, d.dateFrom) &&
      sameDate(a.dateTo, d.dateTo) &&
      a.hostel === d.hostel &&
      a.city === d.city &&
      a.hostelType === d.hostelType &&
      a.plan === d.plan &&
      a.status === d.status
    );
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  private inDateRange(isoDate: string): boolean {
    const { dateFrom, dateTo } = this.applied;
    if (dateFrom && isoDate < toIsoDate(dateFrom)) return false;
    if (dateTo && isoDate > toIsoDate(dateTo)) return false;
    return true;
  }

  /** Hostels matching the hostel-level filters (hostel, city, type, plan). */
  private get baseHostels(): ReportHostel[] {
    const f = this.applied;
    return REPORT_HOSTELS.filter(
      (h) =>
        (f.hostel === ALL || h.hostelName === f.hostel) &&
        (f.city === ALL || h.city === f.city) &&
        (f.hostelType === ALL || h.hostelType === f.hostelType) &&
        (f.plan === ALL || h.plan === f.plan),
    );
  }

  private get statusFilteredHostels(): ReportHostel[] {
    const status = this.applied.status;
    return this.baseHostels.filter((h) => status === ALL || h.status === status);
  }

  // ---- Hostel report ----

  get hostelRows(): ReportHostel[] {
    return this.statusFilteredHostels
      .filter((h) => this.inDateRange(h.onboardedDate))
      .sort((a, b) => a.hostelId.localeCompare(b.hostelId));
  }

  get hostelStats() {
    const rows = this.hostelRows;
    return {
      total: rows.length,
      active: rows.filter((h) => h.status === 'Active').length,
      inactive: rows.filter((h) => h.status === 'Inactive').length,
      regular: rows.filter((h) => h.hostelType === 'Regular Hostel').length,
      college: rows.filter((h) => h.hostelType === 'College Hostel').length,
    };
  }

  get cityBreakdown(): BarItem[] {
    const counts = new Map<string, number>();
    this.hostelRows.forEach((h) => counts.set(h.city, (counts.get(h.city) ?? 0) + 1));
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  // ---- Resident report ----

  get residentRows(): ReportHostel[] {
    return [...this.statusFilteredHostels].sort(
      (a, b) => b.activeResidents + b.checkedOutResidents - (a.activeResidents + a.checkedOutResidents),
    );
  }

  get residentStats() {
    const rows = this.residentRows;
    const active = rows.reduce((s, h) => s + h.activeResidents, 0);
    const checkedOut = rows.reduce((s, h) => s + h.checkedOutResidents, 0);
    return { total: active + checkedOut, active, checkedOut };
  }

  get hostelResidentBars(): BarItem[] {
    return this.residentRows
      .map((h) => ({ label: h.hostelName, value: h.activeResidents }))
      .sort((a, b) => b.value - a.value);
  }

  // ---- Occupancy report ----

  get occupancyRows(): OccupancyRow[] {
    return this.statusFilteredHostels
      .map((h) => ({
        hostelName: h.hostelName,
        city: h.city,
        totalBeds: h.totalBeds,
        occupied: h.activeResidents,
        available: h.totalBeds - h.activeResidents,
        occupancyPct: h.totalBeds ? (h.activeResidents / h.totalBeds) * 100 : 0,
      }))
      .sort((a, b) => b.occupancyPct - a.occupancyPct);
  }

  get occupancyStats() {
    const rows = this.occupancyRows;
    const totalBeds = rows.reduce((s, r) => s + r.totalBeds, 0);
    const occupied = rows.reduce((s, r) => s + r.occupied, 0);
    return {
      totalBeds,
      occupied,
      available: totalBeds - occupied,
      occupancyPct: totalBeds ? (occupied / totalBeds) * 100 : 0,
    };
  }

  // ---- Subscription report ----

  get subscriptionRows(): HostelSubscription[] {
    const names = new Set(this.baseHostels.map((h) => h.hostelName));
    const status = this.applied.status;
    return MOCK_SUBSCRIPTIONS.filter(
      (s) =>
        names.has(s.hostelName) &&
        (status === ALL || s.status === status) &&
        this.inDateRange(s.startDate),
    ).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  get subscriptionTotal(): number {
    return this.subscriptionRows.reduce((s, r) => s + r.amount, 0);
  }

  // ---- Revenue report ----

  get revenueRows(): PaymentTransaction[] {
    const names = new Set(this.baseHostels.map((h) => h.hostelName));
    const status = this.applied.status;
    return MOCK_PAYMENTS.filter(
      (p) =>
        names.has(p.hostelName) &&
        (status === ALL || p.paymentStatus === status) &&
        this.inDateRange(p.paymentDate),
    ).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }

  /** Revenue totals count only money actually collected (Paid). */
  get revenueStats() {
    const rows = this.revenueRows;
    const paid = rows.filter((p) => p.paymentStatus === 'Paid');
    const sum = (list: PaymentTransaction[], key: 'amount' | 'tax' | 'lateFee' | 'totalAmount') =>
      list.reduce((s, p) => s + (p[key] ?? 0), 0);
    return {
      transactions: rows.length,
      amount: sum(paid, 'amount'),
      tax: sum(paid, 'tax'),
      lateFee: sum(paid, 'lateFee'),
      total: sum(paid, 'totalAmount'),
      pending: sum(rows.filter((p) => p.paymentStatus === 'Pending'), 'totalAmount'),
    };
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  get activeRowCount(): number {
    switch (this.activeReport) {
      case 'hostels':
        return this.hostelRows.length;
      case 'residents':
        return this.residentRows.length;
      case 'occupancy':
        return this.occupancyRows.length;
      case 'subscriptions':
        return this.subscriptionRows.length;
      case 'revenue':
        return this.revenueRows.length;
    }
  }

  get filterSummary(): string {
    const f = this.applied;
    const parts: string[] = [];
    if (f.dateFrom || f.dateTo) {
      const fmt = (d: Date | null) => (d ? this.fmtDate(toIsoDate(d)) : '…');
      parts.push(`${this.activeTab.dateField}: ${fmt(f.dateFrom)} – ${fmt(f.dateTo)}`);
    }
    if (f.hostel !== ALL) parts.push(`Hostel: ${f.hostel}`);
    if (f.city !== ALL) parts.push(`City: ${f.city}`);
    if (f.hostelType !== ALL) parts.push(`Type: ${f.hostelType}`);
    if (f.plan !== ALL) parts.push(`Plan: ${f.plan}`);
    if (f.status !== ALL) parts.push(`Status: ${f.status}`);
    return parts.length ? parts.join(' · ') : 'All hostels';
  }

  onExport(format: 'excel' | 'pdf'): void {
    if (this.hasPendingChanges) {
      this.snackBar.open('Click Search to apply your filter changes before exporting', 'x', { duration: 4000 });
      return;
    }
    const table = this.buildExportTable();
    if (format === 'excel') this.exporter.exportExcel(table);
    else this.exporter.exportPdf(table);
  }

  private fmtDate(iso: string): string {
    return this.fmt.date(iso);
  }

  private fmtMoney(n: number): string {
    return this.fmt.money(n);
  }

  private buildExportTable(): ExportTable {
    const title = this.activeTab.label;
    const filterSummary = this.filterSummary;

    switch (this.activeReport) {
      case 'hostels': {
        const s = this.hostelStats;
        return {
          title,
          filterSummary: `${filterSummary} · Active ${s.active}, Inactive ${s.inactive}, Regular ${s.regular}, College ${s.college}`,
          rows: this.hostelRows,
          columns: [
            { header: 'Hostel ID', value: (h: ReportHostel) => h.hostelId },
            { header: 'Hostel', value: (h: ReportHostel) => h.hostelName },
            { header: 'City', value: (h: ReportHostel) => h.city },
            { header: 'Hostel Type', value: (h: ReportHostel) => h.hostelType },
            { header: 'Plan', value: (h: ReportHostel) => h.plan },
            { header: 'Onboarded', value: (h: ReportHostel) => this.fmtDate(h.onboardedDate) },
            { header: 'Status', value: (h: ReportHostel) => h.status },
          ],
        };
      }
      case 'residents': {
        const s = this.residentStats;
        return {
          title,
          filterSummary,
          rows: this.residentRows,
          columns: [
            { header: 'Hostel', value: (h: ReportHostel) => h.hostelName },
            { header: 'City', value: (h: ReportHostel) => h.city },
            { header: 'Active Tenants', value: (h: ReportHostel) => h.activeResidents, numeric: true },
            { header: 'Checked-out Tenants', value: (h: ReportHostel) => h.checkedOutResidents, numeric: true },
            { header: 'Total Tenants', value: (h: ReportHostel) => h.activeResidents + h.checkedOutResidents, numeric: true },
          ],
          totals: ['Total', '', s.active, s.checkedOut, s.total],
        };
      }
      case 'occupancy': {
        const s = this.occupancyStats;
        return {
          title,
          filterSummary,
          rows: this.occupancyRows,
          columns: [
            { header: 'Hostel', value: (r: OccupancyRow) => r.hostelName },
            { header: 'Total Beds', value: (r: OccupancyRow) => r.totalBeds, numeric: true },
            { header: 'Occupied', value: (r: OccupancyRow) => r.occupied, numeric: true },
            { header: 'Available', value: (r: OccupancyRow) => r.available, numeric: true },
            { header: 'Occupancy %', value: (r: OccupancyRow) => `${r.occupancyPct.toFixed(1)}%`, numeric: true },
          ],
          totals: ['Total', s.totalBeds, s.occupied, s.available, `${s.occupancyPct.toFixed(1)}%`],
        };
      }
      case 'subscriptions':
        return {
          title,
          filterSummary,
          rows: this.subscriptionRows,
          columns: [
            { header: 'Hostel', value: (s: HostelSubscription) => s.hostelName },
            { header: 'Plan', value: (s: HostelSubscription) => s.planName },
            { header: 'Start Date', value: (s: HostelSubscription) => this.fmtDate(s.startDate) },
            { header: 'Expiry Date', value: (s: HostelSubscription) => this.fmtDate(s.expiryDate) },
            { header: 'Amount', value: (s: HostelSubscription) => (s.amount > 0 ? this.fmtMoney(s.amount) : 'Free'), numeric: true },
            { header: 'Status', value: (s: HostelSubscription) => s.status },
          ],
          totals: ['Total', '', '', '', this.fmtMoney(this.subscriptionTotal), ''],
        };
      case 'revenue': {
        const s = this.revenueStats;
        return {
          title,
          filterSummary,
          rows: this.revenueRows,
          columns: [
            { header: 'Date', value: (p: PaymentTransaction) => this.fmtDate(p.paymentDate) },
            { header: 'Hostel', value: (p: PaymentTransaction) => p.hostelName },
            { header: 'Transaction ID', value: (p: PaymentTransaction) => p.transactionId },
            { header: 'Amount', value: (p: PaymentTransaction) => this.fmtMoney(p.amount), numeric: true },
            { header: 'Tax', value: (p: PaymentTransaction) => this.fmtMoney(p.tax), numeric: true },
            { header: 'Late Fee', value: (p: PaymentTransaction) => this.fmtMoney(p.lateFee ?? 0), numeric: true },
            { header: 'Total', value: (p: PaymentTransaction) => this.fmtMoney(p.totalAmount), numeric: true },
            { header: 'Status', value: (p: PaymentTransaction) => p.paymentStatus },
          ],
          totals: ['Collected (Paid)', '', '', this.fmtMoney(s.amount), this.fmtMoney(s.tax), this.fmtMoney(s.lateFee), this.fmtMoney(s.total), ''],
        };
      }
    }
  }
}
