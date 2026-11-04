import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, merge } from 'rxjs';
import { AnalyticsService } from '../../core/services/analytics.service';
import { AuthService } from '../../core/services/auth.service';
import { StaffService } from '../../core/services/staff.service';
import { AppFormatService } from '../../core/services/app-format.service';
import { ResidentsService } from '../../core/services/residents.service';
import { RoomsService } from '../../core/services/rooms.service';
import { FeesService } from '../../core/services/fees.service';
import { ComplaintsService } from '../../core/services/complaints.service';
import { LeaveOutpassService } from '../../core/services/leave-outpass.service';
import { LaundryService } from '../laundry/laundry.service';
import { MessService } from '../mess/mess.service';
import {
  ALL,
  AnalyticsFilters,
  AnalyticsReport,
  AnalyticsSection,
  MOVEMENT_DEFINITION,
  MOVEMENT_KINDS,
  OCCUPANCY_DEFINITION,
  REVENUE_DEFINITION,
} from '../../core/models/analytics.models';
import { RESIDENT_STATUSES, RESIDENT_TYPES } from '../../core/models/residents.models';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

/** SVG occupancy chart geometry. */
interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  pct: number;
}

const ROOM_TYPES = ['Single', 'Double', 'Triple', 'Four Sharing', 'Dormitory'] as const;
const CHART_W = 640;
const CHART_H = 190;

/**
 * Advanced Analytics (Section 6.2). Hostel Owner only. All numbers come from AnalyticsService, which reads
 * the live records of the other modules; filters never reset each other and an invalid date range keeps
 * the last good result on screen with an inline error.
 */
@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent {
  readonly service = inject(AnalyticsService);
  readonly fmt = inject(AppFormatService);
  readonly staffStats$ = inject(StaffService).taskStats$;
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);

  readonly buildings = this.service.buildings;
  readonly roomTypes = ROOM_TYPES;
  readonly residentTypes = RESIDENT_TYPES;
  readonly residentStatuses = RESIDENT_STATUSES;
  readonly movementKinds = MOVEMENT_KINDS;
  readonly defs = { occupancy: OCCUPANCY_DEFINITION, movement: MOVEMENT_DEFINITION, revenue: REVENUE_DEFINITION };
  readonly chartW = CHART_W;
  readonly chartH = CHART_H;
  readonly all = ALL;

  filters: AnalyticsFilters = this.service.defaultFilters();
  /** Filters the shown numbers were computed with. */
  applied: AnalyticsFilters = { ...this.filters };
  report: AnalyticsReport | null = null;
  rangeError = '';
  /** Load failure (shown with Retry). */
  error = '';
  loading = true;
  bars: Bar[] = [];
  movementShown = 10;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Recompute when any underlying record set changes (new payment, checkout, booking...).
    merge(
      inject(ResidentsService).residents$,
      inject(RoomsService).rooms$,
      inject(FeesService).charges$,
      inject(FeesService).payments$,
      inject(ComplaintsService).complaints$,
      inject(LeaveOutpassService).requests$,
      inject(MessService).state$,
      inject(LaundryService).stats$,
    )
      .pipe(debounceTime(50), takeUntilDestroyed(destroyRef))
      .subscribe(() => this.refresh());
    this.refresh();
  }

  get canExport(): boolean {
    return this.auth.isHostelOwner;
  }

  get summary(): string {
    return this.service.filterSummary(this.applied);
  }

  /** Filters that narrow the data, for the chips. */
  get chips(): string[] {
    const f = this.applied;
    return [
      `${f.from} to ${f.to}`,
      f.building !== ALL ? `Building: ${f.building}` : '',
      f.roomType !== ALL ? `Room type: ${f.roomType}` : '',
      f.residentType !== ALL ? `Resident type: ${f.residentType}` : '',
      f.residentStatus !== ALL ? `Status: ${f.residentStatus}` : '',
    ].filter(Boolean);
  }

  get isDefault(): boolean {
    const d = this.service.defaultFilters();
    const f = this.filters;
    return f.from === d.from && f.to === d.to && f.building === ALL && f.roomType === ALL && f.residentType === ALL && f.residentStatus === ALL;
  }

  /** Any filter control changed. Only the date range can be invalid; other filters keep their values. */
  onFilterChange(): void {
    const errors = this.service.filterErrors(this.filters);
    this.rangeError = errors[0] ?? '';
    if (!this.rangeError) this.refresh();
  }

  reset(): void {
    this.filters = this.service.defaultFilters();
    this.onFilterChange();
  }

  retry(): void {
    this.refresh();
  }

  refresh(): void {
    if (this.service.filterErrors(this.filters).length) return;
    this.loading = true;
    try {
      this.applied = { ...this.filters };
      this.report = this.service.report(this.applied);
      this.bars = this.buildBars();
      this.error = '';
    } catch (err: any) {
      this.error = err?.message ?? 'The analytics could not be loaded.';
    }
    this.loading = false;
  }

  export(section: AnalyticsSection, format: 'excel' | 'pdf'): void {
    try {
      this.service.exportReport(section, format, this.applied);
      this.snackBar.open(format === 'excel' ? 'Excel export started.' : 'Opening the print dialog. Choose Save as PDF.', 'Close', { duration: 3500 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'The export failed.', 'Close', { duration: 4500 });
    }
  }

  // ---- View helpers -------------------------------------------------------------

  /** Width (0-100) of a bar for `value` against the largest value in its list. */
  width(value: number, max: number): number {
    return max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  }

  max(values: number[]): number {
    return Math.max(0, ...values);
  }

  hours(v: number | null): string {
    return v === null ? '—' : `${v} h`;
  }

  pct(v: number | null): string {
    return v === null ? '—' : `${v}%`;
  }

  /** Text alternative for the occupancy chart. */
  get occupancyAlt(): string {
    const pts = this.report?.occupancy.points ?? [];
    return pts.length
      ? 'Occupancy by month: ' + pts.map((p) => `${p.label} ${p.occupancyPct}% (${p.occupiedBeds} of ${p.totalBeds} beds)`).join('; ')
      : 'No occupancy data';
  }

  private buildBars(): Bar[] {
    const pts = this.report?.occupancy.points ?? [];
    if (!pts.length) return [];
    const slot = CHART_W / pts.length;
    const w = Math.min(56, slot * 0.6);
    const plotH = CHART_H - 46;
    return pts.map((p, i) => {
      const h = Math.max(2, (p.occupancyPct / 100) * plotH);
      return { x: slot * i + (slot - w) / 2, y: 22 + plotH - h, w, h, label: p.label, pct: p.occupancyPct };
    });
  }
}
