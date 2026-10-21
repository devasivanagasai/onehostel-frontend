import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AccountService } from '../../core/services/account.service';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { AppFormatService } from '../../core/services/app-format.service';
import { passwordRules } from '../../core/models/account.models';

/** Security: password policy summary + last change; the form itself lives on /change-password. */
@Component({
  selector: 'app-hs-security-section',
  standalone: true,
  imports: [MatIconModule, AppButtonComponent],
  template: `
    <div class="sc">
      <div class="sc-status">
        <span class="sc-status__icon"><mat-icon fontSet="material-icons-outlined">password</mat-icon></span>
        <div class="sc-status__text">
          <strong>Password</strong>
          @if (changedAt) {
            <span>Last changed {{ fmt.date(changedAt) }} ({{ ageText }})</span>
          } @else {
            <span>Not changed yet</span>
          }
          @if (expiresIn !== null) {
            <span class="sc-expiry" [class.sc-expiry--warn]="expiresIn <= 14">
              {{ expiresIn > 0 ? 'Expires in ' + expiresIn + (expiresIn === 1 ? ' day' : ' days') : 'Expired — change it now' }}
            </span>
          }
        </div>
        <app-button icon="lock_reset" (clicked)="changePassword()">Change password</app-button>
      </div>

      <h3 class="sc-subhead"><mat-icon fontSet="material-icons-outlined">policy</mat-icon>Password Policy</h3>
      <ul class="sc-rules">
        @for (r of rules; track r.key) {
          <li><mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>{{ r.label }}</li>
        }
        <li><mat-icon fontSet="material-icons-outlined">event_repeat</mat-icon>{{ expiryText }}</li>
        <li><mat-icon fontSet="material-icons-outlined">lock_clock</mat-icon>Account locks after {{ security.maxLoginAttempts }} failed sign-in attempts</li>
        <li><mat-icon fontSet="material-icons-outlined">timer</mat-icon>Signed out after {{ security.sessionTimeoutMinutes }} minutes of inactivity</li>
      </ul>
      <p class="sc-foot">Set by OneHostel for all accounts and enforced when you change your password.</p>
    </div>
  `,
  styleUrl: './security-section.component.scss',
})
export class SecuritySectionComponent {
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);
  readonly fmt = inject(AppFormatService);

  readonly security = inject(SystemSettingsService).settings.security;
  readonly rules = passwordRules(this.account.passwordPolicy);
  readonly changedAt = this.account.profile?.passwordChangedAt ?? null;
  readonly expiresIn = this.account.passwordExpiresInDays;

  get ageText(): string {
    const d = this.account.passwordAgeDays;
    return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
  }

  get expiryText(): string {
    const days = this.security.passwordExpiryDays;
    return days ? `Must be changed every ${days} days` : 'Passwords never expire';
  }

  changePassword(): void {
    this.router.navigate(['/change-password']);
  }
}
