import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { AuthService } from '../../../core/services/auth.service';
import {
  EMAIL_OR_PHONE,
  LoginErrorCode,
  MOBILE_APP_ONLY_MESSAGE,
  apiErrorMessage,
  isUnknownAccount,
} from '../../../core/models/auth.models';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormErrorComponent } from '../../../shared/components/form-error/app-form-error.component';
import { AppOtpInputComponent } from '../../../shared/components/otp-input/app-otp-input.component';
import {
  ForgotPasswordDialogComponent,
  ForgotPasswordDialogData,
  ForgotPasswordDialogResult,
} from '../forgot-password-dialog/forgot-password-dialog.component';

/** How long before "Resend OTP" can be used again. */
const OTP_RESEND_SECONDS = 30;

export type LoginMode = 'password' | 'otp';

/**
 * Web portal sign-in for Admins, Hostel Owners and Hostel Managers, by password or by one-time code
 * sent to the email or mobile number. Tenants and security guards are turned away to the mobile app.
 * Signed-in users go to the page they came from, or else their role's home page.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    AppButtonComponent,
    AppFormErrorComponent,
    AppOtpInputComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;
  @ViewChild(AppOtpInputComponent) private otpInput?: AppOtpInputComponent;

  /** One form for both tabs: the identifier is shared, password and otp are checked by the tab that needs them. */
  readonly form = this.fb.nonNullable.group({
    identifier: ['', [Validators.required, Validators.pattern(EMAIL_OR_PHONE)]],
    password: ['', [Validators.required]],
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly mode = signal<LoginMode>('password');
  readonly loading = signal(false);
  readonly hidePassword = signal(true);
  readonly capsLockOn = signal(false);
  /** Toggled briefly on a failed login to trigger the shake animation, then cleared so it can replay next time. */
  readonly loginFailed = signal(false);
  /** The last failure, from the backend's message. */
  readonly error = signal('');
  /** The failure was a mobile-app-only role (tenant, security guard). */
  readonly mobileAppOnly = signal(false);

  /** Where the OTP went; set once it is sent, which moves the OTP tab to its "enter code" step. */
  readonly otpSentTo = signal('');
  /** Seconds until "Resend OTP" is available again. */
  readonly resendIn = signal(0);
  private resendTimer?: ReturnType<typeof setInterval>;

  readonly subtitle = computed(() => {
    if (this.mode() === 'password') return 'Enter your email or mobile number and password to access your account.';
    return this.otpSentTo()
      ? 'Enter the 6-digit code we sent you.'
      : 'We will send a one-time code to your registered email or mobile number.';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.resendTimer));
    if (this.route.snapshot.queryParamMap.get('reason') === 'mobile-app') this.showError(MOBILE_APP_ONLY_MESSAGE, true);
  }

  /** Why the user was signed out automatically, if they were: inactivity (Session Timeout) or an expired session. */
  get signOutNotice(): string | null {
    switch (this.route.snapshot.queryParamMap.get('reason')) {
      case 'timeout':
        return 'You were signed out because you were inactive. Please log in again.';
      case 'expired':
        return 'Your session has expired. Please log in again.';
      default:
        return null;
    }
  }

  setMode(mode: LoginMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.clearError();
  }

  onPasswordKeyEvent(event: KeyboardEvent): void {
    this.capsLockOn.set(event.getModifierState?.('CapsLock') ?? false);
  }

  onSubmit(): void {
    if (this.mode() === 'password') this.loginWithPassword();
    else if (this.otpSentTo()) this.verifyOtp();
    else this.sendOtp();
  }

  private loginWithPassword(): void {
    const { identifier, password } = this.form.controls;
    if (identifier.invalid || password.invalid) {
      identifier.markAsTouched();
      password.markAsTouched();
      return;
    }

    this.start();
    this.authService.login({ identifier: identifier.value, password: password.value, rememberMe: true }).subscribe({
      next: () => this.onLoggedIn(),
      error: (error: HttpErrorResponse) => {
        this.onFailed(error, 'Incorrect email/mobile number or password.');
        password.reset('');
        this.passwordInput?.nativeElement.focus();
      },
    });
  }

  /** OTP step 1, and "Resend OTP" in step 2. */
  sendOtp(): void {
    const identifier = this.form.controls.identifier;
    if (identifier.invalid) {
      identifier.markAsTouched();
      return;
    }

    this.start();
    this.authService.sendLoginOtp(identifier.value).subscribe({
      next: () => {
        this.loading.set(false);
        this.otpSentTo.set(identifier.value.trim());
        this.form.controls.otp.reset('');
        this.startResendCooldown();
        this.snackBar.open(`OTP sent to ${identifier.value.trim()}.`, 'Dismiss', { duration: 4000 });
        setTimeout(() => this.otpInput?.focus());
      },
      error: (error: HttpErrorResponse) => {
        if (isUnknownAccount(error)) {
          this.loading.set(false);
          identifier.setErrors({ server: error.error?.message || 'No account found with this email or mobile number.' });
          identifier.markAsTouched();
          return;
        }
        this.onFailed(error, 'Could not send the OTP. Please try again.');
      },
    });
  }

  private verifyOtp(): void {
    const otp = this.form.controls.otp;
    if (otp.invalid) {
      otp.markAsTouched();
      return;
    }

    this.start();
    this.authService.loginWithOtp(this.otpSentTo(), otp.value, true).subscribe({
      next: () => this.onLoggedIn(),
      error: (error: HttpErrorResponse) => {
        this.onFailed(error, 'Incorrect OTP. Please check the code and try again.');
        otp.reset('');
        setTimeout(() => this.otpInput?.focus());
      },
    });
  }

  /** Back to the first OTP step to use a different email or mobile number. */
  changeOtpIdentifier(): void {
    this.otpSentTo.set('');
    this.form.controls.otp.reset('');
    clearInterval(this.resendTimer);
    this.resendIn.set(0);
    this.clearError();
  }

  onForgotPassword(event: Event): void {
    event.preventDefault();
    this.dialog
      .open<ForgotPasswordDialogComponent, ForgotPasswordDialogData, ForgotPasswordDialogResult>(
        ForgotPasswordDialogComponent,
        {
          width: '480px',
          maxWidth: '94vw',
          maxHeight: '94vh',
          panelClass: 'forgot-password-modal-panel',
          data: { identifier: this.form.controls.identifier.value },
        },
      )
      .afterClosed()
      .subscribe((identifier) => {
        if (!identifier) return;
        this.snackBar.open('Password reset successfully. Please log in with your new password.', 'Dismiss', {
          duration: 6000,
        });
        this.mode.set('password');
        this.clearError();
        this.form.patchValue({ identifier, password: '' });
        setTimeout(() => this.passwordInput?.nativeElement.focus());
      });
  }

  private startResendCooldown(): void {
    clearInterval(this.resendTimer);
    this.resendIn.set(OTP_RESEND_SECONDS);
    this.resendTimer = setInterval(() => {
      this.resendIn.update((s) => s - 1);
      if (this.resendIn() <= 0) clearInterval(this.resendTimer);
    }, 1000);
  }

  private start(): void {
    this.loading.set(true);
    this.clearError();
  }

  /** To the page the user came from (when their role may open it), else their role's home page. */
  private onLoggedIn(): void {
    this.loading.set(false);
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const target = returnUrl && returnUrl !== '/' && this.authService.canAccess(returnUrl) ? returnUrl : this.authService.landingRoute;
    this.router.navigateByUrl(target);
  }

  private onFailed(error: HttpErrorResponse, fallback: string): void {
    this.loading.set(false);
    // Mock sign-in sends `code`; the gateway sends `errorCode`.
    const code = (error.error?.code ?? error.error?.errorCode) as LoginErrorCode | undefined;
    const message = apiErrorMessage(error, {
      fallback,
      unavailable: 'Login with OTP is not available yet. Please log in with your password.',
    });
    this.showError(code === 'MOBILE_APP_ONLY' ? MOBILE_APP_ONLY_MESSAGE : message, code === 'MOBILE_APP_ONLY');

    // Brief shake for a clear "try again" cue.
    this.loginFailed.set(true);
    setTimeout(() => this.loginFailed.set(false), 500);
  }

  private showError(message: string, mobileApp = false): void {
    this.error.set(message);
    this.mobileAppOnly.set(mobileApp);
  }

  private clearError(): void {
    this.error.set('');
    this.mobileAppOnly.set(false);
  }
}
