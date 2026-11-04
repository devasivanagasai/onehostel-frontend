import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PasswordPolicy, passwordRules, passwordStrength } from '../../../core/models/account.models';

const LEVELS = [
  { key: 'weak', label: 'Weak' },
  { key: 'medium', label: 'Medium' },
  { key: 'strong', label: 'Strong' },
  { key: 'very-strong', label: 'Very Strong' },
];

/**
 * Strength meter and rule checklist for a new password, against the Settings → Security policy.
 *
 *   <app-password-strength [value]="form.controls.newPassword.value" [policy]="policy" />
 */
@Component({
  selector: 'app-password-strength',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="pw-strength" aria-live="polite">
      <div class="pw-strength__head">
        Password strength:
        <span class="pw-strength__label pw-strength__label--{{ level.key }}">{{ value ? level.label : '—' }}</span>
      </div>
      <div
        class="pw-strength__bar"
        role="meter"
        aria-label="Password strength"
        aria-valuemin="0"
        aria-valuemax="4"
        [attr.aria-valuenow]="score"
      >
        @for (l of levels; track l.key; let i = $index) {
          <span class="pw-strength__seg pw-strength__seg--{{ level.key }}" [class.pw-strength__seg--on]="value && i < filled"></span>
        }
      </div>
      <ul class="pw-strength__rules">
        @for (rule of rules; track rule.key) {
          <li [class.pw-strength__rule--pass]="rule.passed">
            <mat-icon aria-hidden="true">{{ rule.passed ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
            {{ rule.label }}
            <span class="sr-only">{{ rule.passed ? '(met)' : '(not met)' }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styleUrl: './app-password-strength.component.scss',
})
export class AppPasswordStrengthComponent {
  @Input() value = '';
  @Input({ required: true }) policy!: PasswordPolicy;

  readonly levels = LEVELS;

  get score(): number {
    return passwordStrength(this.value ?? '', this.policy).score;
  }

  /** Segments lit: at least one once anything is typed. */
  get filled(): number {
    return Math.min(4, Math.max(1, this.score));
  }

  get level(): (typeof LEVELS)[number] {
    return LEVELS[this.filled - 1];
  }

  get rules(): { key: string; label: string; passed: boolean }[] {
    const value = this.value ?? '';
    return passwordRules(this.policy).map((r) => ({ key: r.key, label: r.label, passed: r.test(value) }));
  }
}
