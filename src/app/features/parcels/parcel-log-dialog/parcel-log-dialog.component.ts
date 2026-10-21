import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { formatMobile, residentFullName } from '../../residents/residents.models';
import { ParcelsService } from '../parcels.service';
import { COURIERS, Parcel, STORAGE_SUGGESTIONS, initials } from '../parcels.models';

interface ResidentOption {
  id: string;
  name: string;
  location: string;
  contact: string;
  photoUrl?: string;
}

/** Records a parcel at the desk and (optionally) notifies the resident. Closes with the saved parcel. */
@Component({
  selector: 'app-parcel-log-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatAutocompleteModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './parcel-log-dialog.component.html',
  styleUrl: './parcel-log-dialog.component.scss',
})
export class ParcelLogDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ParcelLogDialogComponent, Parcel>);
  readonly service = inject(ParcelsService);

  readonly couriers = COURIERS;
  readonly storageSuggestions = STORAGE_SUGGESTIONS;
  readonly initials = initials;

  readonly residents: ResidentOption[] = this.service.currentResidents.map((r) => ({
    id: r.residentId,
    name: residentFullName(r),
    location: this.service.location(r.residentId),
    contact: formatMobile(r.mobileCode, r.mobile),
    photoUrl: r.photoUrl,
  }));

  readonly residentSearch = new FormControl<string | ResidentOption>('', { nonNullable: true });

  readonly form = inject(FormBuilder).nonNullable.group({
    residentId: ['', Validators.required],
    courier: ['', Validators.required],
    courierOther: [''],
    tracking: [''],
    storage: [''],
    notify: [true],
  });

  submitted = false;
  saving = false;
  saveError = '';

  constructor() {
    this.residentSearch.valueChanges.subscribe((v) => {
      if (typeof v === 'string') this.form.controls.residentId.setValue('');
    });
  }

  get selected(): ResidentOption | undefined {
    return this.residents.find((r) => r.id === this.form.controls.residentId.value);
  }

  get filteredResidents(): ResidentOption[] {
    const v = this.residentSearch.value;
    const q = (typeof v === 'string' ? v : v?.name ?? '').trim().toLowerCase();
    if (!q) return this.residents;
    const digits = q.replace(/\D/g, '');
    return this.residents.filter((r) => `${r.name} ${r.id} ${r.location}`.toLowerCase().includes(q) || (!!digits && r.contact.replace(/\D/g, '').includes(digits)));
  }

  /** Channels the arrival notice would use for the picked resident. */
  get channels(): string[] {
    const id = this.form.controls.residentId.value;
    return id ? this.service.channelsFor(id) : [];
  }

  displayResident = (r: ResidentOption | string | null): string => (typeof r === 'string' ? r : r?.name ?? '');

  onResidentSelected(e: MatAutocompleteSelectedEvent): void {
    this.form.controls.residentId.setValue((e.option.value as ResidentOption).id);
  }

  pickCourier(c: string): void {
    this.form.controls.courier.setValue(c);
  }

  get residentError(): string {
    return (this.submitted || this.residentSearch.touched) && !this.form.controls.residentId.value ? 'Select the resident the parcel is for' : '';
  }

  get courierError(): string {
    if (!this.submitted) return '';
    const v = this.form.getRawValue();
    if (!v.courier) return 'Pick the courier or sender';
    return v.courier === 'Other' && !v.courierOther.trim() ? 'Enter the courier or sender name' : '';
  }

  save(): void {
    this.submitted = true;
    this.residentSearch.markAsTouched();
    if (this.residentError || this.courierError) return;
    const v = this.form.getRawValue();
    this.saving = true;
    this.saveError = '';
    try {
      this.dialogRef.close(
        this.service.log({
          residentId: v.residentId,
          courier: v.courier === 'Other' ? v.courierOther : v.courier,
          tracking: v.tracking,
          storage: v.storage,
          notify: v.notify,
        }),
      );
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not log the parcel.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
