import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { LaundryService } from '../laundry.service';
import { LaundryServiceType, LaundryUnit, PRICE_UNITS, PriceUnit, SERVICE_TYPES, WEEK_DAYS, toMinutes } from '../laundry.models';

export interface LaundryUnitDialogData {
  unit?: LaundryUnit;
}

/** Add / edit a machine or laundry service. Closes with the saved unit. */
@Component({
  selector: 'app-laundry-unit-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './laundry-unit-dialog.component.html',
  styleUrl: './laundry-unit-dialog.component.scss',
})
export class LaundryUnitDialogComponent {
  private readonly data = inject<LaundryUnitDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LaundryUnitDialogComponent, LaundryUnit>);
  readonly service = inject(LaundryService);

  readonly types = SERVICE_TYPES;
  readonly priceUnits = PRICE_UNITS;
  readonly weekDays = WEEK_DAYS;
  readonly locations = this.service.locationSuggestions;

  readonly existing = this.data?.unit;
  readonly isEdit = !!this.existing;

  readonly form = inject(FormBuilder).nonNullable.group({
    type: [(this.existing?.type ?? 'Self-service Machine') as LaundryServiceType],
    name: [this.existing?.name ?? '', [Validators.required, Validators.maxLength(60)]],
    location: [this.existing?.location ?? '', Validators.required],
    price: [this.existing?.price ?? 50, Validators.min(0)],
    priceUnit: [(this.existing?.priceUnit ?? 'per load') as PriceUnit],
    slotMinutes: [this.existing?.slotMinutes ?? 60, [Validators.required, Validators.min(5)]],
    openTime: [this.existing?.openTime ?? '07:00', Validators.required],
    closeTime: [this.existing?.closeTime ?? '22:00', Validators.required],
    limitCount: [this.existing?.limitCount ?? 1, [Validators.required, Validators.min(1)]],
    limitPeriod: [(this.existing?.limitPeriod ?? 'day') as 'day' | 'week'],
  });

  days: number[] = [...(this.existing?.days ?? [0, 1, 2, 3, 4, 5, 6])];
  attempted = false;
  saveError = '';

  get isService(): boolean {
    return this.form.controls.type.value === 'Laundry Service';
  }

  setType(t: LaundryServiceType): void {
    this.form.controls.type.setValue(t);
    // Sensible defaults when switching on a new record
    if (!this.isEdit) this.form.patchValue(t === 'Laundry Service' ? { priceUnit: 'per item', slotMinutes: 30, limitPeriod: 'week' } : { priceUnit: 'per load', slotMinutes: 60, limitPeriod: 'day' });
  }

  toggleDay(d: number): void {
    this.days = this.days.includes(d) ? this.days.filter((x) => x !== d) : [...this.days, d];
  }

  // ---- Errors (shown after Save was tried) ---------------------------------------

  err(field: 'name' | 'location' | 'price' | 'slotMinutes' | 'hours' | 'days' | 'limitCount'): string {
    if (!this.attempted) return '';
    const v = this.form.getRawValue();
    switch (field) {
      case 'name':
        return v.name.trim() ? '' : 'Name is required';
      case 'location':
        return v.location.trim() ? '' : 'Location is required';
      case 'price':
        if (v.price < 0) return "Price can't be negative";
        return this.isService && !(v.price > 0) ? 'A laundry service needs a price' : '';
      case 'slotMinutes':
        return v.slotMinutes > 0 ? '' : 'Enter a positive duration';
      case 'hours':
        return toMinutes(v.closeTime) - toMinutes(v.openTime) >= v.slotMinutes ? '' : 'Hours must fit at least one slot';
      case 'days':
        return this.days.length ? '' : 'Pick at least one day';
      case 'limitCount':
        return v.limitCount >= 1 ? '' : 'At least 1';
    }
  }

  /** How many slots a day gives — shown as a hint. */
  get slotsPerDay(): number {
    const v = this.form.getRawValue();
    const span = toMinutes(v.closeTime) - toMinutes(v.openTime);
    return v.slotMinutes > 0 && span > 0 ? Math.floor(span / v.slotMinutes) : 0;
  }

  save(): void {
    this.attempted = true;
    const fields = ['name', 'location', 'price', 'slotMinutes', 'hours', 'days', 'limitCount'] as const;
    if (fields.some((f) => this.err(f))) return;
    const v = this.form.getRawValue();
    try {
      const saved = this.service.saveUnit(
        { ...v, price: Number(v.price) || 0, slotMinutes: Number(v.slotMinutes), limitCount: Number(v.limitCount), days: this.days },
        this.existing?.id,
      );
      this.dialogRef.close(saved);
    } catch (e: any) {
      this.saveError = e?.message ?? 'Could not save.';
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
