import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** The signed-in Admin's own profile (not a hostel admin). */
export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobileCode: string;
  mobile: string;
  designation: string;
  /** Data URL of the uploaded photo; empty = initials avatar. */
  avatarDataUrl: string;
  /** ISO date. */
  memberSince: string;
  /** ISO date-time of the last successful password change. */
  passwordChangedAt: string;
}

export const profileFullName = (p: Pick<UserProfile, 'firstName' | 'lastName'>): string =>
  `${p.firstName} ${p.lastName}`.trim();

export const profileInitials = (p: Pick<UserProfile, 'firstName' | 'lastName'>): string =>
  `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase() || 'SA';

export const MOBILE_CODES = ['+91', '+971', '+44', '+1', '+65'];

export const PROFILE_AUDIT_FIELDS: Record<string, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  mobile: 'Mobile',
  mobileCode: 'Mobile Code',
  avatar: 'Profile Photo',
};

// ---- Password rules ----------------------------------------------------------

export interface PasswordRule {
  key: string;
  label: string;
  test: (value: string) => boolean;
}

/** Password format from Settings → Security. */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
}

/** Rules every new password must pass: the minimum length and whichever format rules Settings turns on. */
export function passwordRules(policy: PasswordPolicy): PasswordRule[] {
  const { minLength } = policy;
  const rules: (PasswordRule | false)[] = [
    { key: 'length', label: `At least ${minLength} characters`, test: (v) => v.length >= minLength },
    policy.requireUppercase && { key: 'upper', label: 'One uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
    policy.requireLowercase && { key: 'lower', label: 'One lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
    policy.requireNumber && { key: 'number', label: 'One number (0–9)', test: (v) => /\d/.test(v) },
    policy.requireSpecialChar && { key: 'special', label: 'One special character (!@#$…)', test: (v) => /[^A-Za-z0-9\s]/.test(v) },
    { key: 'spaces', label: 'No spaces', test: (v) => v.length > 0 && !/\s/.test(v) },
  ];
  return rules.filter((r): r is PasswordRule => !!r);
}

export type PasswordStrengthLabel = 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface PasswordStrength {
  /** 0–4 */
  score: number;
  label: PasswordStrengthLabel;
}

export function passwordStrength(value: string, policy: PasswordPolicy): PasswordStrength {
  if (!value) return { score: 0, label: 'Too weak' };
  const rules = passwordRules(policy);
  const passed = rules.filter((r) => r.test(value)).length;
  const lengthBonus = value.length >= policy.minLength + 4 ? 1 : 0;
  // Rules passed + length bonus, mapped onto 0–4 (the rule count depends on Settings).
  const score = Math.min(4, Math.max(0, Math.floor(((passed + lengthBonus) / (rules.length + 1)) * 4)));
  const labels: PasswordStrengthLabel[] = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
}

/** Fails with `{ passwordRules: [failed rule keys] }` until every rule passes. */
export function passwordPolicyValidator(policy: () => PasswordPolicy): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: string = control.value ?? '';
    if (!value) return null; // `required` reports the empty case
    const failed = passwordRules(policy()).filter((r) => !r.test(value)).map((r) => r.key);
    return failed.length ? { passwordRules: failed } : null;
  };
}

/** Group validator: new ≠ current, confirm = new. */
export const changePasswordGroupValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const current = group.get('currentPassword')?.value ?? '';
  const next = group.get('newPassword')?.value ?? '';
  const confirm = group.get('confirmPassword')?.value ?? '';
  const errors: ValidationErrors = {};
  if (current && next && current === next) errors['sameAsCurrent'] = true;
  if (confirm && next !== confirm) errors['mismatch'] = true;
  return Object.keys(errors).length ? errors : null;
};
