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
import { HOSTEL_ID, ParcelsService } from './parcels.service';
import {
  COURIERS,
  NOTIFICATION_ICONS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TONES,
  OVERDUE_DAYS,
  PICKUP_STATUSES,
  PICKUP_TONES,
  Parcel,
  initials,
  localIso,
} from './parcels.models';
import { ParcelLogDialogComponent } from './parcel-log-dialog/parcel-log-dialog.component';
import { ParcelHandoverData, ParcelHandoverDialogComponent } from './parcel-handover-dialog/parcel-handover-dialog.component';
import { ParcelViewAction, ParcelViewDialogComponent } from './parcel-view-dialog/parcel-view-dialog.component';

interface ParcelFilters {
  search: string;
  status: string;
  notification: string;
  courier: string;
  age: string;
}

const DEFAULT_FILTERS: ParcelFilters = { search: '', status: 'Awaiting Pickup', notification: 'All', courier: 'All', age: 'All' };

@Component({
  selector: 'app-parcels',
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
  templateUrl: './parcels.component.html',
  styleUrl: './parcels.component.scss',
})
export class ParcelsComponent {
  readonly service = inject(ParcelsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly columns = ['resident', 'parcel', 'storage', 'received', 'notification', 'pickup', 'actions'];
  readonly statuses = PICKUP_STATUSES;
  readonly notificationStatuses = NOTIFICATION_STATUSES;
  readonly overdueDays = OVERDUE_DAYS;
  readonly initials = initials;
  readonly ageOptions = [
    { value: 'today', label: 'Received today' },
    { value: 'recent', label: `1–${OVERDUE_DAYS} days` },
    { value: 'overdue', label: `Overdue (> ${OVERDUE_DAYS} days)` },
  ];

  /** Uncollected parcels are the working list, so that's the default view. */
  filters: ParcelFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  /** Re-read every 30 s so ages and "read" notification states move on while the page is open. */
  readonly stats$ = timer(0, 30_000).pipe(switchMap(() => this.service.stats$));

  get mine(): Parcel[] {
    return this.service.parcels.filter((p) => p.hostelId === HOSTEL_ID);
  }

  /** Couriers seen in the log plus the common list. */
  get couriers(): string[] {
    return [...new Set([...COURIERS, ...this.mine.map((p) => p.courier)])].sort();
  }

  get filtered(): Parcel[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.mine
      .filter((p) => {
        if (f.status !== 'All' && p.status !== f.status) return false;
        if (f.notification !== 'All' && this.service.notificationStatus(p) !== f.notification) return false;
        if (f.courier !== 'All' && p.courier !== f.courier) return false;
        if (f.age !== 'All' && !this.matchesAge(p, f.age)) return false;
        if (q && ![p.id, p.courier, p.tracking ?? '', p.storage ?? '', this.residentName(p), this.service.location(p.residentId)].join(' ').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => this.rank(a) - this.rank(b) || (a.status === 'Awaiting Pickup' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt)));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== DEFAULT_FILTERS.status || f.notification !== 'All' || f.courier !== 'All' || f.age !== 'All';
  }

  /** Awaiting parcels in the current view that can be reminded now. */
  get remindable(): Parcel[] {
    return this.filtered.filter((p) => !this.service.reminderBlocker(p));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Parcel[] {
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

  residentName(p: Parcel): string {
    const r = this.service.resident(p.residentId);
    return r ? residentFullName(r) : p.residentId;
  }

  photo(p: Parcel): string | undefined {
    return this.service.resident(p.residentId)?.photoUrl;
  }

  notice(p: Parcel) {
    const s = this.service.notificationStatus(p);
    return { status: s, tone: NOTIFICATION_TONES[s], icon: NOTIFICATION_ICONS[s] };
  }

  pickupTone(p: Parcel): string {
    return PICKUP_TONES[p.status];
  }

  ageLabel(p: Parcel): string {
    const d = this.service.ageDays(p);
    if (p.status !== 'Awaiting Pickup') return d === 0 ? 'Same day' : `Held ${d}d`;
    return d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`;
  }

  ageTone(p: Parcel): string {
    if (p.status !== 'Awaiting Pickup') return 'muted';
    return this.service.isOverdue(p) ? 'red' : this.service.ageDays(p) >= 1 ? 'amber' : 'green';
  }

  /** Second line under the notification badge. */
  noticeHint(p: Parcel): string {
    if (p.reminderCount) return `${p.reminderCount} reminder${p.reminderCount === 1 ? '' : 's'} · ${this.fmt.date(p.lastReminderAt!)}`;
    return p.notices.length ? this.fmt.date(p.notices[0].at, 'time') : '';
  }

  private matchesAge(p: Parcel, age: string): boolean {
    const d = this.service.ageDays(p);
    if (age === 'today') return p.receivedAt.slice(0, 10) === localIso().slice(0, 10);
    if (age === 'recent') return d >= 1 && d <= OVERDUE_DAYS;
    return this.service.isOverdue(p);
  }

  /** Awaiting first (oldest first, so overdue rises to the top); then the rest newest first. */
  private rank(p: Parcel): number {
    return p.status === 'Awaiting Pickup' ? 0 : 1;
  }

  // ---- Actions ----------------------------------------------------------------

  openLog(): void {
    this.dialog
      .open<ParcelLogDialogComponent, void, Parcel>(ParcelLogDialogComponent, { width: '680px', maxWidth: '94vw', autoFocus: false, disableClose: true })
      .afterClosed()
      .subscribe((p) => {
        if (!p) return;
        const s = this.service.notificationStatus(p);
        const tail = s === 'Failed' ? ' The notification failed — check the resident’s contact details.' : s === 'Not Sent' ? '' : ' Resident notified.';
        this.snackBar.open(`${p.id} logged for ${this.residentName(p)}.${tail}`, 'View', { duration: 5000 }).onAction().subscribe(() => this.openView(p));
      });
  }

  openView(p: Parcel): void {
    this.dialog
      .open<ParcelViewDialogComponent, { id: string }, ParcelViewAction>(ParcelViewDialogComponent, { width: '820px', maxWidth: '94vw', autoFocus: false, data: { id: p.id } })
      .afterClosed()
      .subscribe((action) => {
        if (action === 'remind') this.remind(p);
        else if (action) this.openHandover(p, action);
      });
  }

  openHandover(p: Parcel, mode: ParcelHandoverData['mode']): void {
    this.dialog
      .open<ParcelHandoverDialogComponent, ParcelHandoverData, Parcel>(ParcelHandoverDialogComponent, { width: '600px', maxWidth: '94vw', autoFocus: false, data: { id: p.id, mode } })
      .afterClosed()
      .subscribe((next) => {
        if (!next) return;
        const text = mode === 'collect' ? `${next.id} marked as collected by ${next.collector?.name}.` : `${next.id} returned to sender.`;
        this.snackBar.open(text, 'Close', { duration: 3500 });
      });
  }

  remind(p: Parcel): void {
    try {
      const next = this.service.remind(p.id);
      const failed = this.service.notificationStatus(next) === 'Failed';
      this.snackBar.open(failed ? `Reminder for ${next.id} failed — no contact details.` : `Reminder sent to ${this.residentName(next)}.`, 'Close', { duration: 3500 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not send the reminder.', 'Close', { duration: 4500 });
    }
  }

  remindAll(): void {
    const list = this.remindable;
    if (!list.length) return;
    const people = new Set(list.map((p) => p.residentId)).size;
    const overdue = list.filter((p) => this.service.isOverdue(p)).length;
    this.confirm
      .confirm({
        title: 'Send pickup reminders?',
        message: `${list.length} parcel${list.length === 1 ? '' : 's'} in the current view will get a reminder.`,
        confirmLabel: 'Send Reminders',
        tone: 'success',
        icon: 'notifications_active',
        details: [
          { icon: 'group', label: 'Residents', value: String(people) },
          { icon: 'warning', label: `Overdue (> ${OVERDUE_DAYS} days)`, value: String(overdue) },
        ],
        note: 'Parcels notified in the last few hours are skipped.',
      })
      .subscribe((ok) => {
        if (!ok) return;
        const r = this.service.remindMany(list.map((p) => p.id));
        const parts = [`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent`];
        if (r.failed) parts.push(`${r.failed} failed`);
        if (r.skipped) parts.push(`${r.skipped} skipped`);
        this.snackBar.open(parts.join(' · ') + '.', 'Close', { duration: 4000 });
      });
  }
}
