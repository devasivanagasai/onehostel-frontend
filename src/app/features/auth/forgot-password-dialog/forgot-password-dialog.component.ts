import { Component, DestroyRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormErrorComponent } from '../../../shared/components/form-error/app-form-error.component';
import { AppOtpInputComponent } from '../../../shared/components/otp-input/app-otp-input.component';
import { AppPasswordStrengthComponent } from '../../../shared/components/password-strength/app-password-strength.component';
import { CustomValidators } from '../../../shared/validators/custom-validators';
import { AuthService } from '../../../core/services/auth.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { EMAIL_OR_PHONE, apiErrorMessage, isUnknownAccount } from '../../../core/models/auth.models';
import { PasswordPolicy, passwordPolicyValidator } from '../../../core/models/account.models';

/** What the login page passes in: the login ID already typed there, if any. */
export interface ForgotPasswordDialogData {
  identifier?: string;
}

/** Closes with the identifier whose password was reset, or undefined when cancelled. */
export type ForgotPasswordDialogResult = string | undefined;

/** How long before "Resend code" can be used again. */
const RESEND_SECONDS = 30;

/**
 * Password reset by one-time code, in two steps:
 *  1. Identify: email or mobile number → "Send Reset Code".
 *  2. Verify & Reset: the 6-digit code, the new password (with strength meter) and its confirmation.
 */
@Component({
  selector: 'app-forgot-password-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    AppButtonComponent,
    AppFormErrorComponent,
    AppOtpInputComponent,
    AppPasswordStrengthComponent,
  ],
  templateUrl: './forgot-password-dialog.component.html',
  styleUrl: './forgot-password-dialog.component.scss',
})
export class ForgotPasswordDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject<MatDialogRef<ForgotPasswordDialogComponent, ForgotPasswordDialogResult>>(MatDialogRef);
  private readonly data = inject<ForgotPasswordDialogData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly authService = inject(AuthService);
  private readonly systemSettings = inject(SystemSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild(AppOtpInputComponent) private otpInput?: AppOtpInputComponent;

  readonly identifyForm = this.fb.nonNullable.group({
    identifier: [this.data?.identifier ?? '', [Validators.required, Validators.pattern(EMAIL_OR_PHONE)]],
  });

  readonly resetForm = this.fb.nonNullable.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    newPassword: ['', [Validators.required, passwordPolicyValidator(() => this.policy)]],
    confirmPassword: ['', [Validators.required, CustomValidators.matchField('newPassword')]],
  });

  /** Where the code went; set once it is sent, which shows step 2. */
  readonly sentTo = signal('');
  readonly step = computed(() => (this.sentTo() ? 'reset' : 'identify'));
  readonly loading = signal(false);
  readonly error = signal('');
  readonly resendIn = signal(0);
  readonly hidePassword = signal(true);
  /** The new password as typed, for the strength meter. */
  readonly newPassword = toSignal(this.resetForm.controls.newPassword.valueChanges, { initialValue: '' });

  private resendTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Re-check "Confirm Password" when the password it must match changes.
    this.resetForm.controls.newPassword.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.resetForm.controls.confirmPassword.updateValueAndValidity({ emitEvent: false }));
    this.destroyRef.onDestroy(() => clearInterval(this.resendTimer));
  }

  get policy(): PasswordPolicy {
    const s = this.systemSettings.settings.security;
    return {
      minLength: s.minPasswordLength,
      requireUppercase: s.requireUppercase,
      requireLowercase: s.requireLowercase,
      requireNumber: s.requireNumber,
      requireSpecialChar: s.requireSpecialChar,
    };
  }

  close(): void {
    this.dialogRef.close();
  }

  /** Step 1, and "Resend code" in step 2. */
  sendCode(): void {
    const identifier = this.identifyForm.controls.identifier;
    if (identifier.invalid) {
      identifier.markAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set('');
    this.authService.requestPasswordReset(identifier.value).subscribe({
      next: () => {
        this.loading.set(false);
        this.sentTo.set(identifier.value.trim());
        this.resetForm.controls.otp.setValue('');
        this.startResendCooldown();
        setTimeout(() => this.otpInput?.focus());
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        if (isUnknownAccount(error) && this.step() === 'identify') {
          identifier.setErrors({ server: error.error?.message || 'No account found with this email or mobile number.' });
          identifier.markAsTouched();
          return;
        }
        this.error.set(
          apiErrorMessage(error, {
            fallback: 'Could not send the reset code. Please try again.',
            unavailable: 'Password reset is not available yet. Please contact your administrator.',
          }),
        );
      },
    });
  }

  /** Step 2. */
  resetPassword(): void {
    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    const { otp, newPassword } = this.resetForm.getRawValue();
    this.loading.set(true);
    this.error.set('');
    this.authService.resetPassword(this.sentTo(), otp, newPassword).subscribe({
      next: () => this.dialogRef.close(this.sentTo()),
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        const field = error.error?.errors?.[0]?.field as string | undefined;
        if (error.error?.errorCode === 'INVALID_OTP') this.resetForm.controls.otp.setValue('');
        if (field === 'newPassword') this.resetForm.controls.newPassword.markAsTouched();
        this.error.set(apiErrorMessage(error, { fallback: 'Could not reset the password. Please try again.' }));
      },
    });
  }

  /** Back to step 1 to use a different email or mobile number. */
  changeIdentifier(): void {
    this.sentTo.set('');
    this.error.set('');
    this.resetForm.reset();
    clearInterval(this.resendTimer);
    this.resendIn.set(0);
  }

  private startResendCooldown(): void {
    clearInterval(this.resendTimer);
    this.resendIn.set(RESEND_SECONDS);
    this.resendTimer = setInterval(() => {
      this.resendIn.update((s) => s - 1);
      if (this.resendIn() <= 0) clearInterval(this.resendTimer);
    }, 1000);
  }
}
