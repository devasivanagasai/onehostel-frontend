import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { ResidentsService } from '../../residents/residents.service';
import { RESIDENT_TYPES, residentFullName } from '../../residents/residents.models';
import { FeeInput } from '../fees.service';
import {
  Applicability,
  BILLING_FREQUENCIES,
  DueRule,
  FEE_CATEGORIES,
  FEE_NAMES,
  FEE_STATUSES,
  FeeConfig,
  TAX_OPTIONS,
} from '../fees.models';

export interface FeeConfigDialogData {
  fee?: FeeConfig;
}

const dateRange: ValidatorFn = (g: AbstractControl): ValidationErrors | null => {
  const from = g.get('effectiveFrom')?.value;
  const to = g.get('effectiveTo')?.value;
  return from && to && to < from ? { range: true } : null;
};

@Component({
  selector: 'app-fee-config-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatButtonToggleModule,
    MatSlideToggleModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './fee-config-dialog.component.html',
  styleUrl: './fee-config-dialog.component.scss',
})
export class FeeConfigDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<FeeConfigDialogComponent, FeeInput>);
  private readonly settings = inject(SystemSettingsService);
  readonly data = inject<FeeConfigDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = !!this.data.fee;
  readonly names = FEE_NAMES;
  readonly categories = FEE_CATEGORIES;
  readonly frequencies = BILLING_FREQUENCIES;
  readonly statuses = FEE_STATUSES;
  readonly taxOptions = TAX_OPTIONS;
  readonly residentTypes = RESIDENT_TYPES;
  readonly residentOptions = inject(ResidentsService)
    .residents.filter((r) => !r.deactivatedAt && r.status !== 'Checked Out')
    .map((r) => ({ id: r.residentId, label: `${residentFullName(r)} · ${r.residentId}` }));

  readonly form = this.build(this.data.fee);

  get subtitle(): string {
    return this.isEdit
      ? this.data.fee!.id + ' · charges already generated are not changed'
      : 'Configure a resident charge. Save as Draft until it is ready.';
  }

  /** Suggested category per fee name (only applied while the user hasn't picked one by hand). */
  private readonly defaultCategory: Record<string, string> = {
    'Hostel Fee/Rent': 'Accommodation',
    Mess: 'Food',
    Laundry: 'Services',
    Maintenance: 'Utilities',
    Other: 'Other',
  };

  onNameChange(): void {
    const name = this.form.value.name!;
    if (!this.form.controls.category.dirty) this.form.patchValue({ category: this.defaultCategory[name] as never });
    if (name !== 'Hostel Fee/Rent') this.form.patchValue({ amountSource: 'Fixed' });
  }

  hasError(path: string, error: string): boolean {
    const c = this.form.get(path);
    return !!c && c.hasError(error) && (c.touched || c.dirty);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();

    const dueRule: DueRule =
      v.dueType === 'day-of-period'
        ? { type: 'day-of-period', day: Number(v.dueDay) }
        : v.dueType === 'days-after-issue'
          ? { type: 'days-after-issue', days: Number(v.dueDays) }
          : { type: 'fixed-date', date: v.dueDate! };

    const applicability: Applicability =
      v.applyMode === 'Types'
        ? { mode: 'Types', residentTypes: v.applyTypes as never }
        : v.applyMode === 'Residents'
          ? { mode: 'Residents', residentIds: v.applyResidents! }
          : { mode: 'All' };

    this.dialogRef.close({
      name: v.name!,
      label: v.label?.trim() || undefined,
      category: v.category!,
      amountSource: v.name === 'Hostel Fee/Rent' ? v.amountSource! : 'Fixed',
      amount: Number(v.amount),
      frequency: v.frequency!,
      customMonths: v.frequency === 'Custom' ? Number(v.customMonths) : undefined,
      effectiveFrom: v.effectiveFrom || undefined,
      effectiveTo: v.effectiveTo || undefined,
      dueRule,
      lateFee: v.lateEnabled ? { type: v.lateType!, value: Number(v.lateValue), graceDays: Number(v.lateGrace) } : undefined,
      taxRate: Number(v.taxRate),
      applicability,
      status: v.status!,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private build(f?: FeeConfig) {
    const defaults = this.settings.settings.fees;
    const due = f?.dueRule;
    const a = f?.applicability;
    const rangeIfDue = (type: string, min: number, max: number): ValidatorFn => (c) => {
      const t = c.parent?.get('dueType')?.value;
      if (t !== type) return null;
      const n = Number(c.value);
      return c.value === '' || c.value === null || !Number.isInteger(n) || n < min || n > max ? { range: true } : null;
    };

    const form = this.fb.group(
      {
        name: [f?.name ?? FEE_NAMES[0], Validators.required],
        label: [f?.label ?? ''],
        category: [f?.category ?? FEE_CATEGORIES[0], Validators.required],
        amountSource: [f?.amountSource ?? 'Fixed'],
        amount: [f?.amount ?? 0, [Validators.required, Validators.min(0)]],
        frequency: [f?.frequency ?? 'Monthly', Validators.required],
        customMonths: [f?.customMonths ?? 2, [Validators.min(1), Validators.max(24)]],
        effectiveFrom: [f?.effectiveFrom ?? ''],
        effectiveTo: [f?.effectiveTo ?? ''],
        dueType: [due?.type ?? 'day-of-period'],
        dueDay: [due?.type === 'day-of-period' ? due.day : 5, rangeIfDue('day-of-period', 1, 28)],
        dueDays: [due?.type === 'days-after-issue' ? due.days : 7, rangeIfDue('days-after-issue', 0, 90)],
        dueDate: [due?.type === 'fixed-date' ? due.date : ''],
        lateEnabled: [f ? !!f.lateFee : defaults.lateFeeEnabled],
        lateType: [f?.lateFee?.type ?? defaults.lateFeeType],
        lateValue: [f?.lateFee?.value ?? defaults.lateFeeValue, Validators.min(0)],
        lateGrace: [f?.lateFee?.graceDays ?? defaults.lateFeeGraceDays, Validators.min(0)],
        taxRate: [f?.taxRate ?? 0],
        applyMode: [a?.mode ?? 'All'],
        applyTypes: [a?.mode === 'Types' ? [...a.residentTypes] : ([] as string[])],
        applyResidents: [a?.mode === 'Residents' ? [...a.residentIds] : ([] as string[])],
        status: [f?.status ?? 'Draft', Validators.required],
      },
      { validators: [dateRange] },
    );
    // Due-rule fields validate against the selected rule type
    form.controls.dueType.valueChanges.subscribe(() => {
      form.controls.dueDay.updateValueAndValidity();
      form.controls.dueDays.updateValueAndValidity();
    });
    return form;
  }
}
