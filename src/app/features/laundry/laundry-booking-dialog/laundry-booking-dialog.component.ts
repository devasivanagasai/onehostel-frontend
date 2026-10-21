import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { LaundryService } from '../laundry.service';
import { LaundryBooking, LaundryUnit, Slot, addDays, clock, dayOfWeek, daysLabel, todayStr } from '../laundry.models';

export interface LaundryBookingDialogData {
  /** Pre-selected machine / service. */
  unitId?: string;
}

/** How far ahead the owner can book. */
const BOOKING_WINDOW_DAYS = 14;

/** Book a slot on a resident's behalf. Closes with the new booking. */
@Component({
  selector: 'app-laundry-booking-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './laundry-booking-dialog.component.html',
  styleUrl: './laundry-booking-dialog.component.scss',
})
export class LaundryBookingDialogComponent {
  private readonly data = inject<LaundryBookingDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(MatDialogRef<LaundryBookingDialogComponent, LaundryBooking>);
  readonly service = inject(LaundryService);
  readonly fmt = inject(AppFormatService);

  readonly clock = clock;
  readonly daysLabel = daysLabel;
  readonly minDate = todayStr();
  readonly maxDate = addDays(todayStr(), BOOKING_WINDOW_DAYS);

  readonly units = this.service.units.filter((u) => u.state === 'Active');
  readonly residents = this.service.currentResidents.map((r) => ({ id: r.residentId, name: residentFullName(r), room: this.service.roomOf(r.residentId) }));

  residentId = '';
  unitId = this.units.some((u) => u.id === this.data?.unitId) ? this.data!.unitId! : this.units[0]?.id ?? '';
  date = todayStr();
  start = '';
  items: number | null = null;
  notes = '';
  attempted = false;
  saveError = '';

  get unit(): LaundryUnit | undefined {
    return this.service.unit(this.unitId);
  }

  get slots(): Slot[] {
    return this.unitId && this.date ? this.service.slots(this.unitId, this.date) : [];
  }

  get freeCount(): number {
    return this.slots.filter((s) => !s.blocked).length;
  }

  /** Closed on the picked day (outside operating days). */
  get closedDay(): boolean {
    return !!this.unit && !!this.date && !this.unit.days.includes(dayOfWeek(this.date));
  }

  get used(): number {
    return this.unit && this.residentId && this.date ? this.service.usedQuota(this.unit, this.residentId, this.date) : 0;
  }

  get limitReached(): boolean {
    return !!this.unit && !!this.residentId && this.used >= this.unit.limitCount;
  }

  get perItem(): boolean {
    return this.unit?.priceUnit === 'per item';
  }

  get amount(): number {
    return this.unit ? this.service.amountFor(this.unit, this.items ?? 0) : 0;
  }

  get selectedEnd(): string {
    return this.slots.find((s) => s.start === this.start)?.end ?? this.start;
  }

  get selectedResident() {
    return this.residents.find((r) => r.id === this.residentId);
  }

  // Changing machine / date drops the picked slot
  pickUnit(id: string): void {
    this.unitId = id;
    this.start = '';
  }

  pickDate(date: string): void {
    this.date = date;
    this.start = '';
  }

  slotLabel(s: Slot): string {
    return s.blocked === 'Booked' ? 'Booked' : s.blocked === 'Past' ? 'Passed' : s.blocked === 'Maintenance' ? 'Blocked' : 'Free';
  }

  get errors(): Record<'resident' | 'slot' | 'items' | 'date', string> {
    const out = { resident: '', slot: '', items: '', date: '' };
    if (!this.attempted) return out;
    if (!this.residentId) out.resident = 'Select a resident';
    if (!this.date || this.date < this.minDate || this.date > this.maxDate) out.date = `Pick a date within the next ${BOOKING_WINDOW_DAYS} days`;
    if (!this.start) out.slot = 'Pick a free slot';
    if (this.perItem && !((this.items ?? 0) >= 1)) out.items = 'Enter the number of items';
    return out;
  }

  save(): void {
    this.attempted = true;
    this.saveError = '';
    if (Object.values(this.errors).some(Boolean) || this.limitReached) return;
    try {
      const b = this.service.book({ unitId: this.unitId, residentId: this.residentId, date: this.date, start: this.start, items: this.items ?? undefined, notes: this.notes });
      this.dialogRef.close(b);
    } catch (e: any) {
      // e.g. someone else took the slot meanwhile — the grid re-reads and shows it as booked
      this.saveError = e?.message ?? 'Could not book the slot.';
      this.start = '';
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
