import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { GuardiansService } from '../../../core/services/guardians.service';
import { residentFullName } from '../../../core/models/residents.models';
import { localDateIso } from '../../../shared/utils/local-date';
import {
  ACCESS_SCOPES,
  AccessScope,
  CONSENT_CHANNELS,
  ConsentChannel,
  EMAIL_PATTERN,
  GUARDIAN_RELATIONSHIP_OPTIONS,
  Guardian,
  GuardianRelationship,
  MOBILE_PATTERN,
} from '../../../core/models/guardians.models';

interface ResidentOption {
  id: string;
  name: string;
  status: string;
}

export interface GuardianFormData {
  /** Present when editing. */
  id?: string;
  /** Pre-selected resident when adding for a known resident. */
  residentId?: string;
}

const CONSENT_ICONS: Record<ConsentChannel, string> = { SMS: 'sms', Email: 'mail', Push: 'notifications', None: 'notifications_off' };

/** Add or edit a guardian linked to one resident. Verification status is system-managed and not editable here. */
@Component({
  selector: 'app-guardian-form-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatAutocompleteModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './guardian-form-dialog.component.html',
  styleUrl: './guardian-form-dialog.component.scss',
})
export class GuardianFormDialogComponent {
  private readonly data = inject<GuardianFormData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(MatDialogRef<GuardianFormDialogComponent, Guardian>);
  readonly service = inject(GuardiansService);

  readonly existing: Guardian | undefined = this.data?.id ? this.service.byId(this.data.id) : undefined;
  readonly isEdit = !!this.existing;
  readonly relationships = GUARDIAN_RELATIONSHIP_OPTIONS;
  readonly channels = CONSENT_CHANNELS;
  readonly consentIcons = CONSENT_ICONS;
  readonly scopes = ACCESS_SCOPES;
  readonly today = localDateIso();

  readonly residents: ResidentOption[] = this.service.linkableResidents.map((r) => ({ id: r.residentId, name: residentFullName(r), status: r.status }));
  readonly residentSearch = new FormControl<string | ResidentOption>('', { nonNullable: true });

  readonly form = inject(FormBuilder).nonNullable.group({
    residentId: [this.existing?.residentId ?? this.data?.residentId ?? ''],
    name: [this.existing?.name ?? ''],
    relationship: [(this.existing?.relationship ?? 'Parent') as GuardianRelationship],
    mobile: [this.existing?.mobile ?? ''],
    email: [this.existing?.email ?? ''],
    primary: [this.existing?.primary ?? false],
    consent: [(this.existing?.consent ?? 'SMS') as ConsentChannel],
    consentDate: [this.existing?.consentDate ?? localDateIso()],
    scope: [[...(this.existing?.scope ?? [])] as AccessScope[]],
  });

  attempted = false;
  saving = false;
  saveError = '';

  constructor() {
    const pre = this.residents.find((r) => r.id === this.form.controls.residentId.value);
    if (pre) this.residentSearch.setValue(pre);
    this.residentSearch.valueChanges.subscribe((v) => {
      if (typeof v === 'string') this.form.controls.residentId.setValue('');
    });
  }

  get selected(): ResidentOption | undefined {
    return this.residents.find((r) => r.id === this.form.controls.residentId.value);
  }

  get filteredResidents(): ResidentOption[] {
    const v = this.residentSearch.value;
    const q = (typeof v === 'string' ? v : v?.name || '').trim().toLowerCase();
    return q ? this.residents.filter((r) => `${r.name} ${r.id}`.toLowerCase().includes(q)) : this.residents;
  }

  displayResident = (r: ResidentOption | string | null): string => (typeof r === 'string' ? r : r ? `${r.name} (${r.id})` : '');

  onResidentSelected(e: MatAutocompleteSelectedEvent): void {
    this.form.controls.residentId.setValue((e.option.value as ResidentOption).id);
  }

  /** The first guardian of a resident is always primary. */
  get firstForResident(): boolean {
    const id = this.form.controls.residentId.value;
    return !this.isEdit && !!id && this.service.byResident(id).length === 0;
  }

  get lockedPrimary(): boolean {
    return this.firstForResident || !!this.existing?.primary;
  }

  get primaryValue(): boolean {
    return this.lockedPrimary || this.form.controls.primary.value;
  }

  get currentPrimary(): Guardian | undefined {
    const id = this.form.controls.residentId.value;
    return id ? this.service.byResident(id).find((g) => g.primary && g.id !== this.existing?.id) : undefined;
  }

  get contactChangeResets(): boolean {
    const e = this.existing;
    if (!e || e.verification === 'Unverified') return false;
    const v = this.form.getRawValue();
    return (v.mobile.trim() || undefined) !== e.mobile || (v.email.trim() || undefined) !== e.email;
  }

  // ---- Validation (shown once Save was tried or the field was touched) ---------------

  private show(name: 'name' | 'mobile' | 'email' | 'consentDate'): boolean {
    return this.attempted || this.form.controls[name].touched;
  }

  get residentError(): string {
    return !this.isEdit && (this.attempted || this.residentSearch.touched) && !this.selected ? 'Pick a resident from the list' : '';
  }

  get nameError(): string {
    return this.show('name') && !this.form.controls.name.value.trim() ? 'Guardian name is required' : '';
  }

  get mobileError(): string {
    const m = this.form.controls.mobile.value.trim();
    return this.show('mobile') && m && !MOBILE_PATTERN.test(m) ? 'Enter a 10-digit mobile number' : '';
  }

  get emailError(): string {
    const e = this.form.controls.email.value.trim();
    return this.show('email') && e && !EMAIL_PATTERN.test(e) ? 'Enter a valid email address' : '';
  }

  get contactError(): string {
    const v = this.form.getRawValue();
    return this.attempted && !v.mobile.trim() && !v.email.trim() ? 'Enter a mobile number or an email' : '';
  }

  get scopeError(): string {
    return this.attempted && !this.form.controls.scope.value.length ? 'Choose at least one item the guardian may see' : '';
  }

  get consentDateError(): string {
    const d = this.form.controls.consentDate.value;
    if (!this.show('consentDate')) return '';
    if (!d) return 'Enter the date consent was captured';
    return d > this.today ? 'Consent date cannot be in the future' : '';
  }

  isScopeOn(s: AccessScope): boolean {
    return this.form.controls.scope.value.includes(s);
  }

  toggleScope(s: AccessScope): void {
    const cur = this.form.controls.scope.value;
    this.form.controls.scope.setValue(cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
  }

  setRelationship(r: GuardianRelationship): void {
    this.form.controls.relationship.setValue(r);
  }

  setConsent(c: ConsentChannel): void {
    this.form.controls.consent.setValue(c);
  }

  setPrimary(checked: boolean): void {
    this.form.controls.primary.setValue(checked);
  }

  // ---- Submit ------------------------------------------------------------------------

  submit(): void {
    this.attempted = true;
    this.form.markAllAsTouched();
    this.residentSearch.markAsTouched();
    if (this.residentError || this.nameError || this.mobileError || this.emailError || this.contactError || this.scopeError || this.consentDateError) return;
    const v = this.form.getRawValue();
    this.saving = true;
    this.saveError = '';
    try {
      const input = {
        residentId: v.residentId,
        name: v.name,
        relationship: v.relationship,
        mobile: v.mobile.trim() || undefined,
        email: v.email.trim() || undefined,
        primary: this.primaryValue,
        consent: v.consent,
        consentDate: v.consentDate,
        scope: v.scope,
      };
      const saved = this.existing ? this.service.update(this.existing.id, input) : this.service.create(input);
      this.dialogRef.close(saved);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the guardian.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
