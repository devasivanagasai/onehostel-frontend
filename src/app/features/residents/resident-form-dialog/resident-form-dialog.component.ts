import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { Room } from '../../rooms-management/rooms.models';
import { ResidentsService } from '../residents.service';
import {
  DOCUMENT_TYPES,
  EDITABLE_STATUSES,
  GUARDIAN_RELATIONSHIPS,
  HostelResident,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  RESIDENT_GENDERS,
  RESIDENT_TYPES,
  ResidentDocument,
  ResidentInput,
} from '../residents.models';

export interface ResidentFormDialogData {
  resident?: HostelResident;
}

export interface ResidentFormDialogResult {
  input: ResidentInput;
  /** Add mode only: allocate this bed straight away, from the joining date. */
  allocation?: { roomId: string; bedId: string };
}

const MOBILE_PATTERN = /^[6-9]\d{9}$/;

const today = (): string => new Date().toISOString().slice(0, 10);

/** Expected checkout must be on/after joining date. */
const checkoutAfterJoining: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const joining = group.get('joiningDate')?.value;
  const checkout = group.get('expectedCheckoutDate')?.value;
  return joining && checkout && checkout < joining ? { checkoutBeforeJoining: true } : null;
};

const notInFuture: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  c.value && c.value > today() ? { future: true } : null;

@Component({
  selector: 'app-resident-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './resident-form-dialog.component.html',
  styleUrl: './resident-form-dialog.component.scss',
})
export class ResidentFormDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly residents = inject(ResidentsService);
  private readonly dialogRef = inject(MatDialogRef<ResidentFormDialogComponent, ResidentFormDialogResult>);
  readonly data = inject<ResidentFormDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = !!this.data.resident;
  readonly genders = RESIDENT_GENDERS;
  readonly types = RESIDENT_TYPES;
  readonly documentTypes = DOCUMENT_TYPES;
  readonly relationships = GUARDIAN_RELATIONSHIPS;
  readonly documentStatuses = ['Pending', 'Verified', 'Rejected'];
  readonly maxDate = today();

  /** Status is only editable between Active / On Leave / Suspended. */
  readonly statusOptions = EDITABLE_STATUSES;
  readonly canEditStatus = !!this.data.resident && EDITABLE_STATUSES.includes(this.data.resident.status);

  photoUrl?: string = this.data.resident?.photoUrl;
  photoError = '';
  /** Guardian section starts open when one is already recorded. */
  guardianOpen = !!this.data.resident?.guardian;
  submitError = '';

  readonly form: FormGroup = this.buildForm(this.data.resident);

  get subtitle(): string {
    const r = this.data.resident;
    return r
      ? `${r.residentId} · created ${new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'A Resident ID is generated on save. The resident is invited to activate their account.';
  }

  get documents(): FormArray<FormGroup> {
    return this.form.get('documents') as FormArray<FormGroup>;
  }

  get initials(): string {
    const f = (this.form.value.firstName || '').trim();
    const l = (this.form.value.lastName || '').trim();
    return ((f[0] || '') + (l[0] || '')).toUpperCase() || '?';
  }

  /** Rooms the resident may be allocated to, given the gender / college picked so far. */
  get eligibleRooms(): Room[] {
    const { gender, collegeOrCompany } = this.form.value;
    return gender ? this.residents.eligibleRooms({ gender, collegeOrCompany }) : [];
  }

  get eligibleBeds() {
    const roomId = this.form.value.allocationRoomId;
    return this.eligibleRooms.find((r) => r.id === roomId)?.beds.filter((b) => b.status === 'Available') ?? [];
  }

  /** Clears a picked room/bed that's no longer allowed after gender or college changes. */
  syncAllocation(): void {
    const roomId = this.form.value.allocationRoomId;
    if (roomId && !this.eligibleRooms.some((r) => r.id === roomId)) {
      this.form.patchValue({ allocationRoomId: '', allocationBedId: '' });
    }
  }

  onRoomPicked(): void {
    const beds = this.eligibleBeds;
    this.form.patchValue({ allocationBedId: beds.length === 1 ? beds[0].id : '' });
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.photoError = '';
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      this.photoError = 'Use a JPG, PNG or WebP image.';
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.photoError = 'Photo must be 2 MB or smaller.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => (this.photoUrl = reader.result as string);
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    this.photoUrl = undefined;
    this.photoError = '';
  }

  onDocumentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.documents.push(
      this.documentGroup({
        id: `DOC-${Date.now()}`,
        type: 'Aadhaar Card',
        fileName: file.name,
        status: 'Pending',
        uploadedAt: today(),
      }),
    );
  }

  removeDocument(index: number): void {
    this.documents.removeAt(index);
  }

  hasError(path: string, error: string): boolean {
    const c = this.form.get(path);
    return !!c && c.hasError(error) && (c.touched || c.dirty);
  }

  submit(): void {
    this.submitError = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.submitError = 'Please fix the highlighted fields.';
      return;
    }

    const v = this.form.getRawValue();
    const guardian = v.guardianName
      ? { name: v.guardianName, relationship: v.guardianRelationship, mobile: v.guardianMobile, consent: !!v.guardianConsent }
      : undefined;

    const input: ResidentInput = {
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth,
      gender: v.gender,
      mobileCode: '+91',
      mobile: v.mobile,
      email: v.email,
      photoUrl: this.photoUrl,
      permanentAddress: v.permanentAddress,
      emergencyContactName: v.emergencyContactName,
      emergencyContactMobile: v.emergencyContactMobile,
      guardian,
      residentType: v.residentType,
      collegeOrCompany: v.collegeOrCompany,
      joiningDate: v.joiningDate,
      expectedCheckoutDate: v.expectedCheckoutDate,
      documents: v.documents as ResidentDocument[],
      notes: v.notes,
      status: this.canEditStatus ? v.status : this.data.resident?.status,
    };

    const allocation =
      !this.isEdit && v.allocationRoomId && v.allocationBedId
        ? { roomId: v.allocationRoomId, bedId: v.allocationBedId }
        : undefined;

    this.dialogRef.close({ input, allocation });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  // ---------------------------------------------------------------------------

  private buildForm(r?: HostelResident): FormGroup {
    const exceptId = r?.residentId;
    const unique =
      (field: 'mobile' | 'email'): ValidatorFn =>
      (c: AbstractControl) =>
        c.value && this.residents.findDuplicate(field, c.value, exceptId) ? { duplicate: true } : null;

    return this.fb.group(
      {
        firstName: [r?.firstName ?? '', [Validators.required, Validators.maxLength(50)]],
        lastName: [r?.lastName ?? '', [Validators.required, Validators.maxLength(50)]],
        dateOfBirth: [r?.dateOfBirth ?? '', notInFuture],
        gender: [r?.gender ?? '', Validators.required],
        mobile: [r?.mobile ?? '', [Validators.required, Validators.pattern(MOBILE_PATTERN), unique('mobile')]],
        email: [r?.email ?? '', [Validators.email, unique('email')]],
        permanentAddress: [r?.permanentAddress ?? '', Validators.maxLength(250)],
        emergencyContactName: [r?.emergencyContactName ?? ''],
        emergencyContactMobile: [r?.emergencyContactMobile ?? '', Validators.pattern(MOBILE_PATTERN)],
        guardianName: [r?.guardian?.name ?? ''],
        guardianRelationship: [r?.guardian?.relationship ?? ''],
        guardianMobile: [r?.guardian?.mobile ?? '', Validators.pattern(MOBILE_PATTERN)],
        guardianConsent: [r?.guardian?.consent ?? false],
        residentType: [r?.residentType ?? 'College Student', Validators.required],
        collegeOrCompany: [r?.collegeOrCompany ?? ''],
        joiningDate: [r?.joiningDate ?? today(), Validators.required],
        expectedCheckoutDate: [r?.expectedCheckoutDate ?? ''],
        status: [r?.status ?? 'Invited'],
        notes: [r?.notes ?? '', Validators.maxLength(500)],
        documents: this.fb.array((r?.documents ?? []).map((d) => this.documentGroup(d))),
        allocationRoomId: [''],
        allocationBedId: [''],
      },
      { validators: checkoutAfterJoining },
    );
  }

  private documentGroup(d: ResidentDocument): FormGroup {
    return this.fb.group({
      id: [d.id],
      type: [d.type, Validators.required],
      fileName: [d.fileName, Validators.required],
      status: [d.status],
      uploadedAt: [d.uploadedAt],
    });
  }
}
