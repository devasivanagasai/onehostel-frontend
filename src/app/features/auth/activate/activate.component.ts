import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TenantAccountService } from '../../../core/services/tenant-account.service';

type Step = 'contact' | 'code' | 'password';

/**
 * First-time Tenant activation (FRD 5.1): verify the contact the Hostel Owner registered with a one-time
 * code, then create a password. The code appears in a "simulation" banner because this build sends no SMS or email.
 */
@Component({
  selector: 'app-activate',
  standalone: true,
  imports: [FormsModule, RouterLink, MatIconModule],
  template: `
    <div class="act-page">
      <main class="act-card" aria-labelledby="act-title">
        <header class="act-logo"><mat-icon>apps</mat-icon><span>ONEHOSTEL</span></header>
        <h1 id="act-title">Activate your account</h1>
        <ol class="act-steps" aria-label="Progress">
          <li [class.on]="step === 'contact'" [class.done]="step !== 'contact'">1 Contact</li>
          <li [class.on]="step === 'code'" [class.done]="step === 'password'">2 Code</li>
          <li [class.on]="step === 'password'">3 Password</li>
        </ol>

        @if (error) {
          <p class="act-error" role="alert">{{ error }}</p>
        }

        @switch (step) {
          @case ('contact') {
            <p class="act-help">Enter the mobile number or email your hostel registered for you. We will send a verification code.</p>
            <label for="act-contact">Registered mobile number or email</label>
            <input id="act-contact" type="text" [(ngModel)]="contact" autocomplete="username" (keyup.enter)="sendCode()" />
            <button type="button" class="act-btn" (click)="sendCode()">Send code</button>
          }
          @case ('code') {
            <p class="act-help">{{ notice }}</p>
            <p class="act-sim" role="note">Simulation only: no SMS or email is sent in this build. Your code is <strong>{{ simulatedCode }}</strong>.</p>
            <label for="act-code">Verification code</label>
            <input id="act-code" type="text" inputmode="numeric" maxlength="6" [(ngModel)]="code" autocomplete="one-time-code" (keyup.enter)="verify()" />
            <button type="button" class="act-btn" (click)="verify()">Verify</button>
            <button type="button" class="act-link" (click)="resend()">Send a new code</button>
          }
          @case ('password') {
            <p class="act-help">Contact verified. Create a password for your account.</p>
            <label for="act-pw">New password</label>
            <input id="act-pw" type="password" [(ngModel)]="password" autocomplete="new-password" />
            @if (problems.length) {
              <ul class="act-rules" aria-label="Password rules">
                @for (p of problems; track p) {
                  <li>{{ p }}</li>
                }
              </ul>
            }
            <label for="act-pw2">Confirm password</label>
            <input id="act-pw2" type="password" [(ngModel)]="confirm" autocomplete="new-password" (keyup.enter)="finish()" />
            <label class="act-consent">
              <input type="checkbox" [(ngModel)]="consent" />
              I accept the Terms of Use and Privacy Notice.
            </label>
            <button type="button" class="act-btn" (click)="finish()">Activate account</button>
          }
        }

        <p class="act-foot"><a routerLink="/login">Back to login</a></p>
      </main>
    </div>
  `,
  styles: [
    `
      .act-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #030b2a; }
      .act-card { width: 100%; max-width: 440px; background: #fff; border-radius: 20px; padding: 28px 32px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 40px 90px -30px rgba(0, 0, 0, 0.55); }
      .act-logo { display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 800; color: #0b1e48; }
      h1 { margin: 6px 0 0; font-size: 22px; text-align: center; color: #0f172a; }
      .act-steps { display: flex; justify-content: center; gap: 14px; list-style: none; padding: 0; margin: 4px 0 8px; font-size: 12px; color: #94a3b8; }
      .act-steps .on { color: #2563eb; font-weight: 700; }
      .act-steps .done { color: #16a34a; }
      .act-help { margin: 0; font-size: 13.5px; color: #475569; }
      label { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 4px; }
      input[type='text'], input[type='password'] { height: 44px; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0 12px; font-size: 14px; background: #f5f7fb; }
      input:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
      .act-btn { margin-top: 8px; height: 46px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
      .act-btn:hover { background: #1d4ed8; }
      .act-link { background: none; border: 0; color: #2563eb; cursor: pointer; font-size: 13px; padding: 4px; }
      .act-error { margin: 0; padding: 10px 12px; border-radius: 10px; background: #fef2f2; color: #b91c1c; font-size: 13px; }
      .act-sim { margin: 0; padding: 10px 12px; border-radius: 10px; background: #f5f3ff; color: #5b21b6; font-size: 13px; }
      .act-rules { margin: 0; padding-left: 18px; font-size: 12px; color: #b45309; }
      .act-consent { display: flex; align-items: center; gap: 8px; font-weight: 400; }
      .act-foot { text-align: center; margin: 6px 0 0; font-size: 13px; }
      .act-foot a { color: #2563eb; }
    `,
  ],
})
export class ActivateComponent {
  private readonly accounts = inject(TenantAccountService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  step: Step = 'contact';
  contact = '';
  code = '';
  password = '';
  confirm = '';
  consent = false;
  error = '';
  notice = '';
  simulatedCode = '';

  get problems(): string[] {
    return this.password ? this.accounts.passwordProblems(this.password) : [];
  }

  sendCode(): void {
    this.run(() => {
      const result = this.accounts.requestOtp(this.contact);
      this.notice = result.message;
      this.simulatedCode = result.simulatedCode;
      this.code = '';
      this.step = 'code';
    });
  }

  resend(): void {
    this.sendCode();
  }

  verify(): void {
    this.error = '';
    const result = this.accounts.verifyOtp(this.code);
    if (result.ok) {
      this.step = 'password';
      return;
    }
    this.error = result.message;
    // A used-up or expired code needs a new one: go back to the first step.
    if (result.attemptsLeft === 0 || /expired|request/i.test(result.message)) this.step = 'contact';
  }

  finish(): void {
    this.run(() => {
      this.accounts.activate(this.password, this.confirm, this.consent);
      this.snackBar.open('Your account is active. Sign in with your new password.', 'Dismiss', { duration: 6000 });
      void this.router.navigate(['/login']);
    });
  }

  private run(action: () => void): void {
    this.error = '';
    try {
      action();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Something went wrong. Try again.';
    }
  }
}
