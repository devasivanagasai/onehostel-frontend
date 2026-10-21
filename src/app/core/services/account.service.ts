import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, delay, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { SystemSettingsService } from './system-settings.service';
import { HostelAdminAccount, HostelAdminAccountService } from './hostel-admin-account.service';
import { AuditChange, diffForAudit } from '../models/audit.models';
import { BUILT_IN_PASSWORD, builtInAccountById } from '../models/built-in-accounts';
import { PROFILE_AUDIT_FIELDS, PasswordPolicy, UserProfile, profileFullName } from '../models/account.models';

const PROFILE_KEY = 'onehostel_profile_';
const PASSWORD_KEY = 'onehostel_pw_';
/** Role names shown as Designation on My Profile. */
const ADMIN_DESIGNATION = 'Admin';
const HOSTEL_OWNER_DESIGNATION = 'Hostel Owner';
const TENANT_DESIGNATION = 'Tenant';
const DEFAULT_FIRST_NAME = 'Admin';
const DEFAULT_LAST_NAME = 'User';
/** Starting password for mock Admin sign-ins other than the built-in accounts. */
const DEMO_PASSWORD = 'Password123!';
const DAY_MS = 86_400_000;

export type ChangePasswordResult = 'ok' | 'wrong-current';

export type ProfileChanges = Pick<UserProfile, 'firstName' | 'lastName' | 'email' | 'mobileCode' | 'mobile' | 'avatarDataUrl'>;

/**
 * The signed-in Admin's own account: profile details and password.
 *
 * UI-only build: the profile and a mock password are kept in localStorage per
 * user. Swap `saveProfile` / `changePassword` for `PUT /me` and
 * `POST /me/password` once the backend exists — passwords must only ever be
 * verified and stored (hashed) server-side.
 */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  readonly profile$: Observable<UserProfile | null> = this.profileSubject.asObservable();

  constructor(
    private auth: AuthService,
    private auditLog: AuditLogService,
    private settings: SystemSettingsService,
    private hostelAdmins: HostelAdminAccountService,
  ) {
    // Reload whenever a different user signs in (or out).
    this.auth.currentUser$.subscribe((user) => {
      const profile = user ? this.load(user.id, user.email) : null;
      this.profileSubject.next(profile);
      if (user && profile) this.syncSession(profile);
    });
  }

  get profile(): UserProfile | null {
    return this.profileSubject.value;
  }

  get minPasswordLength(): number {
    return this.settings.settings.security.minPasswordLength;
  }

  /** Password format from Settings → Security (read live, so a saved change applies straight away). */
  get passwordPolicy(): PasswordPolicy {
    const s = this.settings.settings.security;
    return {
      minLength: s.minPasswordLength,
      requireUppercase: s.requireUppercase,
      requireLowercase: s.requireLowercase,
      requireNumber: s.requireNumber,
      requireSpecialChar: s.requireSpecialChar,
    };
  }

  /** Days until the password expires per Settings → Security; null when passwords never expire. */
  get passwordExpiresInDays(): number | null {
    const expiry = this.settings.settings.security.passwordExpiryDays;
    if (!expiry || !this.profile) return null;
    const age = Math.floor((Date.now() - new Date(this.profile.passwordChangedAt).getTime()) / DAY_MS);
    return expiry - age;
  }

  get passwordAgeDays(): number {
    if (!this.profile) return 0;
    return Math.floor((Date.now() - new Date(this.profile.passwordChangedAt).getTime()) / DAY_MS);
  }

  /** Saves profile edits and records an audit entry. Returns the changed fields (empty if nothing changed). */
  saveProfile(changes: ProfileChanges): Observable<AuditChange[]> {
    const current = this.profile;
    if (!current) return of([]);

    const before = { ...current, avatar: current.avatarDataUrl ? 'Uploaded' : '—' };
    const after = { ...current, ...changes, avatar: changes.avatarDataUrl ? 'Uploaded' : '—' };
    const auditChanges = diffForAudit(before, after, PROFILE_AUDIT_FIELDS);
    // A photo swapped for another photo still counts as a change.
    if (current.avatarDataUrl && changes.avatarDataUrl && current.avatarDataUrl !== changes.avatarDataUrl) {
      auditChanges.push({ field: PROFILE_AUDIT_FIELDS['avatar'], oldValue: 'Uploaded', newValue: 'Replaced' });
    }
    if (!auditChanges.length) return of([]);

    const updated: UserProfile = { ...current, ...changes };
    return of(auditChanges).pipe(
      delay(500),
      tap(() => {
        this.persist(updated);
        this.profileSubject.next(updated);
        this.syncSession(updated);
        this.auditLog.record('Update Profile', profileFullName(updated), { changes: auditChanges });
      }),
    );
  }

  /** Saves just the profile photo (applied straight away, so the header avatar updates without a Save). */
  updatePhoto(avatarDataUrl: string): void {
    const current = this.profile;
    if (!current || current.avatarDataUrl === avatarDataUrl) return;

    const oldValue = current.avatarDataUrl ? 'Uploaded' : '—';
    const newValue = !avatarDataUrl ? '—' : current.avatarDataUrl ? 'Replaced' : 'Uploaded';
    const updated: UserProfile = { ...current, avatarDataUrl };
    this.persist(updated);
    this.profileSubject.next(updated);
    this.syncSession(updated);
    this.auditLog.record('Update Profile', profileFullName(updated), {
      changes: [{ field: PROFILE_AUDIT_FIELDS['avatar'], oldValue, newValue }],
    });
  }

  /**
   * Verifies the current password, then stores the new one: on the gateway (Keycloak and the users
   * collection), or in this browser for mock sign-in. Other backend failures (rules, reuse, network)
   * are thrown as the HttpErrorResponse.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<ChangePasswordResult> {
    const profile = this.profile;
    if (!profile) return of('wrong-current' as const);

    if (!environment.useMockAuth) {
      const name = profileFullName(profile);
      return this.auth.changePassword(currentPassword, newPassword).pipe(
        map((): ChangePasswordResult => 'ok'),
        catchError((error: HttpErrorResponse) => {
          if (error.error?.errorCode !== 'INVALID_CURRENT_PASSWORD') return throwError(() => error);
          this.auditLog.record('Change Password', name, { status: 'Failed', details: 'Current password was incorrect.' });
          return of('wrong-current' as const);
        }),
        tap((result) => {
          if (result !== 'ok') return;
          const updated: UserProfile = { ...profile, passwordChangedAt: new Date().toISOString() };
          this.persist(updated);
          this.profileSubject.next(updated);
          this.auditLog.record('Change Password', name, { details: 'Password changed by the account owner.' });
        }),
      );
    }

    const adminAccount = this.hostelAdminFor(profile.userId);
    const savedPassword = adminAccount ? adminAccount.password : this.readPassword(profile.userId);

    return of(savedPassword === currentPassword).pipe(
      delay(700),
      map((valid): ChangePasswordResult => (valid ? 'ok' : 'wrong-current')),
      tap((result) => {
        const name = profileFullName(profile);
        if (result === 'wrong-current') {
          this.auditLog.record('Change Password', name, { status: 'Failed', details: 'Current password was incorrect.' });
          return;
        }
        if (adminAccount) this.hostelAdmins.setPassword(adminAccount.hostelId, newPassword);
        else this.writePassword(profile.userId, newPassword);
        const updated: UserProfile = { ...profile, passwordChangedAt: new Date().toISOString() };
        this.persist(updated);
        this.profileSubject.next(updated);
        this.auditLog.record('Change Password', name, { details: 'Password changed by the account owner.' });
      }),
    );
  }

  // ---- Storage ---------------------------------------------------------------

  private load(userId: string, email: string): UserProfile {
    const account = this.hostelAdminFor(userId);
    try {
      const raw = localStorage.getItem(PROFILE_KEY + userId);
      if (raw) {
        const stored = JSON.parse(raw) as UserProfile;
        // Designation is the role (not editable), so always show the current role name.
        stored.designation = this.designationFor(userId, account);
        // Profiles saved before the role rename still carry the old default name "Super Admin".
        if (!account && stored.firstName === 'Super' && stored.lastName === 'Admin') {
          stored.firstName = DEFAULT_FIRST_NAME;
          stored.lastName = DEFAULT_LAST_NAME;
        }
        // A hostel owner's password date lives on their account (it changes on reset/re-onboarding too).
        return account?.passwordChangedAt ? { ...stored, passwordChangedAt: account.passwordChangedAt } : stored;
      }
    } catch {
      // Fall through to the default profile.
    }
    // Persist the starting profile so dates like "password last changed" stay fixed across reloads.
    const profile = account ? this.hostelAdminProfile(account, userId) : this.defaultProfile(userId, email);
    this.persist(profile);
    return profile;
  }

  private defaultProfile(userId: string, email: string): UserProfile {
    const builtIn = builtInAccountById(userId);
    return {
      userId,
      firstName: builtIn?.firstName ?? DEFAULT_FIRST_NAME,
      lastName: builtIn?.lastName ?? DEFAULT_LAST_NAME,
      email,
      mobileCode: '+91',
      mobile: '9876543210',
      designation: this.designationFor(userId, null),
      avatarDataUrl: '',
      memberSince: '2025-04-01',
      passwordChangedAt: new Date(Date.now() - 42 * DAY_MS).toISOString(),
    };
  }

  /** The role shown as Designation: Hostel Owner, Tenant (built-in tenant sign-in) or Admin. */
  private designationFor(userId: string, hostelOwner: HostelAdminAccount | null): string {
    if (hostelOwner) return HOSTEL_OWNER_DESIGNATION;
    return builtInAccountById(userId)?.role === 'Tenant' ? TENANT_DESIGNATION : ADMIN_DESIGNATION;
  }

  /** Hostel admins sign in with ids like "HST123456-admin" (see AuthService). */
  private hostelAdminFor(userId: string): HostelAdminAccount | null {
    return userId.endsWith('-admin') ? this.hostelAdmins.byHostelId(userId.slice(0, -'-admin'.length)) : null;
  }

  private hostelAdminProfile(account: HostelAdminAccount, userId: string): UserProfile {
    const [firstName, ...rest] = (account.name || account.username).split(' ');
    return {
      userId,
      firstName,
      lastName: rest.join(' '),
      email: account.email,
      mobileCode: '+91',
      mobile: account.mobileNumber,
      designation: HOSTEL_OWNER_DESIGNATION,
      avatarDataUrl: '',
      memberSince: (account.passwordChangedAt ?? new Date().toISOString()).slice(0, 10),
      passwordChangedAt: account.passwordChangedAt ?? new Date().toISOString(),
    };
  }

  private persist(profile: UserProfile): void {
    try {
      localStorage.setItem(PROFILE_KEY + profile.userId, JSON.stringify(profile));
    } catch {
      // Storage full or blocked — the change still applies for this session.
    }
  }

  private syncSession(profile: UserProfile): void {
    const user = this.auth.currentUser;
    const name = profileFullName(profile);
    if (user && (user.name !== name || user.email !== profile.email || (user.avatarUrl ?? '') !== profile.avatarDataUrl)) {
      this.auth.updateCurrentUser({ name, email: profile.email, avatarUrl: profile.avatarDataUrl });
    }
  }

  private readPassword(userId: string): string {
    try {
      return localStorage.getItem(PASSWORD_KEY + userId) ?? this.startingPassword(userId);
    } catch {
      return this.startingPassword(userId);
    }
  }

  /** Built-in sign-ins start with Password@123; any other mock Admin sign-in with DEMO_PASSWORD. */
  private startingPassword(userId: string): string {
    return builtInAccountById(userId) ? BUILT_IN_PASSWORD : DEMO_PASSWORD;
  }

  private writePassword(userId: string, password: string): void {
    try {
      localStorage.setItem(PASSWORD_KEY + userId, password);
    } catch {
      // Ignore — mock storage only.
    }
  }
}
