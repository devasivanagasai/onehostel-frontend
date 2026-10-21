import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { ResidentsService } from '../residents/residents.service';
import { LeaveOutpassService } from '../leave-outpass/leave-outpass.service';
import { localDate } from '../leave-outpass/leave-outpass.models';
import { AttendanceService } from './attendance.service';
import {
  ATTENDANCE_METHODS,
  AttendanceMethod,
  AttendanceRecord,
  AttendanceRow,
  AttendanceSession,
  METHOD_ICONS,
  METHOD_LABELS,
  MethodSettings,
  RECORDED_STATUSES,
  RecordedStatus,
  STATUS_TONES,
} from './attendance.models';
import { AttendanceEntryData, AttendanceEntryDialogComponent, EntryMode } from './attendance-entry-dialog/attendance-entry-dialog.component';
import { AttendanceHistoryDialogComponent } from './attendance-history-dialog/attendance-history-dialog.component';

interface AttendanceFilters {
  search: string;
  status: string;
  building: string;
}

const DEFAULT_FILTERS: AttendanceFilters = { search: '', status: 'All', building: 'All' };

/** Status filter options; "Unknown" is shown as Unmarked. */
const STATUS_FILTERS = [
  { value: 'Present', label: 'Present' },
  { value: 'Absent', label: 'Absent' },
  { value: 'On Leave', label: 'On Leave' },
  { value: 'Unknown', label: 'Unmarked' },
  { value: 'Not Expected', label: 'Not Expected' },
  { value: 'leave', label: 'With approved leave' },
  { value: 'conflict', label: 'Conflicts' },
];

const STATUS_ICONS: Record<RecordedStatus, string> = { Present: 'check_circle', Absent: 'cancel', 'On Leave': 'luggage' };

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatTableModule,
    MatMenuModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './attendance.component.html',
  styleUrl: './attendance.component.scss',
})
export class AttendanceComponent {
  readonly service = inject(AttendanceService);
  readonly leave = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);
  private readonly residents = inject(ResidentsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly columns = ['resident', 'status', 'times', 'leave', 'remarks', 'actions'];
  readonly statusFilters = STATUS_FILTERS;
  readonly recorded = RECORDED_STATUSES;
  readonly statusIcons = STATUS_ICONS;
  readonly allMethods = ATTENDANCE_METHODS;
  readonly methodLabels = METHOD_LABELS;
  readonly methodIcons = METHOD_ICONS;

  readonly today = localDate();
  private readonly date$ = new BehaviorSubject<string>(this.today);
  filters: AttendanceFilters = { ...DEFAULT_FILTERS };
  pageSize = 25;
  currentPage = 0;

  /** All rows for the selected date; rebuilt when records, leave, residents or the date change. */
  rows: AttendanceRow[] = [];
  methods: MethodSettings = { ...this.service.methods };

  constructor() {
    combineLatest([this.date$, this.service.records$, this.leave.requests$, this.residents.residents$, this.service.methods$])
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(([date]) => (this.rows = this.service.rows(date)));
  }

  get date(): string {
    return this.date$.value;
  }

  get isToday(): boolean {
    return this.date === this.today;
  }

  get buildings(): string[] {
    return [...new Set(this.rows.map((r) => r.building).filter(Boolean))].sort();
  }

  get stats() {
    const expected = this.rows.filter((r) => r.expected);
    const count = (s: string) => expected.filter((r) => r.status === s).length;
    return {
      expected: expected.length,
      present: count('Present'),
      inNow: expected.filter((r) => r.record?.sessions.some((s) => !s.out)).length,
      absent: count('Absent'),
      onLeave: count('On Leave'),
      withLeave: expected.filter((r) => r.leave).length,
      unmarked: count('Unknown'),
      conflicts: expected.filter((r) => r.conflict).length,
    };
  }

  get filtered(): AttendanceRow[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.rows.filter((r) => {
      if (q && ![r.name, r.resident.residentId, r.location, r.record?.remarks ?? ''].join(' ').toLowerCase().includes(q)) return false;
      if (f.building !== 'All' && r.building !== f.building) return false;
      if (f.status === 'leave') return !!r.leave;
      if (f.status === 'conflict') return !!r.conflict;
      return f.status === 'All' || r.status === f.status;
    });
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.building !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): AttendanceRow[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  get canRecord(): boolean {
    return this.service.manualMethods.length > 0;
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Date navigation ----------------------------------------------------------

  setDate(value: string): void {
    if (!value) return;
    this.date$.next(value > this.today ? this.today : value);
    this.currentPage = 0;
  }

  shiftDate(days: number): void {
    const d = new Date(`${this.date}T12:00:00`);
    d.setDate(d.getDate() + days);
    this.setDate(localDate(d));
  }

  // ---- View helpers -----------------------------------------------------------

  tone(row: AttendanceRow): string {
    return STATUS_TONES[row.status];
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  lastSession(row: AttendanceRow): AttendanceSession | undefined {
    const s = row.record?.sessions;
    return s?.length ? s[s.length - 1] : undefined;
  }

  methodIcon(m: AttendanceMethod): string {
    return METHOD_ICONS[m];
  }

  methodLabel(m: AttendanceMethod): string {
    return METHOD_LABELS[m];
  }

  isIn(row: AttendanceRow): boolean {
    return !!row.record?.sessions.some((s) => !s.out);
  }

  notExpectedHint(row: AttendanceRow): string {
    const r = row.resident;
    if (r.joiningDate > this.date) return `Joins ${this.fmt.date(r.joiningDate)}`;
    return r.checkOutDate ? `Left ${this.fmt.date(r.checkOutDate)}` : '';
  }

  leaveTip(row: AttendanceRow): string {
    const l = row.leave!;
    const m = this.leave.movement(l);
    return `${l.id}: ${this.fmt.date(l.departAt, 'datetime')} → ${this.fmt.date(l.returnAt, 'datetime')}. Movement: ${m ?? 'not tracked'}. Shown for reference — not proof of exit.`;
  }

  // ---- Actions ----------------------------------------------------------------

  /** Segmented control: first mark today saves straight away; anything else goes through the dialog (reason). */
  setStatus(row: AttendanceRow, status: RecordedStatus): void {
    if (!this.canRecord) return this.noMethods();
    if (row.record?.status === status) return;
    if (!row.record && this.isToday) {
      this.run(() => this.service.save(row.resident.residentId, this.date, { status, sessions: [] }, this.service.manualMethods[0]), `${row.name} marked ${status}.`);
      return;
    }
    this.openEntry(row, 'edit', status);
  }

  openEntry(row: AttendanceRow, mode: EntryMode, status?: RecordedStatus): void {
    if (!this.canRecord) return this.noMethods();
    this.dialog
      .open<AttendanceEntryDialogComponent, AttendanceEntryData, AttendanceRecord>(AttendanceEntryDialogComponent, {
        width: '600px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { residentId: row.resident.residentId, date: this.date, mode, status },
      })
      .afterClosed()
      .subscribe((rec) => {
        if (!rec) return;
        const text = mode === 'checkin' ? 'checked in' : mode === 'checkout' ? 'checked out' : row.record ? 'attendance corrected' : `marked ${rec.status}`;
        this.snackBar.open(`${row.name} ${text}.`, 'History', { duration: 4000 }).onAction().subscribe(() => this.openHistory(row));
      });
  }

  openHistory(row: AttendanceRow): void {
    const rec = this.service.recordFor(row.resident.residentId, this.date);
    if (!rec) return;
    this.dialog.open(AttendanceHistoryDialogComponent, { width: '560px', maxWidth: '94vw', autoFocus: false, data: { id: rec.id, name: row.name } });
  }

  markAllPresent(): void {
    if (!this.canRecord) return this.noMethods();
    const unmarked = this.rows.filter((r) => r.expected && !r.record);
    const withLeave = unmarked.filter((r) => r.leave).length;
    const n = unmarked.length - withLeave;
    if (!n) {
      this.snackBar.open(withLeave ? 'Only residents with approved leave are unmarked — mark them individually.' : 'Everyone is already marked.', 'Close', { duration: 4000 });
      return;
    }
    this.confirm
      .confirm({
        title: 'Mark unmarked residents Present?',
        message: `${n} resident${n === 1 ? '' : 's'} without a record today will be marked Present.`,
        confirmLabel: 'Mark Present',
        tone: 'success',
        icon: 'done_all',
        note: withLeave ? `${withLeave} resident${withLeave === 1 ? ' has' : 's have'} approved leave today and will be left unmarked.` : undefined,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.run(() => this.service.markAllPresent(this.date, this.service.manualMethods[0]), `${n} resident${n === 1 ? '' : 's'} marked Present.`);
      });
  }

  toggleMethod(m: AttendanceMethod): void {
    const next = { ...this.methods, [m]: !this.methods[m] };
    try {
      this.service.saveMethods(next);
      this.methods = next;
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not save.', 'Close', { duration: 3500 });
    }
  }

  private noMethods(): void {
    this.snackBar.open('Enable Admin or Security under Methods to record attendance here.', 'Close', { duration: 4000 });
  }

  private run(action: () => unknown, success: string): void {
    try {
      action();
      this.snackBar.open(success, 'Close', { duration: 3000 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }
}
