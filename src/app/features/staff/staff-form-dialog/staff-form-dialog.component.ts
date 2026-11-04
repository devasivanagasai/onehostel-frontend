import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ROLE_TEMPLATES } from '../../../core/models/permissions.models';
import { DUTY_OPTIONS, STAFF_CATEGORIES, STAFF_STATUSES, Staff, StaffErrors, StaffInput, StaffRole } from '../../../core/models/staff.models';
import { StaffService } from '../../../core/services/staff.service';

export interface StaffFormData {
  /** Present when editing. */
  id?: string;
}

/** Add / edit a staff member. Closes with the saved staff, or nothing when cancelled. */
@Component({
  selector: 'app-staff-form-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './staff-form-dialog.component.html',
  styleUrl: './staff-form-dialog.component.scss',
})
export class StaffFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<StaffFormDialogComponent, Staff>);
  private readonly data = inject<StaffFormData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly service = inject(StaffService);

  readonly categories = STAFF_CATEGORIES;
  readonly statuses = STAFF_STATUSES;
  readonly roles: StaffRole[] = ['None', ...ROLE_TEMPLATES];
  readonly dutyOptions: string[] = [...DUTY_OPTIONS];

  readonly editing: Staff | undefined = this.data?.id ? this.service.byId(this.data.id) : undefined;

  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.editing?.name ?? ''],
    mobile: [this.editing?.mobile ?? ''],
    email: [this.editing?.email ?? ''],
    category: [this.editing?.category ?? STAFF_CATEGORIES[0]],
    status: [this.editing?.status ?? STAFF_STATUSES[0]],
    shiftName: [this.editing?.shift?.name ?? ''],
    shiftStart: [this.editing?.shift?.start ?? ''],
    shiftEnd: [this.editing?.shift?.end ?? ''],
    employmentStart: [this.editing?.employmentStart ?? ''],
    employmentEnd: [this.editing?.employmentEnd ?? ''],
    loginAccess: [this.editing?.loginAccess ?? false],
    roleTemplate: [(this.editing?.roleTemplate ?? 'None') as StaffRole],
  });

  duties: string[] = [...(this.editing?.duties ?? [])];
  customDuty = '';
  submitted = false;
  saving = false;
  saveError = '';

  /** Live validation from the service, shown once the user has tried to save. */
  get errors(): StaffErrors {
    return this.submitted ? this.service.validateStaff(this.input(), this.editing?.id) : {};
  }

  get allDuties(): string[] {
    return [...new Set([...this.dutyOptions, ...this.duties])];
  }

  toggleDuty(d: string): void {
    this.duties = this.duties.includes(d) ? this.duties.filter((x) => x !== d) : [...this.duties, d];
  }

  addCustomDuty(): void {
    const d = this.customDuty.trim();
    if (d && !this.duties.some((x) => x.toLowerCase() === d.toLowerCase())) this.duties = [...this.duties, d];
    this.customDuty = '';
  }

  onCustomDutyInput(e: Event): void {
    this.customDuty = (e.target as HTMLInputElement).value;
  }

  onCustomDutyEnter(e: Event): void {
    e.preventDefault();
    this.addCustomDuty();
  }

  /** Mobile accepts digits only. */
  onMobileInput(): void {
    const c = this.form.controls.mobile;
    const digits = c.value.replace(/\D/g, '').slice(0, 10);
    if (digits !== c.value) c.setValue(digits);
  }

  private input(): StaffInput {
    const v = this.form.getRawValue();
    return {
      name: v.name,
      mobile: v.mobile,
      email: v.email,
      category: v.category,
      duties: this.duties,
      shift: { name: v.shiftName, start: v.shiftStart, end: v.shiftEnd },
      employmentStart: v.employmentStart,
      employmentEnd: v.employmentEnd,
      status: v.status,
      loginAccess: v.loginAccess,
      roleTemplate: v.roleTemplate,
    };
  }

  save(): void {
    this.submitted = true;
    if (Object.keys(this.errors).length) return;
    this.saving = true;
    this.saveError = '';
    try {
      const input = this.input();
      this.dialogRef.close(this.editing ? this.service.updateStaff(this.editing.id, input) : this.service.createStaff(input));
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the staff member.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
