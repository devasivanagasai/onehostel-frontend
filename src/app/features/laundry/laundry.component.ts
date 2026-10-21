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
import { LaundryService } from './laundry.service';
import {
  AVAILABILITY_TONES,
  BOOKING_STATUSES,
  BOOKING_TONES,
  LaundryBooking,
  LaundryUnit,
  SERVICE_TYPES,
  clock,
  daysLabel,
  todayStr,
} from './laundry.models';
import { LaundryUnitDialogComponent } from './laundry-unit-dialog/laundry-unit-dialog.component';
import { LaundryBookingDialogComponent } from './laundry-booking-dialog/laundry-booking-dialog.component';
import { LaundryStateDialogComponent, LaundryStateDialogData } from './laundry-state-dialog/laundry-state-dialog.component';

type Tab = 'bookings' | 'units';

const DEFAULT_FILTERS = { search: '', status: 'All', unit: 'All', when: 'All', type: 'All' };

/** Pending work first: requests, then confirmed by slot time; history newest first. */
const STATUS_RANK: Record<LaundryBooking['status'], number> = { Requested: 0, Confirmed: 1, Completed: 2, 'No-show': 2, Cancelled: 2 };

@Component({
  selector: 'app-laundry',
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
  templateUrl: './laundry.component.html',
  styleUrl: './laundry.component.scss',
})
export class LaundryComponent {
  readonly service = inject(LaundryService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly bookingColumns = ['booking', 'resident', 'unit', 'slot', 'status', 'charge', 'actions'];
  readonly unitColumns = ['unit', 'location', 'hours', 'pricing', 'limit', 'availability', 'actions'];
  readonly statuses = BOOKING_STATUSES;
  readonly types = SERVICE_TYPES;
  readonly availabilities = Object.keys(AVAILABILITY_TONES);
  readonly clock = clock;
  readonly daysLabel = daysLabel;

  tab: Tab = 'bookings';
  filters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  /** Re-read every minute so "Booked" availability and slot states follow the clock. */
  readonly stats$ = timer(0, 60_000).pipe(switchMap(() => this.service.stats$));

  setTab(tab: Tab): void {
    this.tab = tab;
    this.clearFilters();
  }

  // ---- Bookings -------------------------------------------------------------------

  get filteredBookings(): LaundryBooking[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    const today = todayStr();
    return this.service.bookings
      .filter((b) => {
        if (q && ![b.id, b.residentName, b.residentId, this.unitName(b.unitId)].join(' ').toLowerCase().includes(q)) return false;
        if (f.status !== 'All' && b.status !== f.status) return false;
        if (f.unit !== 'All' && b.unitId !== f.unit) return false;
        if (f.when === 'Today' && b.date !== today) return false;
        if (f.when === 'Upcoming' && b.date < today) return false;
        if (f.when === 'Past' && b.date >= today) return false;
        if (f.when === 'ToBill' && !this.service.needsBilling(b)) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (rank) return rank;
        const ka = `${a.date}${a.start}`;
        const kb = `${b.date}${b.start}`;
        return STATUS_RANK[a.status] < 2 ? ka.localeCompare(kb) : kb.localeCompare(ka);
      });
  }

  get filteredUnits(): LaundryUnit[] {
    const q = this.filters.search.trim().toLowerCase();
    return this.service.units.filter(
      (u) =>
        (!q || [u.id, u.name, u.location].join(' ').toLowerCase().includes(q)) &&
        (this.filters.type === 'All' || u.type === this.filters.type) &&
        (this.filters.status === 'All' || this.service.availability(u) === this.filters.status),
    );
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.unit !== 'All' || f.when !== 'All' || f.type !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredBookings.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get pagedBookings(): LaundryBooking[] {
    const start = this.safePage * this.pageSize;
    return this.filteredBookings.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- View helpers -----------------------------------------------------------------

  unitName(id: string): string {
    return this.service.unit(id)?.name ?? id;
  }

  unitIcon(u?: LaundryUnit): string {
    if (!u) return 'local_laundry_service';
    if (u.type === 'Laundry Service') return 'dry_cleaning';
    return /dryer/i.test(u.name) ? 'mode_fan' : 'local_laundry_service';
  }

  unitTone(u?: LaundryUnit): string {
    return u?.type === 'Laundry Service' ? 'purple' : 'teal';
  }

  bookingTone(b: LaundryBooking): string {
    return BOOKING_TONES[b.status];
  }

  availabilityTone(u: LaundryUnit): string {
    return AVAILABILITY_TONES[this.service.availability(u)];
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  /** Second line under the status. */
  statusHint(b: LaundryBooking): string {
    if (b.status === 'Cancelled') return b.notifiedAt ? 'Maintenance · resident notified' : b.cancelReason ?? '';
    if (b.status === 'Confirmed' && this.service.started(b)) return 'Awaiting completion';
    if (b.status === 'Requested') return b.createdBy === 'Resident App' ? 'From Resident App' : 'Awaiting confirmation';
    return '';
  }

  noticesFor(u: LaundryUnit): number {
    if (!u.maintenanceSince) return 0;
    const ids = new Set(this.service.bookings.filter((b) => b.unitId === u.id).map((b) => b.id));
    return this.service.notices.filter((n) => ids.has(n.bookingId) && n.at >= u.maintenanceSince!).length;
  }

  // ---- Booking actions --------------------------------------------------------------

  openBooking(unit?: LaundryUnit): void {
    this.dialog
      .open(LaundryBookingDialogComponent, { width: '920px', maxWidth: '94vw', autoFocus: false, disableClose: true, data: { unitId: unit?.id } })
      .afterClosed()
      .subscribe((b?: LaundryBooking) => {
        if (b) this.snackBar.open(`${b.id} confirmed for ${b.residentName} · ${this.fmt.date(b.date)}, ${clock(b.start)}.`, 'Close', { duration: 4500 });
      });
  }

  confirmBooking(b: LaundryBooking): void {
    this.run(() => this.service.confirm(b.id), `${b.id} confirmed.`);
  }

  complete(b: LaundryBooking): void {
    const details = [
      { icon: 'person', label: 'Resident', value: b.residentName },
      { icon: 'payments', label: 'Charge', value: b.amount > 0 ? this.fmt.money(b.amount) : 'No charge' },
    ];
    this.confirm
      .confirm({
        title: 'Mark booking complete?',
        message: b.amount > 0 ? `A one-time charge will be added to ${b.residentName}'s bill in Fees & Payments.` : 'This booking has no charge.',
        confirmLabel: 'Complete',
        tone: 'success',
        icon: 'task_alt',
        details,
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          const chargeId = this.service.complete(b.id);
          this.snackBar.open(chargeId ? `${b.id} completed · charge ${chargeId} created.` : `${b.id} completed.`, 'Close', { duration: 4500 });
        } catch (err: any) {
          this.snackBar.open(err?.message ?? 'Could not complete the booking.', 'Close', { duration: 4500 });
        }
      });
  }

  noShow(b: LaundryBooking): void {
    this.confirm
      .confirm({ title: 'Mark as no-show?', message: `${b.residentName} didn't use the ${clock(b.start)} slot. No-shows are not charged.`, confirmLabel: 'Mark No-show', tone: 'warning', icon: 'person_off' })
      .subscribe((ok) => ok && this.run(() => this.service.noShow(b.id), `${b.id} marked as no-show.`));
  }

  cancelBooking(b: LaundryBooking): void {
    this.confirm
      .confirm({
        title: 'Cancel booking?',
        message: `${b.residentName}'s slot will be released for others to book.`,
        confirmLabel: 'Cancel Booking',
        cancelLabel: 'Keep',
        danger: true,
        icon: 'event_busy',
        details: [{ icon: 'schedule', label: 'Slot', value: `${this.fmt.date(b.date)}, ${clock(b.start)} – ${clock(b.end)}` }],
      })
      .subscribe((ok) => ok && this.run(() => this.service.cancel(b.id), `${b.id} cancelled.`));
  }

  postCharge(b: LaundryBooking): void {
    try {
      const id = this.service.postCharge(b.id);
      this.snackBar.open(`Charge ${id} linked to ${b.id}.`, 'Close', { duration: 4000 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not create the charge.', 'Close', { duration: 4500 });
    }
  }

  // ---- Machine actions --------------------------------------------------------------

  openUnit(unit?: LaundryUnit): void {
    this.dialog
      .open(LaundryUnitDialogComponent, { width: '760px', maxWidth: '94vw', autoFocus: false, disableClose: true, data: { unit } })
      .afterClosed()
      .subscribe((u?: LaundryUnit) => u && this.snackBar.open(`${u.name} ${unit ? 'updated' : 'added'}.`, 'Close', { duration: 3500 }));
  }

  changeState(u: LaundryUnit, state: LaundryStateDialogData['state']): void {
    if (state === 'Active') {
      this.run(() => this.service.setState(u.id, 'Active'), `${u.name} is back in service.`);
      return;
    }
    this.dialog
      .open<LaundryStateDialogComponent, LaundryStateDialogData, number>(LaundryStateDialogComponent, {
        width: '560px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { unitId: u.id, state },
      })
      .afterClosed()
      .subscribe((affected) => {
        if (affected === undefined) return;
        const what = state === 'Maintenance' ? 'is under maintenance' : 'is inactive';
        const extra = affected ? ` ${affected} booking(s) cancelled and residents notified.` : '';
        this.snackBar.open(`${u.name} ${what}.${extra}`, 'Close', { duration: 5000 });
      });
  }

  private run(action: () => unknown, success: string): void {
    try {
      action();
      this.snackBar.open(success, 'Close', { duration: 3500 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }
}
