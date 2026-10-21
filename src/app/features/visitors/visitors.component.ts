import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { switchMap, timer } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { residentFullName } from '../residents/residents.models';
import { HOSTEL_ID, VisitorsService } from './visitors.service';
import { APPROVAL_STATUSES, APPROVAL_TONES, VISIT_STATUSES, VISIT_TONES, Visitor, clock, initials, localIso } from './visitors.models';
import { VisitorFormDialogComponent } from './visitor-form-dialog/visitor-form-dialog.component';
import { VisitorViewAction, VisitorViewDialogComponent } from './visitor-view-dialog/visitor-view-dialog.component';
import { VisitorActionData, VisitorActionDialogComponent, VisitorActionMode } from './visitor-action-dialog/visitor-action-dialog.component';
import { VisitorRulesDialogComponent } from './visitor-rules-dialog/visitor-rules-dialog.component';

type VisitorTab = 'today' | 'upcoming' | 'pending' | 'history';

interface VisitorFilters {
  search: string;
  status: string;
  approval: string;
}

const DEFAULT_FILTERS: VisitorFilters = { search: '', status: 'All', approval: 'All' };

/** Inside first, then expected, then closed visits. */
const STATUS_RANK: Record<Visitor['status'], number> = { 'Checked In': 0, Expected: 1, 'Checked Out': 2, Cancelled: 2 };

@Component({
  selector: 'app-visitors',
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
  templateUrl: './visitors.component.html',
  styleUrl: './visitors.component.scss',
})
export class VisitorsComponent {
  readonly service = inject(VisitorsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly columns = ['visitor', 'resident', 'purpose', 'expected', 'entry', 'approval', 'status', 'actions'];
  readonly statuses = VISIT_STATUSES;
  readonly approvals = APPROVAL_STATUSES;
  readonly initials = initials;
  readonly clock = clock;
  readonly tabs: { id: VisitorTab; label: string; icon: string }[] = [
    { id: 'today', label: 'Today', icon: 'today' },
    { id: 'upcoming', label: 'Upcoming', icon: 'event' },
    { id: 'pending', label: 'Pending Approval', icon: 'pending_actions' },
    { id: 'history', label: 'History', icon: 'history' },
  ];

  tab: VisitorTab = 'today';
  filters: VisitorFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  /** Re-read every 30 s so "inside for" times and today's figures stay current. */
  readonly stats$ = timer(0, 30_000).pipe(switchMap(() => this.service.stats$));

  get mine(): Visitor[] {
    return this.service.visitors.filter((v) => v.hostelId === HOSTEL_ID);
  }

  get inside(): Visitor[] {
    return this.mine.filter((v) => v.status === 'Checked In').sort((a, b) => (a.checkInAt ?? '').localeCompare(b.checkInAt ?? ''));
  }

  inTab(v: Visitor, tab: VisitorTab): boolean {
    const today = localIso().slice(0, 10);
    const closed = v.status === 'Checked Out' || v.status === 'Cancelled' || this.service.isMissed(v);
    switch (tab) {
      case 'today':
        return this.service.isToday(v);
      case 'upcoming':
        return v.status === 'Expected' && v.expectedAt.slice(0, 10) > today;
      case 'pending':
        return v.approval === 'Pending' && v.status === 'Expected' && !this.service.isMissed(v);
      case 'history':
        return closed;
    }
  }

  tabCount(tab: VisitorTab): number {
    return this.mine.filter((v) => this.inTab(v, tab)).length;
  }

  get filtered(): Visitor[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    const rows = this.mine.filter((v) => {
      if (!this.inTab(v, this.tab)) return false;
      if (f.status !== 'All' && v.status !== f.status) return false;
      if (f.approval !== 'All' && v.approval !== f.approval) return false;
      if (q && ![v.id, v.name, v.mobile ?? '', v.purpose, this.residentName(v)].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    // History: newest first. Otherwise inside → expected (soonest first) → closed.
    return this.tab === 'history'
      ? rows.sort((a, b) => this.lastAt(b).localeCompare(this.lastAt(a)))
      : rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.expectedAt.localeCompare(b.expectedAt));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.approval !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Visitor[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  setTab(tab: VisitorTab): void {
    this.tab = tab;
    this.currentPage = 0;
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- View helpers -----------------------------------------------------------

  residentName(v: Visitor): string {
    const r = this.service.resident(v.residentId);
    return r ? residentFullName(r) : v.residentId;
  }

  approvalTone(v: Visitor): string {
    return APPROVAL_TONES[v.approval];
  }

  statusTone(v: Visitor): string {
    return this.service.isMissed(v) ? 'warning' : VISIT_TONES[v.status];
  }

  statusLabel(v: Visitor): string {
    return this.service.isMissed(v) ? 'Not Arrived' : v.status;
  }

  /** "1h 25m" since check-in. */
  insideFor(v: Visitor): string {
    const mins = Math.max(0, Math.round((Date.now() - new Date(v.checkInAt!).getTime()) / 60_000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  canCheckIn(v: Visitor): boolean {
    return !this.service.checkInBlocker(v);
  }

  canCancel(v: Visitor): boolean {
    return v.status === 'Expected' && !this.service.isMissed(v);
  }

  private lastAt(v: Visitor): string {
    return v.history[v.history.length - 1]?.at ?? v.createdAt;
  }

  // ---- Actions ----------------------------------------------------------------

  openNew(): void {
    if (!this.service.policy.visitorsAllowed) {
      this.snackBar.open('Visitors are not allowed under the current hostel rules (Hostel Settings → Rules).', 'Close', { duration: 5000 });
      return;
    }
    this.dialog
      .open<VisitorFormDialogComponent, void, Visitor>(VisitorFormDialogComponent, { width: '760px', maxWidth: '94vw', autoFocus: false, disableClose: true })
      .afterClosed()
      .subscribe((v) => {
        if (!v) return;
        const text =
          v.status === 'Checked In'
            ? `${v.name} checked in (${v.id}).`
            : v.approval === 'Pending'
              ? `${v.id} registered and waiting for approval.`
              : `${v.id} registered for ${this.fmt.date(v.expectedAt, 'datetime')}.`;
        this.snackBar.open(text, 'View', { duration: 4500 }).onAction().subscribe(() => this.openView(v));
      });
  }

  openRules(): void {
    this.dialog
      .open(VisitorRulesDialogComponent, { width: '640px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((saved) => saved && this.snackBar.open('Visitor rules saved.', 'Close', { duration: 3500 }));
  }

  openView(v: Visitor): void {
    this.dialog
      .open<VisitorViewDialogComponent, { id: string }, VisitorViewAction>(VisitorViewDialogComponent, { width: '820px', maxWidth: '94vw', autoFocus: false, data: { id: v.id } })
      .afterClosed()
      .subscribe((action) => {
        if (action === 'checkout') this.checkOut(v);
        else if (action) this.openAction(v, action);
      });
  }

  openAction(v: Visitor, mode: VisitorActionMode): void {
    this.dialog
      .open<VisitorActionDialogComponent, VisitorActionData, Visitor>(VisitorActionDialogComponent, { width: '540px', maxWidth: '94vw', autoFocus: false, data: { id: v.id, mode } })
      .afterClosed()
      .subscribe((next) => {
        if (!next) return;
        const text: Record<VisitorActionMode, string> = {
          approve: `${next.id} approved.`,
          reject: `${next.id} rejected.`,
          checkin: `${next.name} checked in.`,
          cancel: `${next.id} cancelled.`,
        };
        this.snackBar.open(text[mode], 'Close', { duration: 3500 });
      });
  }

  checkOut(v: Visitor): void {
    this.confirm
      .confirm({
        title: 'Check out visitor?',
        message: `Record ${v.name}'s exit now.`,
        confirmLabel: 'Check Out',
        tone: 'success',
        icon: 'logout',
        details: [
          { icon: 'person', label: 'Visiting', value: this.residentName(v) },
          { icon: 'login', label: 'Checked in', value: `${this.fmt.date(v.checkInAt!, 'time')} (${this.insideFor(v)} ago)` },
        ],
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          this.service.checkOut(v.id);
          this.snackBar.open(`${v.name} checked out.`, 'Close', { duration: 3500 });
        } catch (err: any) {
          this.snackBar.open(err?.message ?? 'Could not check out.', 'Close', { duration: 4500 });
        }
      });
  }
}
