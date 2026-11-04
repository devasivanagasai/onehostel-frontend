import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { BUILT_IN_HOSTEL_OWNER } from '../models/built-in-accounts';

const STORAGE_KEY = 'onehostel_hostel_admins';

export interface HostelAdminAccount {
  hostelId: string;
  hostelName: string;
  name: string;
  email: string;
  mobileNumber: string;
  username: string;
  /** Temporary password issued at onboarding, until the admin changes it. */
  password: string;
  /** When the password was last set (drives Password Expiry). */
  passwordChangedAt?: string;
  /** Failed logins in a row; reset on a successful login. */
  failedAttempts?: number;
  /** Set while the account is locked; login is refused until a Admin unlocks it. */
  lockedAt?: string;
  lockReason?: string;
}

/** Result of a failed login attempt. */
export interface FailedAttemptResult {
  locked: boolean;
  remaining: number;
}

/**
 * Hostel admin login accounts created through hostel onboarding.
 *
 * No backend exists yet for this UI-only build, so accounts live in
 * localStorage (including the temporary password, in plain text). Replace
 * with API calls once an accounts endpoint is available.
 */
@Injectable({ providedIn: 'root' })
export class HostelAdminAccountService {
  /** Emits the account whenever its lock state changes, so other screens (Admin Management) can follow. */
  readonly lockChanges$ = new Subject<HostelAdminAccount>();

  /**
   * Creates the hostel's admin account, or updates it when the hostel already has one.
   * Lock state and failed attempts are kept; the password date moves only when the password changes.
   */
  save(account: HostelAdminAccount): void {
    const existing = this.byHostelId(account.hostelId);
    const passwordChanged = !existing || existing.password !== account.password;
    this.upsert({
      ...account,
      passwordChangedAt: passwordChanged ? new Date().toISOString() : existing?.passwordChangedAt,
      failedAttempts: existing?.failedAttempts ?? 0,
      lockedAt: existing?.lockedAt,
      lockReason: existing?.lockReason,
    });
  }

  byHostelId(hostelId: string): HostelAdminAccount | null {
    return this.readAll().find((a) => a.hostelId === hostelId) ?? null;
  }

  /** Finds the account whose email, mobile number or username equals the typed value. */
  findByIdentifier(value: string): HostelAdminAccount | null {
    const typed = value.trim();
    if (!typed) return null;

    const lower = typed.toLowerCase();
    const digits = typed.replace(/\D/g, '');

    return (
      this.readAll().find(
        (a) =>
          (a.email && a.email.toLowerCase() === lower) ||
          (a.username && a.username.toLowerCase() === lower) ||
          // Compare the last 10 digits so "+91 98765 43210" matches "9876543210".
          (a.mobileNumber && digits.length >= 10 && digits.slice(-10) === a.mobileNumber.slice(-10)),
      ) ?? null
    );
  }

  /** Counts a failed login; locks the account once `maxAttempts` is reached. */
  recordFailedAttempt(hostelId: string, maxAttempts: number): FailedAttemptResult {
    const account = this.byHostelId(hostelId);
    if (!account) return { locked: false, remaining: maxAttempts };

    const failedAttempts = (account.failedAttempts ?? 0) + 1;
    const locked = failedAttempts >= maxAttempts;
    const updated: HostelAdminAccount = {
      ...account,
      failedAttempts,
      ...(locked
        ? { lockedAt: new Date().toISOString(), lockReason: `Locked after ${failedAttempts} failed login attempts.` }
        : {}),
    };
    this.upsert(updated);
    if (locked) this.lockChanges$.next(updated);
    return { locked, remaining: Math.max(0, maxAttempts - failedAttempts) };
  }

  resetFailedAttempts(hostelId: string): void {
    const account = this.byHostelId(hostelId);
    if (account?.failedAttempts) this.upsert({ ...account, failedAttempts: 0 });
  }

  /** Locks or unlocks by email/username (used by Admin Management's Lock / Unlock actions). */
  setLocked(identifier: string, locked: boolean, reason?: string): void {
    const account = this.findByIdentifier(identifier);
    if (!account) return;
    const updated: HostelAdminAccount = locked
      ? { ...account, lockedAt: new Date().toISOString(), lockReason: reason }
      : { ...account, lockedAt: undefined, lockReason: undefined, failedAttempts: 0 };
    this.upsert(updated);
    this.lockChanges$.next(updated);
  }

  /** Stores a new password chosen by the admin (Change Password). */
  setPassword(hostelId: string, password: string): void {
    const account = this.byHostelId(hostelId);
    if (account) this.upsert({ ...account, password, passwordChangedAt: new Date().toISOString() });
  }

  /** All accounts that are currently locked. */
  lockedAccounts(): HostelAdminAccount[] {
    return this.readAll().filter((a) => !!a.lockedAt);
  }

  private upsert(account: HostelAdminAccount): void {
    const accounts = this.readAll().filter((a) => a.hostelId !== account.hostelId);
    accounts.push(account);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    } catch {
      // Storage unavailable/full — the account just won't persist in this mock build.
    }
  }

  /** Saved accounts, plus the built-in Hostel Owner sign-in until it has been saved itself. */
  private readAll(): HostelAdminAccount[] {
    let accounts: HostelAdminAccount[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Older builds stored a `loginMethod` (Password / OTP); sign-in is password-only now.
      accounts = raw ? (JSON.parse(raw) as (HostelAdminAccount & { loginMethod?: string })[]).map(({ loginMethod, ...a }) => a) : [];
    } catch {
      accounts = [];
    }
    if (!accounts.some((a) => a.hostelId === BUILT_IN_HOSTEL_OWNER.hostelId)) {
      accounts.push({ ...BUILT_IN_HOSTEL_OWNER, passwordChangedAt: new Date().toISOString() });
    }
    return accounts;
  }
}
