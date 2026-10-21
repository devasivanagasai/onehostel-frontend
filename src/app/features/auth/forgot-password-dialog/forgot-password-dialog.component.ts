import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormErrorComponent } from '../../../shared/components/form-error/app-form-error.component';
import { AuditLogService } from '../../../core/services/audit-log.service';

@Component({
  selector: 'app-forgot-password-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    AppButtonComponent,
    AppFormErrorComponent,
  ],
  template: `
    <div class="forgot-dialog">
      <app-button class="forgot-dialog__close" variant="icon" icon="close" ariaLabel="Close" (clicked)="close()"></app-button>

      <ng-container *ngIf="!submitted">
        <div class="forgot-dialog__header">
          <div class="forgot-dialog__icon-wrapper">
            <mat-icon>lock_reset</mat-icon>
          </div>
          <h2 mat-dialog-title class="forgot-dialog__title">Forgot Password?</h2>
          <p class="forgot-dialog__subtitle">
            No worries! Enter your registered username below, and we'll send you instructions to reset your password.
          </p>
        </div>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
          <div class="forgot-dialog__field">
            <label class="forgot-dialog__label" for="reset-email">Username</label>
            <mat-form-field appearance="outline" class="full-width forgot-field">
              <mat-icon matPrefix class="field-icon">person_outline</mat-icon>
              <input
                id="reset-email"
                matInput
                type="text"
                placeholder="Enter your username"
                formControlName="email"
                autocomplete="username"
                required
              />
            </mat-form-field>
            <app-form-error [control]="form.get('email')" label="Username"></app-form-error>
          </div>

          <div class="forgot-dialog__actions">
            <app-button variant="secondary" [block]="true" (clicked)="close()">Cancel</app-button>
            <app-button
              variant="primary"
              type="submit"
              [block]="true"
              [disabled]="form.invalid"
              [loading]="loading"
            >
              Reset
            </app-button>
          </div>
        </form>
      </ng-container>

      <div class="forgot-dialog__success" *ngIf="submitted">
        <div class="success-icon-badge">
          <mat-icon>mark_email_read</mat-icon>
        </div>
        <h3>Reset Link Sent!</h3>
        <p>
          If an account exists for <strong>{{ sentEmail }}</strong>, you will receive password reset instructions shortly.
        </p>
        <app-button [block]="true" (clicked)="close()">Back to Login</app-button>
      </div>
    </div>
  `,
  styleUrl: './forgot-password-dialog.component.scss',
})
export class ForgotPasswordDialogComponent {
  readonly form = this.fb.group({
    email: ['', [Validators.required]],
  });

  loading = false;
  submitted = false;
  sentEmail = '';

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<ForgotPasswordDialogComponent>,
    private auditLog: AuditLogService,
  ) {}

  close(): void {
    this.dialogRef.close();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.sentEmail = this.form.get('email')?.value || '';

    setTimeout(() => {
      this.loading = false;
      this.submitted = true;
      // Requested before login, so the actor is the username that asked for the reset.
      this.auditLog.record('Reset Password', this.sentEmail, {
        user: this.sentEmail,
        details: 'Password reset link requested from the login page.',
      });
    }, 800);
  }
}
