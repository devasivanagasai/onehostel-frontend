import { Component, HostListener, inject } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, of } from 'rxjs';
import { UnsavedChangesAware } from '../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { HostelSettingsService } from './hostel-settings.service';
import {
  HostelSettingsSection,
  HostelSettingsState,
  HostelSettingsValue,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  facilityBlockedReason,
} from './hostel-settings.models';
import { ProfileSectionComponent } from './profile-section.component';
import { RulesSectionComponent, houseRuleControl } from './rules-section.component';
import { FacilitiesSectionComponent } from './facilities-section.component';
import { NotificationsSectionComponent } from './notifications-section.component';
import { SubscriptionSectionComponent } from './subscription-section.component';
import { SecuritySectionComponent } from './security-section.component';

interface SectionNavItem {
  key: HostelSettingsSection;
  label: string;
  icon: string;
  description: string;
}

/** Sections whose fields are part of the form (Subscription and Security are read-only / links). */
const FORM_SECTIONS: Partial<Record<HostelSettingsSection, string>> = {
  profile: 'profile',
  rules: 'rules',
  facilities: 'facilities',
  notifications: 'notifications',
};

const toMinutes = (t: string): number => {
  const [h, m] = (t || '').split(':').map(Number);
  return h * 60 + m;
};

/** Check-out must come before check-in (the bed is turned around in between); visiting hours must be a real range. */
const rulesValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const v = (group as FormGroup).getRawValue();
  const errors: ValidationErrors = {};
  if (v.checkInTime && v.checkOutTime && toMinutes(v.checkOutTime) >= toMinutes(v.checkInTime)) {
    errors['checkOutOrder'] = true;
  }
  if (v.visitorsAllowed && v.visitingFrom && v.visitingTo && toMinutes(v.visitingTo) <= toMinutes(v.visitingFrom)) {
    errors['visitingRange'] = true;
  }
  return Object.keys(errors).length ? errors : null;
};

/** Each event keeps at least one usable channel switched on. */
const atLeastOneChannel: ValidatorFn = (group: AbstractControl): ValidationErrors | null =>
  Object.values((group as FormGroup).value as Record<string, boolean>).some(Boolean) ? null : { noChannel: true };

@Component({
  selector: 'app-hostel-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    AppButtonComponent,
    ProfileSectionComponent,
    RulesSectionComponent,
    FacilitiesSectionComponent,
    NotificationsSectionComponent,
    SubscriptionSectionComponent,
    SecuritySectionComponent,
  ],
  templateUrl: './hostel-settings.component.html',
  styleUrl: './hostel-settings.component.scss',
})
export class HostelSettingsComponent implements UnsavedChangesAware {
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirmDialog = inject(ConfirmDialogService);
  readonly service = inject(HostelSettingsService);

  readonly sections: SectionNavItem[] = [
    { key: 'profile', label: 'Hostel Profile', icon: 'apartment', description: 'Logo, name, address and contact details residents see.' },
    { key: 'rules', label: 'Rules & Policies', icon: 'gavel', description: 'Check-in / out times, visitor policy and house rules.' },
    { key: 'facilities', label: 'Facilities', icon: 'local_convenience_store', description: 'Facilities your hostel offers, within your plan.' },
    { key: 'notifications', label: 'Notifications', icon: 'notifications_active', description: 'Which events notify you, and on which channels.' },
    { key: 'subscription', label: 'Subscription', icon: 'workspace_premium', description: 'Your plan, limits and usage. Managed by OneHostel.' },
    { key: 'security', label: 'Security', icon: 'lock', description: 'Your sign-in password and the policy it must meet.' },
  ];

  active: HostelSettingsSection = 'profile';
  state: HostelSettingsState = this.service.state;

  readonly form = this.fb.nonNullable.group({
    profile: this.fb.nonNullable.group({
      hostelName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]],
      logoDataUrl: [''],
      logoFileName: [''],
      addressLine1: ['', [Validators.required, Validators.maxLength(120)]],
      addressLine2: ['', Validators.maxLength(120)],
      city: ['', [Validators.required, Validators.maxLength(60), Validators.pattern(/^[A-Za-z][A-Za-z .'-]*$/)]],
      state: ['', Validators.required],
      pincode: ['', [Validators.required, Validators.pattern(/^[1-9]\d{5}$/)]],
      phone: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
      email: ['', [Validators.required, Validators.email, Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/)]],
      website: ['', Validators.pattern(/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i)],
    }),
    rules: this.fb.nonNullable.group(
      {
        checkInTime: ['', Validators.required],
        checkOutTime: ['', Validators.required],
        gateClosingTime: ['', Validators.required],
        visitorsAllowed: [true],
        visitingFrom: ['', Validators.required],
        visitingTo: ['', Validators.required],
        maxVisitors: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
        visitorIdRequired: [true],
        houseRules: this.fb.nonNullable.array<string>([]),
      },
      { validators: rulesValidator },
    ),
    facilities: this.fb.nonNullable.control<string[]>([]),
    notifications: this.fb.nonNullable.group(
      Object.fromEntries(
        NOTIFICATION_EVENTS.map((e) => [
          e.key,
          this.fb.nonNullable.group(
            Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c.key, this.fb.nonNullable.control(false)])),
            { validators: atLeastOneChannel },
          ),
        ]),
      ),
    ),
  });

  constructor() {
    this.load(this.state);
    // Visiting hours only matter while visitors are allowed.
    this.form.controls.rules.controls.visitorsAllowed.valueChanges.subscribe(() => this.syncVisitorControls());
  }

  get dirty(): boolean {
    return this.form.dirty;
  }

  get invalidCount(): number {
    return this.sections.filter((s) => this.sectionInvalid(s.key)).length;
  }

  section(key: HostelSettingsSection): SectionNavItem {
    return this.sections.find((s) => s.key === key)!;
  }

  private sectionControl(key: HostelSettingsSection): AbstractControl | null {
    const name = FORM_SECTIONS[key];
    return name ? this.form.get(name) : null;
  }

  sectionDirty(key: HostelSettingsSection): boolean {
    return !!this.sectionControl(key)?.dirty;
  }

  sectionInvalid(key: HostelSettingsSection): boolean {
    return !!this.sectionControl(key)?.invalid;
  }

  // ---------------------------------------------------------------------------
  // Unsaved-changes protection
  // ---------------------------------------------------------------------------

  confirmLeave(): Observable<boolean> | boolean {
    if (!this.form.dirty) return true;
    return this.confirmDialog.confirm({
      title: 'Leave without saving?',
      message: 'You have unsaved changes to your hostel settings. They will be lost if you leave this page.',
      confirmLabel: 'Leave page',
      cancelLabel: 'Stay',
      tone: 'warning',
      icon: 'edit_off',
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty) event.preventDefault();
  }

  /** Ctrl+S / Cmd+S saves instead of the browser's "Save page". */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
    }
  }

  // ---------------------------------------------------------------------------
  // Save / discard
  // ---------------------------------------------------------------------------

  save(): void {
    if (!this.form.dirty) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const first = this.sections.find((s) => this.sectionInvalid(s.key));
      if (first) this.active = first.key;
      this.snackBar.open('Please fix the highlighted fields before saving.', 'OK', { duration: 3500 });
      return;
    }

    const value = this.form.getRawValue() as HostelSettingsValue;
    value.rules.houseRules = value.rules.houseRules.map((r) => r.trim()).filter(Boolean);
    const result = this.service.save(value);
    this.state = this.service.state;
    this.load(this.state);

    const message = result.nameRequested
      ? `Settings saved. Name change to "${result.nameRequested}" sent for SuperAdmin approval.`
      : result.changed
        ? 'Hostel settings saved.'
        : 'No changes to save.';
    this.snackBar.open(message, 'OK', { duration: 4000 });
  }

  discard(): void {
    this.confirmDialog
      .confirm({
        title: 'Discard changes?',
        message: 'All unsaved edits on this page will be reverted to the last saved settings.',
        confirmLabel: 'Discard',
        danger: true,
      })
      .subscribe((ok) => {
        if (ok) this.load(this.state);
      });
  }

  withdrawNameChange(): void {
    const pending = this.state.pendingNameChange;
    if (!pending) return;
    this.confirmDialog
      .confirm({
        title: 'Withdraw name change?',
        message: `Your request to rename the hostel to "${pending.requestedName}" will be cancelled. The current name stays.`,
        confirmLabel: 'Withdraw request',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.withdrawNameChange();
        this.state = this.service.state;
        this.syncPermissions();
        this.snackBar.open('Name change request withdrawn.', 'OK', { duration: 3000 });
      });
  }

  /** Called after an upgrade request is recorded (it doesn't touch the form). */
  refreshState(): void {
    this.state = this.service.state;
  }

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  /** Puts saved values into the form and leaves it pristine. */
  private load(state: HostelSettingsState): void {
    const v = state.value;
    const rulesArray = this.form.controls.rules.controls.houseRules;
    rulesArray.clear({ emitEvent: false });
    for (const rule of v.rules.houseRules) rulesArray.push(houseRuleControl(rule), { emitEvent: false });

    // Channels the platform / plan doesn't offer are always off.
    const notifications = structuredClone(v.notifications);
    for (const e of NOTIFICATION_EVENTS) {
      for (const c of NOTIFICATION_CHANNELS) {
        if (this.service.channelBlockedReason(c.key)) notifications[e.key][c.key] = false;
      }
    }
    // Facilities outside the plan can't stay selected.
    const facilities = v.facilities.filter((f) => !this.facilityBlocked(f));

    this.form.reset({ ...v, notifications, facilities });
    this.syncPermissions();
    this.syncVisitorControls();
  }

  private facilityBlocked(name: string): boolean {
    return !!facilityBlockedReason(name, this.service.subscription);
  }

  /** Locks fields the owner may not edit, and the name while a change awaits approval. */
  private syncPermissions(): void {
    const p = this.service.permissions;
    const profile = this.form.controls.profile.controls;
    const setEnabled = (c: AbstractControl, on: boolean) => (on ? c.enable({ emitEvent: false }) : c.disable({ emitEvent: false }));

    setEnabled(profile.hostelName, p.canEditIdentity && !this.state.pendingNameChange);
    for (const key of ['addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'phone', 'email', 'website'] as const) {
      setEnabled(profile[key], p.canEditContact);
    }
    setEnabled(this.form.controls.facilities, p.canEditFacilities);

    const notifications = this.form.controls.notifications as FormGroup;
    for (const e of NOTIFICATION_EVENTS) {
      for (const c of NOTIFICATION_CHANNELS) {
        setEnabled(notifications.get([e.key, c.key])!, !this.service.channelBlockedReason(c.key));
      }
    }
  }

  private syncVisitorControls(): void {
    const r = this.form.controls.rules.controls;
    const on = r.visitorsAllowed.value;
    for (const c of [r.visitingFrom, r.visitingTo, r.maxVisitors, r.visitorIdRequired]) {
      if (on) c.enable({ emitEvent: false });
      else c.disable({ emitEvent: false });
    }
    this.form.controls.rules.updateValueAndValidity({ emitEvent: false });
  }

  /** The house rules list (typed for child components). */
  get houseRules(): FormArray<FormControl<string>> {
    return this.form.controls.rules.controls.houseRules;
  }
}
