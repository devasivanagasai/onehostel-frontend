import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { FeesService, RecordPaymentInput } from '../fees.service';
import { Charge, OFFLINE_METHODS, PaymentMethod, REFERENCE_REQUIRED } from '../fees.models';

export interface RecordPaymentDialogData {
  /** Pre-selects this charge (opened from the Charges tab). */
  chargeId?: string;
}

const localNow = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

@Component({
  selector: 'app-record-payment-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './record-payment-dialog.component.html',
  styleUrl: './record-payment-dialog.component.scss',
})
export class RecordPaymentDialogComponent {
  private readonly fb = inject(FormBuilder);
  readonly fees = inject(FeesService);
  private readonly dialogRef = inject(MatDialogRef<RecordPaymentDialogComponent, RecordPaymentInput>);
  readonly fmt = inject(AppFormatService);
  readonly data = inject<RecordPaymentDialogData>(MAT_DIALOG_DATA);

  readonly gateway = inject(SystemSettingsService).settings.payment.paymentGateway || 'payment gateway';
  readonly methods: { value: PaymentMethod; label: string; icon: string }[] = [
    ...OFFLINE_METHODS.map((m) => ({
      value: m as PaymentMethod,
      label: m,
      icon: { Cash: 'payments', UPI: 'qr_code_2', Card: 'credit_card', 'Bank Transfer': 'account_balance' }[m],
    })),
    { value: 'Online', label: `Online (${this.gateway})`, icon: 'language' },
  ];
  readonly maxDateTime = localNow();

  /** Residents with something to pay, alphabetical. */
  readonly residents = [...new Map(
    this.fees.charges.filter((c) => this.fees.balance(c) > 0).map((c) => [c.residentId, { id: c.residentId, name: c.residentName }]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  private readonly preset = this.data.chargeId ? this.fees.chargeById(this.data.chargeId) : undefined;

  readonly form = this.fb.nonNullable.group({
    residentId: [this.preset?.residentId ?? '', Validators.required],
    chargeId: [this.preset?.id ?? '', Validators.required],
    amount: [this.preset ? this.fees.balance(this.preset) : 0, [Validators.required, (c: AbstractControl) => this.amountError(c)]],
    method: ['Cash' as PaymentMethod, Validators.required],
    transactionRef: ['', (c: AbstractControl) => this.refError(c)],
    paidAt: [localNow(), Validators.required],
    notes: ['', Validators.maxLength(250)],
  });

  submitting = false;

  constructor() {
    // Re-validate amount and reference when what they depend on changes
    this.form.controls.chargeId.valueChanges.subscribe(() => this.form.controls.amount.updateValueAndValidity());
    this.form.controls.method.valueChanges.subscribe(() => this.form.controls.transactionRef.updateValueAndValidity());
  }

  get charges(): Charge[] {
    return this.fees.openChargesFor(this.form.controls.residentId.value).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  get charge(): Charge | undefined {
    // `form` is still undefined while its own validators first run
    const id = this.form?.controls.chargeId.value;
    return id ? this.fees.chargeById(id) : undefined;
  }

  get due(): number {
    return this.charge ? this.fees.balance(this.charge) : 0;
  }

  get needsRef(): boolean {
    return REFERENCE_REQUIRED.includes(this.form.controls.method.value);
  }

  get isOnline(): boolean {
    return this.form.controls.method.value === 'Online';
  }

  status(c: Charge): string {
    return this.fees.chargeStatus(c);
  }

  onResidentPicked(): void {
    const open = this.charges;
    const first = open.find((c) => this.fees.chargeStatus(c) === 'Overdue') ?? open[0];
    this.form.patchValue({ chargeId: first?.id ?? '' });
    this.onChargePicked();
  }

  onChargePicked(): void {
    this.form.patchValue({ amount: this.due });
  }

  hasError(name: keyof typeof this.form.controls, error: string): boolean {
    const c = this.form.controls[name];
    return c.hasError(error) && (c.touched || c.dirty);
  }

  submit(): void {
    if (this.submitting) return; // guards against double-submit
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    const v = this.form.getRawValue();
    this.dialogRef.close({
      chargeId: v.chargeId,
      amount: Number(v.amount),
      method: v.method,
      transactionRef: v.transactionRef.trim() || undefined,
      paidAt: v.paidAt.length === 16 ? v.paidAt + ':00' : v.paidAt,
      notes: v.notes.trim() || undefined,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private amountError(c: AbstractControl): ValidationErrors | null {
    const n = Number(c.value);
    if (!(n > 0)) return { positive: true };
    if (this.charge && n > this.fees.balance(this.charge) + 1e-9) return { overpay: true };
    return null;
  }

  private refError(c: AbstractControl): ValidationErrors | null {
    const value = (c.value ?? '').trim();
    const method = c.parent?.get('method')?.value as PaymentMethod | undefined;
    if (method && REFERENCE_REQUIRED.includes(method) && !value) return { required: true };
    if (value && this.fees.findByReference(value)) return { duplicate: true };
    return null;
  }
}
