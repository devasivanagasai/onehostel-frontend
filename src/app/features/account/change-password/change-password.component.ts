import { Component, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../../core/models/auth.models';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AccountService } from '../../../core/services/account.service';
import {
  PasswordPolicy,
  PasswordRule,
  PasswordStrength,
  changePasswordGroupValidator,
  passwordPolicyValidator,
  passwordRules,
  passwordStrength,
} from '../../../core/models/account.models';
import { UnsavedChangesAware } from '../../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [AppDatePipe, AppButtonComponent, CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatIconModule],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss',
})
export class ChangePasswordComponent implements UnsavedChangesAware {
  @ViewChild('currentInput') private currentInput?: ElementRef<HTMLInputElement>;

  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);

  /** Password format from Settings → Security. */
  get policy(): PasswordPolicy {
    return this.account.passwordPolicy;
  }

  get minLength(): number {
    return this.policy.minLength;
  }

  readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, passwordPolicyValidator(() => this.policy)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: changePasswordGroupValidator },
  );

  visible: Record<PasswordField, boolean> = { currentPassword: false, newPassword: false, confirmPassword: false };
  capsLockOn = false;
  saving = false;
  /** A failure reported by the backend, shown above the Update button. */
  serverError = '';
  /** Set after a successful change; swaps the form for a confirmation panel. */
  done = false;

  get rules(): (PasswordRule & { passed: boolean })[] {
    const value = this.form.controls.newPassword.value;
    return passwordRules(this.policy).map((r) => ({ ...r, passed: r.test(value) }));
  }

  get strength(): PasswordStrength {
    return passwordStrength(this.form.controls.newPassword.value, this.policy);
  }

  /** Tip text listing only the character types Settings requires. */
  get requiredMix(): string {
    const p = this.policy;
    const parts = [
      p.requireUppercase && 'uppercase',
      p.requireLowercase && 'lowercase',
      p.requireNumber && 'numbers',
      p.requireSpecialChar && 'special characters',
    ].filter(Boolean) as string[];
    if (!parts.length) return '';
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  get passwordAgeDays(): number {
    return this.account.passwordAgeDays;
  }

  get passwordExpiresInDays(): number | null {
    return this.account.passwordExpiresInDays;
  }

  /** Password Expiry reached: the rest of the app is blocked until a new password is set. */
  get isExpired(): boolean {
    const days = this.passwordExpiresInDays;
    return days !== null && days <= 0;
  }

  /** When the password was last changed (for the "Last Changed" card). */
  get lastChangedOn(): string | null {
    return this.account.profile?.passwordChangedAt ?? null;
  }

  /** When the current password expires, or null if passwords never expire. */
  get expiresOn(): Date | null {
    const days = this.passwordExpiresInDays;
    if (days === null) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  /** The four strength segments, weakest first. */
  readonly strengthLevels = [
    { key: 'weak', label: 'Weak' },
    { key: 'medium', label: 'Medium' },
    { key: 'strong', label: 'Strong' },
    { key: 'very-strong', label: 'Very Strong' },
  ];

  /** How many segments are lit (0 when empty; at least 1 once something is typed). */
  get strengthFilled(): number {
    if (!this.form.controls.newPassword.value) return 0;
    return Math.min(4, Math.max(1, this.strength.score));
  }

  get strengthLevel(): string {
    return this.strengthLevels[Math.max(0, this.strengthFilled - 1)].key;
  }

  get strengthLabel(): string {
    return this.strengthLevels[Math.max(0, this.strengthFilled - 1)].label;
  }

  /** Colour of the expiry card: green (fine / never), amber (14 days or less), red (expired). */
  get expiryTone(): 'green' | 'amber' | 'red' {
    const days = this.passwordExpiresInDays;
    if (days === null || days > 14) return 'green';
    return days <= 0 ? 'red' : 'amber';
  }

  get confirmMatches(): boolean {
    const { newPassword, confirmPassword } = this.form.getRawValue();
    return !!confirmPassword && newPassword === confirmPassword;
  }

  showError(field: PasswordField, error: string): boolean {
    const c = this.form.controls[field];
    return c.hasError(error) && (c.dirty || c.touched);
  }

  showGroupError(error: 'sameAsCurrent' | 'mismatch', field: PasswordField): boolean {
    const c = this.form.controls[field];
    return this.form.hasError(error) && (c.dirty || c.touched);
  }

  toggle(field: PasswordField): void {
    this.visible[field] = !this.visible[field];
  }

  onKey(event: KeyboardEvent): void {
    this.capsLockOn = event.getModifierState?.('CapsLock') ?? false;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.saving = true;
    this.serverError = '';

    this.account.changePassword(currentPassword, newPassword).subscribe({
      next: (result) => {
        this.saving = false;
        if (result === 'wrong-current') {
          const current = this.form.controls.currentPassword;
          current.setErrors({ incorrect: true });
          current.markAsTouched();
          this.currentInput?.nativeElement.focus();
          this.currentInput?.nativeElement.select();
          return;
        }
        this.form.reset();
        this.done = true;
      },
      // Rules the backend enforces too (format, not reusing the current password), or a network failure.
      error: (error: HttpErrorResponse) => {
        this.saving = false;
        this.serverError = apiErrorMessage(error, {
          fallback: 'Could not change the password. Please try again.',
          unavailable: 'Changing the password is not available yet. Please try again later.',
        });
      },
    });
  }

  onCancel(): void {
    this.router.navigate(['/profile']);
  }

  goTo(url: string): void {
    this.router.navigateByUrl(url);
  }

  changeAgain(): void {
    this.done = false;
    this.visible = { currentPassword: false, newPassword: false, confirmPassword: false };
  }

  // ---- Leave guard -----------------------------------------------------------

  confirmLeave(): Observable<boolean> {
    if (this.done || !this.form.dirty) return of(true);
    return this.confirm.confirm({
      title: 'Leave without saving?',
      message: "Your password hasn't been changed yet. What you've typed will be cleared.",
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: true,
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.done && this.form.dirty) event.preventDefault();
  }
}
