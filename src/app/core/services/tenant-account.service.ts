import { Injectable, inject } from '@angular/core';
import { AuditLogService } from './audit-log.service';
import { ResidentsService } from './residents.service';
import { SystemSettingsService } from './system-settings.service';
import { passwordRules } from '../models/account.models';
import { HostelResident, residentFullName } from '../models/residents.models';

const ACCOUNTS_KEY = 'onehostel_tenant_accounts_v1';
/** Same key AccountService reads, so Change Password works for activated tenants unchanged. */
const PASSWORD_KEY = 'onehostel_pw_';

const OTP_MINUTES = 10;
const MAX_OTP_SENDS = 3;
const MAX_OTP_ATTEMPTS = 3;
const LOCK_MINUTES = 15;
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;

/** A Tenant's web sign-in. The password itself lives under `onehostel_pw_<userId>` (mock; hash it server-side). */
export interface TenantAccount {
  residentId: string;
  userId: string;
  email?: string;
  mobile?: string;
  activatedAt: string;
  consentAt: string;
  failedAttempts: number;
  lockedUntil?: string;
}

export interface OtpRequestResult {
  /** Always the same wording, whether or not the contact is registered. */
  message: string;
  /** Simulation only: stands in for the SMS / email a real build would send. */
  simulatedCode: string;
}

export interface OtpVerifyResult {
  ok: boolean;
  message: string;
  attemptsLeft?: number;
}

export type TenantLoginResult =
  | { ok: true; account: TenantAccount }
  | { ok: false; message: string; locked?: boolean };

interface ActivationSession {
  /** Undefined when the typed contact matched nobody; the flow still looks identical to the user. */
  residentId?: string;
  code: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
}

export const tenantUserId = (residentId: string): string => `tenant-${residentId}`;

/**
 * Tenant sign-in accounts and first-time activation (FRD 5.1): the resident verifies the contact the
 * Hostel Owner registered with a one-time code, then creates their own password. No permanent password
 * is ever sent. UI-only build: the code is shown in a "simulation" banner instead of an SMS / email.
 */
@Injectable({ providedIn: 'root' })
export class TenantAccountService {
  private readonly residents = inject(ResidentsService);
  private readonly audit = inject(AuditLogService);
  private readonly settings = inject(SystemSettingsService);

  private session: ActivationSession | null = null;
  private sendLog: Record<string, number[]> = {};

  // ---- Activation ----------------------------------------------------------------

  /**
   * Starts activation for the typed mobile / email. The reply never says whether the contact exists.
   * At most 3 codes per contact in 30 minutes.
   */
  requestOtp(identifier: string): OtpRequestResult {
    const typed = identifier.trim();
    if (!typed) throw new Error('Enter your registered mobile number or email.');

    const key = typed.toLowerCase();
    const now = Date.now();
    const recent = (this.sendLog[key] ?? []).filter((t) => now - t < 30 * 60_000);
    if (recent.length >= MAX_OTP_SENDS) {
      throw new Error('Too many codes requested. Please wait 30 minutes and try again.');
    }
    this.sendLog[key] = [...recent, now];

    const resident = this.findInvited(typed);
    const code = String(100000 + Math.floor(Math.random() * 900000));
    this.session = { residentId: resident?.residentId, code, expiresAt: now + OTP_MINUTES * 60_000, attempts: 0, verified: false };
    if (resident) {
      this.residents.recordActivationCodeSent(resident.residentId);
    }
    return {
      message: 'If this contact is registered with your hostel, a verification code has been sent.',
      simulatedCode: code,
    };
  }

  verifyOtp(code: string): OtpVerifyResult {
    const s = this.session;
    if (!s) return { ok: false, message: 'Request a verification code first.' };
    if (Date.now() > s.expiresAt) {
      this.session = null;
      return { ok: false, message: 'This code has expired. Request a new one.' };
    }
    if (s.attempts >= MAX_OTP_ATTEMPTS) {
      this.session = null;
      return { ok: false, message: 'Too many wrong codes. Request a new one.' };
    }
    const right = !!s.residentId && code.trim() === s.code;
    if (!right) {
      s.attempts += 1;
      const left = MAX_OTP_ATTEMPTS - s.attempts;
      if (left <= 0) this.session = null;
      return {
        ok: false,
        message: left > 0 ? `That code is not valid. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Request a new one.',
        attemptsLeft: Math.max(0, left),
      };
    }
    s.verified = true;
    return { ok: true, message: 'Contact verified.' };
  }

  get hasVerifiedSession(): boolean {
    return !!this.session?.verified;
  }

  /** Password format errors, in plain words (empty when the password passes). */
  passwordProblems(password: string): string[] {
    const s = this.settings.settings.security;
    return passwordRules({
      minLength: s.minPasswordLength,
      requireUppercase: s.requireUppercase,
      requireLowercase: s.requireLowercase,
      requireNumber: s.requireNumber,
      requireSpecialChar: s.requireSpecialChar,
    })
      .filter((r) => !r.test(password))
      .map((r) => r.label);
  }

  /** Creates the sign-in once the contact is verified. Activates the resident record. */
  activate(password: string, confirm: string, consent: boolean): TenantAccount {
    const s = this.session;
    if (!s?.verified || !s.residentId) throw new Error('Verify your contact before creating a password.');
    if (!consent) throw new Error('Accept the Terms and Privacy Notice to continue.');
    const problems = this.passwordProblems(password);
    if (problems.length) throw new Error(`Password must have: ${problems.join('; ')}.`);
    if (password !== confirm) throw new Error('Passwords do not match.');

    const resident = this.residents.byId(s.residentId);
    if (!resident || resident.status !== 'Invited' || resident.deactivatedAt) {
      this.session = null;
      throw new Error('This invitation is no longer valid. Contact your hostel office.');
    }

    const now = new Date().toISOString();
    const account: TenantAccount = {
      residentId: resident.residentId,
      userId: tenantUserId(resident.residentId),
      email: resident.email || undefined,
      mobile: resident.mobile,
      activatedAt: now,
      consentAt: now,
      failedAttempts: 0,
    };
    this.writeAccounts([...this.readAccounts().filter((a) => a.residentId !== account.residentId), account]);
    this.writePassword(account.userId, password);
    this.residents.markActivated(resident.residentId);
    this.audit.record('Activate Resident', residentFullName(resident), { details: 'Account activated by the resident.' });
    this.session = null;
    return account;
  }

  /** Full name for the header and greetings. */
  displayName(residentId: string): string {
    const r = this.residents.byId(residentId);
    return r ? residentFullName(r) : 'Tenant';
  }

  cancelActivation(): void {
    this.session = null;
  }

  // ---- Sign-in -------------------------------------------------------------------

  findByIdentifier(value: string): TenantAccount | null {
    const typed = value.trim().toLowerCase();
    if (!typed) return null;
    const digits = typed.replace(/\D/g, '');
    return (
      this.readAccounts().find(
        (a) =>
          (a.email && a.email.toLowerCase() === typed) ||
          (a.mobile && digits.length >= 10 && digits.slice(-10) === a.mobile.slice(-10)),
      ) ?? null
    );
  }

  /** Checks the password; wrong ones count toward the lockout limit in Settings → Security. */
  login(account: TenantAccount, password: string): TenantLoginResult {
    const resident = this.residents.byId(account.residentId);
    if (!resident || resident.deactivatedAt) {
      return { ok: false, message: 'This account is not active. Contact your hostel office.' };
    }
    if (resident.status === 'Checked Out') {
      return { ok: false, message: 'This account is closed because you have checked out.' };
    }

    const now = Date.now();
    if (account.lockedUntil && Date.parse(account.lockedUntil) > now) {
      return { ok: false, locked: true, message: `This account is locked after too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` };
    }

    if (password !== this.readPassword(account.userId)) {
      const max = Number(this.settings.settings.security.maxLoginAttempts) || DEFAULT_MAX_LOGIN_ATTEMPTS;
      const failed = (account.failedAttempts ?? 0) + 1;
      const locked = failed >= max;
      this.patch(account.residentId, {
        failedAttempts: locked ? 0 : failed,
        lockedUntil: locked ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : undefined,
      });
      return locked
        ? { ok: false, locked: true, message: `This account is locked after ${max} failed attempts. Try again in ${LOCK_MINUTES} minutes.` }
        : { ok: false, message: `Incorrect password. ${max - failed} attempt${max - failed === 1 ? '' : 's'} left before the account is locked.` };
    }

    this.patch(account.residentId, { failedAttempts: 0, lockedUntil: undefined });
    return { ok: true, account: { ...account, failedAttempts: 0, lockedUntil: undefined } };
  }

  // ---- Helpers -------------------------------------------------------------------

  private findInvited(typed: string): HostelResident | undefined {
    const lower = typed.toLowerCase();
    const digits = typed.replace(/\D/g, '');
    return this.residents.residents.find(
      (r) =>
        r.status === 'Invited' &&
        !r.deactivatedAt &&
        ((r.email && r.email.toLowerCase() === lower) || (digits.length >= 10 && digits.slice(-10) === r.mobile.slice(-10))),
    );
  }

  private patch(residentId: string, changes: Partial<TenantAccount>): void {
    this.writeAccounts(this.readAccounts().map((a) => (a.residentId === residentId ? { ...a, ...changes } : a)));
  }

  private readAccounts(): TenantAccount[] {
    try {
      const raw = localStorage.getItem(ACCOUNTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as TenantAccount[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAccounts(list: TenantAccount[]): void {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable */
    }
  }

  private readPassword(userId: string): string | null {
    try {
      return localStorage.getItem(PASSWORD_KEY + userId);
    } catch {
      return null;
    }
  }

  private writePassword(userId: string, password: string): void {
    try {
      localStorage.setItem(PASSWORD_KEY + userId, password);
    } catch {
      /* storage unavailable */
    }
  }
}
