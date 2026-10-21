import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppFormatService } from '../../core/services/app-format.service';
import { AuthService } from '../../core/services/auth.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ReportExportService } from '../reports/report-export.service';
import { HostelReportsService } from './hostel-reports.service';
import { downloadReportCsv } from './hostel-report-csv';
import {
  HOSTEL_REPORT_TABS,
  HostelReportKey,
  HostelReportTab,
  OWNER_HOSTEL,
  PERIOD_KEY,
  ReportFilterDef,
  ReportResult,
  periodRange,
} from './hostel-reports.models';

interface FilterChip {
  key: string;
  label: string;
  /** A non-default value; removing it resets that filter. */
  removable: boolean;
}

/**
 * Basic Reports (4.7): five owner reports over the live module data, with filters,
 * applied-filter chips, totals that reconcile with the listed rows, and Excel / PDF export.
 */
@Component({
  selector: 'app-hostel-reports',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTableModule, MatTooltipModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './hostel-reports.component.html',
  styleUrl: './hostel-reports.component.scss',
})
export class HostelReportsComponent {
  readonly fmt = inject(AppFormatService);
  private readonly reports = inject(HostelReportsService);
  private readonly exporter = inject(ReportExportService);
  private readonly auth = inject(AuthService);

  readonly hostel = OWNER_HOSTEL;
  readonly tabs = HOSTEL_REPORT_TABS;
  readonly periodKey = PERIOD_KEY;

  active: HostelReportKey = 'residents';
  /** Filter values per report, so switching tabs keeps each report's filters. */
  readonly filters = {} as Record<HostelReportKey, Record<string, string>>;
  readonly search = {} as Record<HostelReportKey, string>;

  filterDefs: ReportFilterDef[] = [];
  result!: ReportResult;
  columnKeys: string[] = [];
  chips: FilterChip[] = [];
  generatedAt = new Date();

  currentPage = 0;
  pageSize = 10;

  constructor() {
    for (const t of this.tabs) {
      this.filters[t.key] = { ...this.defaults(t.key), from: '', to: '' };
      this.search[t.key] = '';
    }
    // Re-run the report whenever residents, rooms, fees or complaints change.
    this.reports.changes$.pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
  }

  get tab(): HostelReportTab {
    return this.tabs.find((t) => t.key === this.active)!;
  }

  get f(): Record<string, string> {
    return this.filters[this.active];
  }

  /** Export is offered to roles allowed to see owner reports. */
  get canExport(): boolean {
    return this.auth.isHostelOwner || this.auth.isAdmin;
  }

  get hasFilters(): boolean {
    return this.chips.some((c) => c.removable);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.result.rows.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): unknown[] {
    const start = this.safePage * this.pageSize;
    return this.result.rows.slice(start, start + this.pageSize);
  }

  select(key: HostelReportKey): void {
    if (key === this.active) return;
    this.active = key;
    this.currentPage = 0;
    this.refresh();
  }

  /** Any filter or search change. */
  apply(): void {
    this.currentPage = 0;
    this.refresh();
  }

  removeChip(key: string): void {
    if (key === 'search') this.search[this.active] = '';
    else {
      this.f[key] = this.defaults(this.active)[key];
      if (key === PERIOD_KEY) this.f['from'] = this.f['to'] = '';
    }
    this.apply();
  }

  clearFilters(): void {
    this.filters[this.active] = { ...this.defaults(this.active), from: '', to: '' };
    this.search[this.active] = '';
    this.apply();
  }

  onPageSize(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Export -----------------------------------------------------------------

  exportExcel(): void {
    const r = this.result;
    downloadReportCsv(
      `${this.hostel.name} ${this.tab.label}`,
      [
        ['Report', this.tab.label],
        ['Hostel', `${this.hostel.name} (${this.hostel.id})`],
        ['Filters applied', this.filterSummary],
        ['Generated', this.fmt.date(this.generatedAt, 'datetime')],
        ['Records', String(r.rows.length)],
        ...r.kpis.map((k): [string, string] => [k.label, k.sub ? `${k.value} (${k.sub})` : String(k.value)]),
      ],
      r.exportColumns,
      r.rows,
      r.exportTotals,
    );
  }

  /** Print-ready copy via the shared report exporter (browser "Save as PDF"). */
  exportPdf(): void {
    const r = this.result;
    const money = (v: string | number) => (typeof v === 'number' ? this.fmt.money(v) : v);
    this.exporter.exportPdf({
      title: `${this.tab.label} — ${this.hostel.name}`,
      filterSummary:
        `Hostel: ${this.hostel.name} (${this.hostel.id}) · Filters: ${this.filterSummary} · ` +
        r.kpis.map((k) => `${k.label}: ${k.value}`).join(' · '),
      columns: r.exportColumns.map((c) => ({
        header: c.header,
        numeric: c.money || c.numeric,
        value: (row: unknown) => (c.money ? money(c.value(row)) : c.value(row)),
      })),
      rows: r.rows,
      totals: r.exportTotals.map((t, i) => (r.exportColumns[i]?.money ? money(t) : t)),
    });
  }

  // ---------------------------------------------------------------------------

  private get filterSummary(): string {
    return this.chips.length ? this.chips.map((c) => c.label).join('; ') : 'None';
  }

  private refresh(): void {
    const f = this.f;
    this.filterDefs = this.reports.filtersFor(this.active);
    const range = periodRange(f[PERIOD_KEY] ?? 'All', f['from'], f['to']);
    this.result = this.reports.build(this.active, f, this.search[this.active], range);
    this.columnKeys = this.result.columns.map((c) => c.key);
    this.chips = this.buildChips();
    this.generatedAt = new Date();
  }

  /** One chip per filter that narrows the data (anything other than "All"), plus the search text. */
  private buildChips(): FilterChip[] {
    const f = this.f;
    const defaults = this.defaults(this.active);
    const chips: FilterChip[] = [];
    for (const def of this.filterDefs) {
      const value = f[def.key];
      if (value === 'All') continue;
      let text = def.options.find((o) => o.value === value)?.label ?? value;
      if (def.key === PERIOD_KEY && value === 'custom') {
        const from = f['from'] ? this.fmt.date(f['from']) : 'start';
        const to = f['to'] ? this.fmt.date(f['to']) : 'today';
        text = `${from} – ${to}`;
      }
      chips.push({ key: def.key, label: `${def.label}: ${text}`, removable: value !== defaults[def.key] });
    }
    const q = this.search[this.active].trim();
    if (q) chips.push({ key: 'search', label: `Search: "${q}"`, removable: true });
    return chips;
  }

  private defaults(key: HostelReportKey): Record<string, string> {
    return Object.fromEntries(this.reports.filtersFor(key).map((d) => [d.key, d.options[0].value]));
  }
}
