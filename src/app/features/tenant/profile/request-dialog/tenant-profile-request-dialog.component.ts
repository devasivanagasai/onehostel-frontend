import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../../shared/components/button/app-button.component';
import { TenantProfileService, VerificationCodeResult } from '../../../../core/services/tenant-profile.service';
import {
  FIELDS_NEEDING_VERIFICATION,
  PROFILE_FIELD_LABELS,
  PROFILE_REQUEST_FIELDS,
  ProfileRequestField,
  TenantProfileRequest,
} from '../../../../core/models/tenant-profile.models';

/** "Request profile update": proposed value + reason, with a simulated verification code for a new mobile / email. */
@Component({
  selector: 'app-tenant-profile-request-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-profile-request-dialog.component.html',
  styleUrl: './tenant-profile-request-dialog.component.scss',
})
export class TenantProfileRequestDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<TenantProfileRequestDialogComponent, TenantProfileRequest>);
  readonly service = inject(TenantProfileService);

  readonly fields = PROFILE_REQUEST_FIELDS;
  readonly labels = PROFILE_FIELD_LABELS;

  field: ProfileRequestField = 'permanentAddress';
  value = '';
  value2 = '';
  reason = '';
  code = '';

  submitted = false;
  sending = false;
  saving = false;
  error = '';
  /** Set once a code has been "sent" for the current proposed value. */
  sent?: VerificationCodeResult;
  sentFor = '';

  get needsVerification(): boolean {
    return FIELDS_NEEDING_VERIFICATION.includes(this.field);
  }

  get current(): string {
    return this.service.currentValue(this.field) || 'Not on record';
  }

  /** A code only counts for the exact value it was sent to. */
  get codeSentForValue(): boolean {
    return !!this.sent && this.sentFor === this.value.trim();
  }

  /** Validation message for the proposed value / reason, shown after the first submit or send attempt. */
  get problem(): string {
    return this.service.validate({ field: this.field, proposedValue: this.value, proposedValue2: this.value2, reason: this.reason }) ?? '';
  }

  /** Value-only problem (no reason) so "Send code" can run before the reason is typed. */
  get valueProblem(): string {
    const p = this.service.validate({ field: this.field, proposedValue: this.value, proposedValue2: this.value2, reason: 'ok ok ok' });
    return p ?? '';
  }

  onFieldChange(): void {
    this.value = '';
    this.value2 = '';
    this.code = '';
    this.sent = undefined;
    this.sentFor = '';
    this.error = '';
    this.submitted = false;
  }

  onValueChange(): void {
    this.error = '';
    if (this.sent && this.sentFor !== this.value.trim()) this.code = '';
  }

  sendCode(): void {
    this.submitted = true;
    this.error = '';
    if (this.valueProblem) return;
    this.sending = true;
    try {
      this.sent = this.service.requestVerificationCode(this.field, this.value);
      this.sentFor = this.value.trim();
      this.code = '';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not send the code.';
    } finally {
      this.sending = false;
    }
  }

  submit(): void {
    this.submitted = true;
    this.error = '';
    if (this.problem) return;
    if (this.needsVerification && !this.codeSentForValue) {
      this.error = 'Send a verification code to the new contact and enter it below.';
      return;
    }
    this.saving = true;
    try {
      const request = this.service.submitRequest({
        field: this.field,
        proposedValue: this.value,
        proposedValue2: this.value2,
        reason: this.reason,
        verificationCode: this.code,
      });
      this.dialogRef.close(request);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not send the request.';
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
