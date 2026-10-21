import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNativeDateAdapter } from '@angular/material/core';

import { CustomValidators } from '../../../shared/validators/custom-validators';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { MOCK_HOSTEL_RECORDS } from './mock-hostel-records';
import { StepHostelInfoComponent } from './steps/step-hostel-info/step-hostel-info.component';
import { StepAddressComponent } from './steps/step-address/step-address.component';
import { StepCapacityComponent } from './steps/step-capacity/step-capacity.component';
import { StepFacilitiesComponent } from './steps/step-facilities/step-facilities.component';
import { StepAdminComponent } from './steps/step-admin/step-admin.component';
import { StepSubscriptionComponent } from './steps/step-subscription/step-subscription.component';
import { StepConfirmationComponent } from './steps/step-confirmation/step-confirmation.component';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { diffForAudit } from '../../../core/models/audit.models';
import { HostelAdminAccountService } from '../../../core/services/hostel-admin-account.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';

/** Hostel fields compared for the "Update Hostel" audit entry (flattened across steps). */
const HOSTEL_AUDIT_FIELDS: Record<string, string> = {
  hostelName: 'Hostel Name',
  hostelType: 'Hostel Type',
  hostelCategory: 'Category',
  gender: 'Gender',
  contactNumber: 'Contact Number',
  email: 'Email',
  website: 'Website',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  buildings: 'Buildings',
  floors: 'Floors',
  rooms: 'Rooms',
  totalBeds: 'Total Beds',
  plan: 'Plan',
  billingCycle: 'Billing Cycle',
  startDate: 'Subscription Start',
  endDate: 'Subscription End',
};

/**
 * Smart page: owns the whole "Add Hostel" wizard's root FormGroup (one child
 * FormGroup per step) plus the create/draft flow and the post-create success
 * state. Each step is a dumb presentational component that only receives the
 * FormGroup slice (or, for the read-only confirmation step, the raw value)
 * it needs to render.
 */
@Component({
  selector: 'app-add-hostel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatStepperModule,
    MatIconModule,
    AppButtonComponent,
    StepHostelInfoComponent,
    StepAddressComponent,
    StepCapacityComponent,
    StepFacilitiesComponent,
    StepAdminComponent,
    StepSubscriptionComponent,
    StepConfirmationComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './add-hostel.component.html',
  styleUrl: './add-hostel.component.scss',
})
export class AddHostelComponent implements OnInit {
  @ViewChild('stepper') private stepperRef?: MatStepper;
  @ViewChild('wizardCard') private wizardCard?: ElementRef<HTMLElement>;

  submitting = false;
  created = false;
  createdHostelId = '';

  /** Set from the `:id` route param — when present, the wizard edits that hostel instead of creating a new one. */
  isEditMode = false;
  private editingHostelId = '';
  /** Values as loaded for editing, so the audit entry can record old → new. */
  private originalAuditValues: Record<string, unknown> = {};

  /** Labels and one-line hints for the step list (same order as the mat-steps). */
  readonly steps: { label: string; hint: string; icon: string }[] = [
    { label: 'Hostel Information', hint: 'Name, type and contact details', icon: 'apartment' },
    { label: 'Address', hint: 'Where the hostel is located', icon: 'place' },
    { label: 'Hostel Capacity', hint: 'Buildings, rooms and beds', icon: 'bed' },
    { label: 'Facilities', hint: 'Amenities for tenants', icon: 'room_service' },
    { label: 'Hostel Owner', hint: 'Who manages the hostel', icon: 'admin_panel_settings' },
    { label: 'Subscription', hint: 'Plan and billing', icon: 'credit_card' },
    { label: 'Confirmation', hint: 'Review and submit', icon: 'fact_check' },
  ];

  readonly totalSteps = this.steps.length;

  get selectedIndex(): number {
    return this.stepperRef?.selectedIndex ?? 0;
  }

  get isLastStep(): boolean {
    return this.selectedIndex === this.totalSteps - 1;
  }

  /** Form group behind each step; the Confirmation step has none. */
  private get stepGroups(): (FormGroup | null)[] {
    return [
      this.hostelInfoGroup,
      this.addressGroup,
      this.capacityGroup,
      this.facilitiesGroup,
      this.adminGroup,
      this.subscriptionGroup,
      null,
    ];
  }

  private get currentStepGroup(): FormGroup | null {
    return this.stepGroups[this.selectedIndex];
  }

  /** How a step looks in the step list. */
  stepState(index: number): 'current' | 'done' | 'error' | 'upcoming' {
    if (index === this.selectedIndex) return 'current';
    const group = this.stepGroups[index];
    const touched = !!group && group.touched;
    if (index < this.selectedIndex) return group?.invalid ? 'error' : 'done';
    return touched && group?.invalid ? 'error' : 'upcoming';
  }

  onToolbarNext(): void {
    const group = this.currentStepGroup;
    if (group && this.stepperRef) {
      this.goNext(group, this.stepperRef);
    }
  }

  onBack(): void {
    this.stepperRef?.previous();
  }

  /** After changing step from further down a long form, bring the stepper and the new step's top into view. */
  onStepChanged(): void {
    setTimeout(() => this.wizardCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /**
   * Jumps to a step from the step list. Going back is always allowed; going
   * forward stops at the first earlier step that still has errors, so a step
   * can never be skipped while incomplete.
   */
  goToStep(index: number): void {
    const stepper = this.stepperRef;
    if (!stepper || index === this.selectedIndex) return;
    if (index > this.selectedIndex) {
      const steps = stepper.steps.toArray();
      for (let i = this.selectedIndex; i < index; i++) {
        const group = this.stepGroups[i];
        if (group?.invalid) {
          group.markAllAsTouched();
          stepper.selectedIndex = i;
          return;
        }
        // The linear stepper only lets you pass steps it has seen "interacted" with.
        steps[i].interacted = true;
      }
    }
    stepper.selectedIndex = index;
  }

  readonly form = this.fb.group({
    hostelInfo: this.fb.group({
      hostelName: ['', Validators.required],
      hostelType: ['', Validators.required],
      hostelCategory: ['', Validators.required],
      gender: ['', Validators.required],
      contactCountryCode: ['+1', Validators.required],
      contactNumber: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      email: ['', [Validators.required, Validators.email]],
      alternateCountryCode: ['+1'],
      alternateContact: ['', CustomValidators.phoneNumber],
      website: ['', Validators.pattern(/^https?:\/\/.+/)],
      logoFileName: [''],
    }),
    address: this.fb.group({
      addressLine1: ['', Validators.required],
      addressLine2: [''],
      country: ['', Validators.required],
      state: ['', Validators.required],
      city: ['', Validators.required],
      pincode: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
      latitude: [''],
      longitude: [''],
    }),
    capacity: this.fb.group({
      buildings: [2, [Validators.required, Validators.min(1)]],
      floors: [5, [Validators.required, Validators.min(1)]],
      rooms: [150, [Validators.required, Validators.min(1)]],
      totalBeds: [500, [Validators.required, Validators.min(1)]],
    }),
    facilities: this.fb.group({
      wifi: [false],
      mess: [false],
      laundry: [false],
      washingMachine: [false],
      parking: [false],
      housekeeping: [false],
      security: [false],
      cctv: [false],
      gym: [false],
      commonRoom: [false],
      studyRoom: [false],
      powerBackup: [false],
      waterFacility: [false],
      other: [false],
      otherFacility: [''],
    }),
    admin: this.fb.group({
      firstName: ['', Validators.required],
      lastName: [''],
      mobileNumber: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      email: ['', [Validators.required, Validators.email]],
      username: ['', Validators.required],
      tempPassword: [this.generatePassword(), Validators.required],
      sendEmail: [true],
      sendSms: [true],
    }),
    subscription: this.fb.group({
      plan: ['Standard', Validators.required],
      startDate: [new Date(), Validators.required],
      endDate: [null as Date | null, Validators.required],
      billingCycle: ['Monthly', Validators.required],
    }),
  });

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private auditLog: AuditLogService,
    private hostelAdmins: HostelAdminAccountService,
    private systemSettings: SystemSettingsService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    this.isEditMode = true;
    this.editingHostelId = id;

    const record = MOCK_HOSTEL_RECORDS[id];
    if (record) {
      this.form.patchValue(record);
    }
    this.originalAuditValues = this.flatAuditValues();
  }

  /** Step values flattened to one level; the admin step is excluded so passwords never reach the log. */
  private flatAuditValues(): Record<string, unknown> {
    const v = this.form.getRawValue();
    return { ...v.hostelInfo, ...v.address, ...v.capacity, ...v.subscription };
  }

  private recordAudit(): void {
    const v = this.form.getRawValue();
    const hostelName = v.hostelInfo.hostelName ?? '';

    if (this.isEditMode) {
      this.auditLog.record('Update Hostel', hostelName, {
        changes: diffForAudit(this.originalAuditValues, this.flatAuditValues(), HOSTEL_AUDIT_FIELDS),
      });
      return;
    }

    this.auditLog.record('Create Hostel', hostelName, {
      details: `${v.hostelInfo.hostelType} in ${v.address.city} · ${v.capacity.totalBeds} beds · ${v.subscription.plan} plan`,
    });
    this.auditLog.record('Create Admin', v.admin.username ?? '', {
      details: `Hostel owner for ${hostelName}. Credentials sent by ${[
        v.admin.sendEmail ? 'email' : '',
        v.admin.sendSms ? 'SMS' : '',
      ]
        .filter(Boolean)
        .join(' & ') || 'no channel'}.`,
    });
  }

  get hostelInfoGroup(): FormGroup {
    return this.form.get('hostelInfo') as FormGroup;
  }

  get addressGroup(): FormGroup {
    return this.form.get('address') as FormGroup;
  }

  get capacityGroup(): FormGroup {
    return this.form.get('capacity') as FormGroup;
  }

  get facilitiesGroup(): FormGroup {
    return this.form.get('facilities') as FormGroup;
  }

  get adminGroup(): FormGroup {
    return this.form.get('admin') as FormGroup;
  }

  get subscriptionGroup(): FormGroup {
    return this.form.get('subscription') as FormGroup;
  }

  get formValue() {
    return this.form.getRawValue();
  }

  goNext(group: FormGroup, stepper: MatStepper): void {
    if (group.invalid) {
      group.markAllAsTouched();
      return;
    }
    stepper.next();
  }

  regeneratePassword(): void {
    this.adminGroup.get('tempPassword')?.setValue(this.generatePassword());
  }

  onSaveDraft(): void {
    this.snackBar.open('Draft saved. You can continue onboarding this hostel later.', 'Dismiss', { duration: 4000 });
    this.router.navigate(['/hostel-onboarding']);
  }

  onCreateHostel(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    setTimeout(() => {
      this.submitting = false;
      this.created = true;
      this.recordAudit();
      this.createdHostelId = this.isEditMode
        ? this.editingHostelId
        : `HST${String(Math.floor(Math.random() * 900000) + 100000)}`;
      this.saveAdminAccount();
    }, 900);
  }

  /** Registers the admin's login so they can sign in with their temporary password. */
  private saveAdminAccount(): void {
    const { hostelInfo, admin } = this.form.getRawValue();
    this.hostelAdmins.save({
      hostelId: this.createdHostelId,
      hostelName: hostelInfo.hostelName ?? '',
      name: [admin.firstName, admin.lastName].filter(Boolean).join(' '),
      email: admin.email ?? '',
      mobileNumber: admin.mobileNumber ?? '',
      username: admin.username ?? '',
      password: admin.tempPassword ?? '',
    });
  }

  onSendCredentials(): void {
    this.snackBar.open('Credentials sent to the hostel owner.', 'Dismiss', { duration: 3000 });
  }

  onBackToList(): void {
    this.router.navigate(['/hostel-onboarding']);
  }

  /** Temporary password that satisfies the Password Format in Settings → Security. */
  private generatePassword(): string {
    const policy = this.systemSettings.settings.security;
    const sets = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnopqrstuvwxyz',
      number: '23456789',
      special: '!@#$%&*',
    };
    const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];

    // One character from every required type, so the rules are always met.
    const required = [
      policy.requireUppercase && sets.upper,
      policy.requireLowercase && sets.lower,
      policy.requireNumber && sets.number,
      policy.requireSpecialChar && sets.special,
    ].filter(Boolean) as string[];
    const chars = required.map(pick);

    // Fill to the minimum length (never shorter than 10 for a temporary password).
    const pool = required.length ? required.join('') : sets.upper + sets.lower + sets.number;
    const length = Math.max(Number(policy.minPasswordLength) || 0, 10, chars.length);
    while (chars.length < length) chars.push(pick(pool));

    // Shuffle so the required characters aren't always at the start.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}
