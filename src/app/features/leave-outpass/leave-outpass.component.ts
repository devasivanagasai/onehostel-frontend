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
import { HOSTEL_ID, LeaveOutpassService } from './leave-outpass.service';
import {
  APPROVAL_STATUSES,
  APPROVAL_TONES,
  LEAVE_TYPES,
  LeaveRequest,
  MOVEMENT_STATES,
  MOVEMENT_TONES,
  MovementState,
  durationLabel,
  localIso,
  time,
} from './leave-outpass.models';
import { LeaveRequestDialogComponent } from './leave-request-dialog/leave-request-dialog.component';
import { LeaveAction, LeaveActionDialogComponent, LeaveActionData } from './leave-action-dialog/leave-action-dialog.component';
import { LeaveViewDialogComponent } from './leave-view-dialog/leave-view-dialog.component';
import { LeavePolicyDialogComponent } from './leave-policy-dialog/leave-policy-dialog.component';

interface LeaveFilters {
  search: string;
  type: string;
  status: string;
  movement: string;
}

const DEFAULT_FILTERS: LeaveFilters = { search: '', type: 'All', status: 'All', movement: 'All' };

/** Needs attention first: overdue, pending, out, upcoming; then the rest newest first. */
const RANK: Record<string, number> = { 'Overdue return': 0, Pending: 1, Out: 2, 'Not yet left': 3 };

const ACTION_DONE: Record<LeaveAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  cancel: 'cancelled',
  exit: 'exit recorded',
  return: 'return recorded',
};

@Component({
  selector: 'app-leave-outpass',
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
  templateUrl: './leave-outpass.component.html',
  styleUrl: './leave-outpass.component.scss',
})
export class LeaveOutpassComponent {
  readonly service = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['resident', 'type', 'schedule', 'destination', 'approval', 'movement', 'actions'];
  readonly types = LEAVE_TYPES;
  readonly statuses = APPROVAL_STATUSES;
  readonly movements = MOVEMENT_STATES;
  readonly duration = durationLabel;

  filters: LeaveFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  /** Re-read every minute so returns flip to overdue while the page is open. */
  readonly stats$ = timer(0, 60_000).pipe(switchMap(() => this.service.stats$));

  get filtered(): LeaveRequest[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.service.requests
      .filter((r) => {
        if (r.hostelId !== HOSTEL_ID) return false;
        if (q && ![r.id, this.service.residentName(r.residentId), r.residentId, r.reason, r.destination ?? '', this.service.location(r.residentId)].join(' ').toLowerCase().includes(q)) return false;
        if (f.type !== 'All' && r.type !== f.type) return false;
        if (f.status !== 'All' && r.status !== f.status) return false;
        if (f.movement !== 'All' && this.movement(r) !== f.movement) return false;
        return true;
      })
      .sort((a, b) => this.rank(a) - this.rank(b) || b.createdAt.localeCompare(a.createdAt));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.type !== 'All' || f.status !== 'All' || f.movement !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): LeaveRequest[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
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

  movement(r: LeaveRequest): MovementState | null {
    return this.service.movement(r);
  }

  approvalTone(r: LeaveRequest): string {
    return APPROVAL_TONES[r.status];
  }

  movementTone(m: MovementState): string {
    return MOVEMENT_TONES[m];
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  /** Second line under the movement pill. */
  movementHint(r: LeaveRequest): string {
    if (r.returnedAt) return `In ${this.fmt.date(r.returnedAt, 'datetime')}`;
    if (r.exitAt) {
      if (time(r.returnAt) < Date.now()) return `Due ${this.duration(r.returnAt, localIso())} ago`;
      return `Left ${this.fmt.date(r.exitAt, 'datetime')}`;
    }
    return time(r.departAt) < Date.now() ? 'Departure time passed' : '';
  }

  canExit(r: LeaveRequest): boolean {
    return this.service.policy.movementTracking && r.status === 'Approved' && !r.exitAt && time(r.returnAt) > Date.now();
  }

  canReturn(r: LeaveRequest): boolean {
    return r.status === 'Approved' && !!r.exitAt && !r.returnedAt;
  }

  // ---- Actions ----------------------------------------------------------------

  openNew(): void {
    this.dialog
      .open<LeaveRequestDialogComponent, void, LeaveRequest>(LeaveRequestDialogComponent, { width: '760px', maxWidth: '94vw', autoFocus: false, disableClose: true })
      .afterClosed()
      .subscribe((r) => r && this.toast(`${r.id} raised for ${this.service.residentName(r.residentId)} — awaiting approval.`, r));
  }

  openView(r: LeaveRequest): void {
    this.dialog
      .open<LeaveViewDialogComponent, { id: string }, LeaveAction>(LeaveViewDialogComponent, { width: '880px', maxWidth: '94vw', autoFocus: false, data: { id: r.id } })
      .afterClosed()
      .subscribe((action) => action && this.act(r, action));
  }

  act(r: LeaveRequest, action: LeaveAction): void {
    this.dialog
      .open<LeaveActionDialogComponent, LeaveActionData, LeaveRequest>(LeaveActionDialogComponent, { width: '560px', maxWidth: '94vw', autoFocus: false, data: { id: r.id, action } })
      .afterClosed()
      .subscribe((next) => next && this.toast(`${next.id} ${ACTION_DONE[action]}.`, next));
  }

  openPolicy(): void {
    this.dialog
      .open(LeavePolicyDialogComponent, { width: '600px', maxWidth: '94vw', autoFocus: false })
      .afterClosed()
      .subscribe((saved) => saved && this.snackBar.open('Leave policy saved.', 'Close', { duration: 3500 }));
  }

  private toast(text: string, r: LeaveRequest): void {
    this.snackBar.open(text, 'View', { duration: 4500 }).onAction().subscribe(() => this.openView(r));
  }

  private rank(r: LeaveRequest): number {
    return RANK[this.movement(r) ?? r.status] ?? 9;
  }
}
