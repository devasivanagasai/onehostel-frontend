import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { AuthService } from '../../../core/services/auth.service';
import { LoginErrorCode } from '../../../core/models/auth.models';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormErrorComponent } from '../../../shared/components/form-error/app-form-error.component';
import { CustomValidators } from '../../../shared/validators/custom-validators';
import { ForgotPasswordDialogComponent } from '../forgot-password-dialog/forgot-password-dialog.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    AppButtonComponent,
    AppFormErrorComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;

  readonly form = this.fb.group({
    username: ['', [Validators.required, CustomValidators.noWhitespace]],
    password: ['', [Validators.required]],
  });

  loading = false;
  hidePassword = true;
  capsLockOn = false;
  /** Toggled briefly on a failed login to trigger the shake animation, then cleared so it can replay next time. */
  loginFailed = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {}

  /** Set when the user was signed out automatically (Settings → Security → Session Timeout). */
  get signedOutForInactivity(): boolean {
    return this.route.snapshot.queryParamMap.get('reason') === 'timeout';
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
  }

  onPasswordKeyEvent(event: KeyboardEvent): void {
    this.capsLockOn = event.getModifierState?.('CapsLock') ?? false;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, password } = this.form.getRawValue();
    this.loading = true;

    this.authService.login({ identifier: username!.trim(), password: password!, rememberMe: true }).subscribe({
      next: () => this.onLoggedIn(),
      error: (error: HttpErrorResponse) => {
        this.onFailed(error, 'Incorrect login ID or password.');
        this.passwordInput?.nativeElement.focus();
      },
    });
  }

  private onLoggedIn(): void {
    this.loading = false;
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
    this.router.navigateByUrl(returnUrl);
  }

  private onFailed(error: HttpErrorResponse, fallback: string): void {
    this.loading = false;
    const code = error.error?.code as LoginErrorCode | undefined;

    const message =
      error.status === 401 || error.status === 404
        ? (error.error?.message ?? fallback)
        : 'Something went wrong while signing you in. Please try again.';
    this.snackBar.open(message, 'Dismiss', {
      duration: code === 'LOCKED' ? 8000 : 5000,
      panelClass: 'app-snackbar--error',
    });

    // Brief shake for a clear "try again" cue.
    this.loginFailed = true;
    setTimeout(() => (this.loginFailed = false), 500);
  }

  onForgotPassword(event: Event): void {
    event.preventDefault();
    this.dialog.open(ForgotPasswordDialogComponent, {
      width: '440px',
      maxWidth: '92vw',
      panelClass: 'forgot-password-modal-panel',
    });
  }
}
