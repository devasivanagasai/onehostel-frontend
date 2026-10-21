import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { formatMobile, residentFullName } from '../../residents/residents.models';
import { VisitorsService } from '../visitors.service';
import { ID_TYPES, MOBILE_PATTERN, PURPOSES, Visitor, VisitorIdType, VisitorInput, clock, initials, localIso, withinHours } from '../visitors.models';

interface ResidentOption {
  id: string;
  name: string;
  location: string;
  contact: string;
  onLeave: boolean;
}

/** New visitor request / walk-in. Closes with the saved visitor. */
@Component({
  selector: 'app-visitor-form-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatTooltipModule, MatAutocompleteModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './visitor-form-dialog.component.html',
  styleUrl: './visitor-form-dialog.component.scss',
})
export class VisitorFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<VisitorFormDialogComponent, Visitor>);
  readonly service = inject(VisitorsService);

  readonly policy = this.service.policy;
  readonly rules = this.service.rules;
  readonly idTypes = ID_TYPES;
  readonly purposes = PURPOSES;
  readonly initials = initials;
  readonly clock = clock;
  readonly walkInBlocked = this.rules.walkInPolicy === 'blocked';
  readonly minExpected = localIso().slice(0, 16);

  readonly residents: ResidentOption[] = this.service.currentResidents.map((r) => ({
    id: r.residentId,
    name: residentFullName(r),
    location: this.service.location(r.residentId),
    contact: formatMobile(r.mobileCode, r.mobile),
    onLeave: r.status === 'On Leave',
  }));

  readonly residentSearch = new FormControl<string | ResidentOption>('', { nonNullable: true });

  readonly form = inject(FormBuilder).nonNullable.group({
    walkIn: [false],
    name: ['', [Validators.required, Validators.maxLength(80)]],
    mobile: ['', Validators.pattern(MOBILE_PATTERN)],
    residentId: ['', Validators.required],
    purpose: ['', Validators.required],
    purposeOther: [''],
    count: [1, [Validators.required, Validators.min(1), Validators.max(this.policy.maxVisitors)]],
    expectedAt: [''],
    idType: ['' as VisitorIdType | ''],
    idReference: [''],
    overrideReason: [''],
  });

  submitted = false;
  saving = false;
  saveError = '';

  constructor() {
    // Typing again clears the picked resident until an option is chosen.
    this.residentSearch.valueChanges.subscribe((v) => {
      if (typeof v === 'string') this.form.controls.residentId.setValue('');
    });
  }

  get walkIn(): boolean {
    return this.form.controls.walkIn.value;
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

  displayResident = (r: ResidentOption | string | null): string => (typeof r === 'string' ? r : r?.name ?? '');

  onResidentSelected(e: MatAutocompleteSelectedEvent): void {
    this.form.controls.residentId.setValue((e.option.value as ResidentOption).id);
  }

  setWalkIn(on: boolean): void {
    if (on && this.walkInBlocked) return;
    this.form.controls.walkIn.setValue(on);
  }

  /** Visit time the policy is checked against: now for walk-ins. */
  get visitAt(): string {
    return this.walkIn ? localIso() : this.form.controls.expectedAt.value ? `${this.form.controls.expectedAt.value}:00` : '';
  }

  get outsideHours(): boolean {
    return !!this.visitAt && !withinHours(this.visitAt, this.policy.visitingFrom, this.policy.visitingTo);
  }

  /** What happens on save, shown above the footer. */
  get outcome(): { icon: string; text: string; tone: string } {
    if (this.walkIn) {
      return this.rules.walkInPolicy === 'allow'
        ? { icon: 'login', text: 'Walk-ins are allowed: the visitor is checked in as soon as you save.', tone: '' }
        : { icon: 'pending_actions', text: 'Walk-ins need approval: the visitor waits at the gate until approved.', tone: 'vk-note--warn' };
    }
    return this.rules.approvalRequired
      ? { icon: 'pending_actions', text: 'Approval is required: the request goes to Pending Approval.', tone: 'vk-note--info' }
      : { icon: 'event_available', text: 'No approval needed: security can check the visitor in on arrival.', tone: '' };
  }

  // ---- Inline errors (after the first save attempt or once touched) ----------------

  private show(name: 'name' | 'mobile' | 'count'): boolean {
    return this.submitted || this.form.controls[name].touched;
  }

  get nameError(): string {
    return this.show('name') && !this.form.controls.name.value.trim() ? 'Visitor name is required' : '';
  }

  get mobileError(): string {
    return this.form.controls.mobile.value && this.form.controls.mobile.invalid && this.show('mobile') ? 'Enter a valid 10-digit mobile number starting with 6–9' : '';
  }

  get residentError(): string {
    return (this.submitted || this.residentSearch.touched) && !this.form.controls.residentId.value ? 'Select the resident being visited' : '';
  }

  get purposeError(): string {
    if (!this.submitted) return '';
    const v = this.form.getRawValue();
    if (!v.purpose) return 'Purpose is required';
    return v.purpose === 'Other' && !v.purposeOther.trim() ? 'Describe the purpose' : '';
  }

  get countError(): string {
    const c = this.form.controls.count;
    if (!this.show('count')) return '';
    if (!Number.isInteger(c.value) || c.value < 1) return 'Enter a whole number of at least 1';
    return c.value > this.policy.maxVisitors ? `Hostel rules allow at most ${this.policy.maxVisitors} per visit` : '';
  }

  get expectedError(): string {
    if (this.walkIn || !this.submitted) return '';
    const v = this.form.controls.expectedAt.value;
    if (!v) return 'Pick the expected date and time';
    return new Date(v).getTime() < Date.now() - 15 * 60_000 ? 'Must not be in the past' : '';
  }

  get idError(): string {
    if (!this.submitted || !this.policy.idRequired) return '';
    const v = this.form.getRawValue();
    return !v.idType || !v.idReference.trim() ? 'ID type and reference are required by the hostel rules' : '';
  }

  get overrideError(): string {
    return this.submitted && this.outsideHours && !this.form.controls.overrideReason.value.trim() ? 'Give a reason to allow a visit outside visiting hours' : '';
  }

  // ---- Actions ----------------------------------------------------------------

  save(): void {
    this.submitted = true;
    this.form.markAllAsTouched();
    this.residentSearch.markAsTouched();
    if (this.nameError || this.mobileError || this.residentError || this.purposeError || this.countError || this.expectedError || this.idError || this.overrideError) return;
    const v = this.form.getRawValue();
    const input: VisitorInput = {
      name: v.name,
      mobile: v.mobile || undefined,
      residentId: v.residentId,
      purpose: v.purpose === 'Other' ? v.purposeOther : v.purpose,
      count: Number(v.count),
      idType: v.idType || undefined,
      idReference: v.idReference,
      expectedAt: this.visitAt,
      walkIn: v.walkIn,
      overrideReason: this.outsideHours ? v.overrideReason : undefined,
    };
    this.saving = true;
    this.saveError = '';
    try {
      this.dialogRef.close(this.service.create(input));
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the visitor.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
