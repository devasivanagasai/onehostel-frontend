import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { formatMobile, residentFullName } from '../../residents/residents.models';
import { LeaveOutpassService } from '../leave-outpass.service';
import { ContactSource, LEAVE_TYPES, LeaveContact, LeaveRequest, LeaveType, REASON_MAX, durationLabel, localIso } from '../leave-outpass.models';

interface ResidentOption {
  id: string;
  name: string;
  location: string;
  photoUrl?: string;
  contacts: LeaveContact[];
}

const TYPE_ICONS: Record<LeaveType, string> = { Leave: 'luggage', Outpass: 'directions_walk' };

/** Staff raise a leave / outpass request on a resident's behalf. It starts Pending. */
@Component({
  selector: 'app-leave-request-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatAutocompleteModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './leave-request-dialog.component.html',
  styleUrl: './leave-request-dialog.component.scss',
})
export class LeaveRequestDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<LeaveRequestDialogComponent, LeaveRequest>);
  readonly service = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);

  readonly types = LEAVE_TYPES;
  readonly typeIcons = TYPE_ICONS;
  readonly reasonMax = REASON_MAX;
  readonly policy = this.service.policy;

  readonly residents: ResidentOption[] = this.service.eligibleResidents.map((r) => ({
    id: r.residentId,
    name: residentFullName(r),
    location: this.service.location(r.residentId),
    photoUrl: r.photoUrl,
    contacts: this.service.contactsFor(r),
  }));

  readonly residentSearch = new FormControl<string | ResidentOption>('', { nonNullable: true });

  readonly form = inject(FormBuilder).nonNullable.group({
    residentId: ['', Validators.required],
    type: ['Leave' as LeaveType],
    reason: ['', [Validators.required, Validators.maxLength(REASON_MAX)]],
    departAt: [''],
    returnAt: [''],
    destination: [''],
    contact: ['' as ContactSource | ''],
    otherName: [''],
    otherMobile: [''],
    otherRelationship: [''],
    otherReason: [''],
  });

  readonly minDepart = localIso().slice(0, 16);
  attempted = false;
  saving = false;
  saveError = '';

  constructor() {
    this.residentSearch.valueChanges.subscribe((v) => {
      if (typeof v === 'string') this.form.patchValue({ residentId: '', contact: '' });
    });
  }

  get selected(): ResidentOption | undefined {
    return this.residents.find((r) => r.id === this.form.controls.residentId.value);
  }

  get filteredResidents(): ResidentOption[] {
    const v = this.residentSearch.value;
    const q = (typeof v === 'string' ? v : v?.name || '').trim().toLowerCase();
    return q ? this.residents.filter((r) => `${r.name} ${r.id} ${r.location}`.toLowerCase().includes(q)) : this.residents;
  }

  displayResident = (r: ResidentOption | string | null): string => (typeof r === 'string' ? r : r?.name ?? '');

  onResidentSelected(e: MatAutocompleteSelectedEvent): void {
    const r = e.option.value as ResidentOption;
    // Prefill the authorised contact already on the profile; "Other" only when there is none.
    this.form.patchValue({ residentId: r.id, contact: r.contacts[0]?.source ?? 'Other' });
  }

  get type(): LeaveType {
    return this.form.controls.type.value;
  }

  get destinationRequired(): boolean {
    return this.policy.destinationRequired[this.type];
  }

  get guardianNote(): string {
    return this.selected ? this.service.guardianBlock(this.selected.id) : '';
  }

  get duration(): string {
    const { departAt, returnAt } = this.form.getRawValue();
    return departAt && returnAt && !this.timeErrors.depart && !this.timeErrors.return ? durationLabel(departAt, returnAt) : '';
  }

  // ---- Validation (shown once Submit was tried or the field was touched) ----

  private show(name: 'reason' | 'departAt' | 'returnAt' | 'destination'): boolean {
    return this.attempted || this.form.controls[name].touched;
  }

  get residentError(): string {
    return (this.attempted || this.residentSearch.touched) && !this.selected ? 'Pick a resident from the list' : '';
  }

  get reasonError(): string {
    if (!this.show('reason')) return '';
    return this.form.controls.reason.value.trim() ? '' : 'Reason is required';
  }

  private get timeErrors() {
    const v = this.form.getRawValue();
    return this.service.checkTimes(this.type, v.departAt ? `${v.departAt}:00` : '', v.returnAt ? `${v.returnAt}:00` : '');
  }

  get departError(): string {
    return this.show('departAt') ? this.timeErrors.depart ?? '' : '';
  }

  get returnError(): string {
    return this.show('returnAt') || (this.form.controls.departAt.value && this.form.controls.returnAt.value) ? this.timeErrors.return ?? '' : '';
  }

  get destinationError(): string {
    return this.show('destination') && this.destinationRequired && !this.form.controls.destination.value.trim() ? `Destination is required for ${this.type.toLowerCase()}` : '';
  }

  get otherErrors(): { name?: string; mobile?: string; reason?: string } {
    const v = this.form.getRawValue();
    if (v.contact !== 'Other' || !this.attempted) return {};
    return {
      name: v.otherName.trim() ? undefined : 'Contact name is required',
      mobile: /^\d{10}$/.test(v.otherMobile.trim()) ? undefined : 'Enter a 10-digit mobile number',
      reason: v.otherReason.trim() ? undefined : 'Say why the profile contact is not used',
    };
  }

  setType(t: LeaveType): void {
    this.form.controls.type.setValue(t);
  }

  setContact(c: ContactSource): void {
    this.form.controls.contact.setValue(c);
  }

  // ---- Submit -----------------------------------------------------------------

  submit(): void {
    this.attempted = true;
    this.form.markAllAsTouched();
    this.residentSearch.markAsTouched();
    const o = this.otherErrors;
    if (this.residentError || this.reasonError || this.departError || this.returnError || this.destinationError || o.name || o.mobile || o.reason) return;

    const v = this.form.getRawValue();
    const r = this.selected!;
    const contact: LeaveContact =
      v.contact === 'Other'
        ? { source: 'Other', name: v.otherName.trim(), mobile: formatMobile('+91', v.otherMobile.trim()), relationship: v.otherRelationship.trim() || undefined, reason: v.otherReason.trim() }
        : r.contacts.find((c) => c.source === v.contact)!;

    this.saving = true;
    this.saveError = '';
    try {
      const created = this.service.create({
        residentId: r.id,
        type: v.type,
        reason: v.reason,
        departAt: `${v.departAt}:00`,
        returnAt: `${v.returnAt}:00`,
        destination: v.destination,
        contact,
      });
      this.dialogRef.close(created);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the request.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }
}
