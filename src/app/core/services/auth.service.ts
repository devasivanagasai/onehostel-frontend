import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, delay, of, switchMap, tap, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, LoginErrorCode, LoginRequest, LoginResponse } from '../models/auth.models';
import { AuditLogService } from './audit-log.service';
import { HostelAdminAccount, HostelAdminAccountService } from './hostel-admin-account.service';
import { builtInPassword, findBuiltInAccount } from '../models/built-in-accounts';
import { SystemSettingsService } from './system-settings.service';

const TOKEN_KEY = 'onehostel_token';
const USER_KEY = 'onehostel_user';
/** Admin-only modules. Hostel Owners and Tenants see only the Dashboard and their own account pages. */
export const ADMIN_ONLY_ROUTES = [
  '/hostel-onboarding',
  '/subscription-plans',
  '/communication-templates',
  '/admins',
  '/users',
  '/subscription-payments',
  '/reports',
  '/audit-logs',
  '/settings',
  '/institution',
  '/hostels',
];
/**
 * Hostel Owner modules: shown only to users with the Hostel Owner role.
 * Hidden from Admins (Super Admin) and Tenants, in the menu, global search and by URL (adminGuard).
 */
export const HOSTEL_OWNER_ROUTES = [
  '/rooms',
  '/residents',
  '/fees',
  '/complaints',
  '/laundry',
  '/visitors',
  '/mess',
  '/leave-outpass',
  '/attendance',
  '/parcels',
  '/announcements',
  '/hostel-reports',
  '/hostel-settings',
];

/** True when `route` is `base` or a page under it ("/fees", "/fees/123", "/fees?tab=charges"). */
export function matchesRoute(route: string, base: string): boolean {
  const path = route.split(/[?#]/)[0];
  return path === base || path.startsWith(base + '/');
}

/** When this browser last signed in (ISO). Kept after sign-out so My Profile can show it. */
const LAST_LOGIN_KEY = 'onehostel_last_login';
/** Used if Security Settings has no valid Maximum Login Attempts. */
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;

/**
 * Single source of truth for auth state. Persists the session to
 * localStorage (rememberMe) or sessionStorage (tab-only) and exposes the
 * current user as an observable so any component (e.g. the header) can
 * react to login/logout without re-fetching anything.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUser());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private auditLog: AuditLogService,
    private hostelAdmins: HostelAdminAccountService,
    private systemSettings: SystemSettingsService,
  ) {}

  get currentUser(): AuthUser | null {
    return this.currentUserSubject.value;
  }

  login(request: LoginRequest): Observable<LoginResponse> {
    // No backend exists yet for this UI-only build, so login is simulated
    // locally instead of calling `${this.apiUrl}/login`. Swap the body below
    // for `this.http.post<LoginResponse>(...)` once a real auth endpoint is
    // available — the rest of the app (guards, interceptor, currentUser$)
    // already expects exactly this Observable<LoginResponse> shape.
    const identifier = request.identifier.trim();
    const account = this.hostelAdmins.findByIdentifier(identifier);

    if (account) {
      if (account.lockedAt) return this.lockedError();
      if (request.password !== account.password) {
        return this.failedAttempt(account, 'Incorrect password.');
      }
      this.hostelAdmins.resetFailedAttempts(account.hostelId);
      return this.completeLogin(this.hostelAdminResponse(account), request.rememberMe ?? false);
    }

    // Built-in Admin / Tenant sign-ins (see built-in-accounts.ts) check their password.
    const builtIn = findBuiltInAccount(identifier);
    if (builtIn) {
      if (request.password !== builtInPassword(builtIn)) {
        this.auditLog.record('Login', builtIn.email, { status: 'Failed', details: 'Incorrect password.' });
        return this.fail('Incorrect password.');
      }
      return this.completeLogin(
        {
          token: `mock-token-${Date.now()}`,
          user: {
            id: builtIn.id,
            name: `${builtIn.firstName} ${builtIn.lastName}`,
            email: builtIn.email,
            roles: [builtIn.role],
          },
        },
        request.rememberMe ?? false,
      );
    }

    // Anyone else is treated as the mock Admin.
    return this.completeLogin(
      { token: `mock-token-${Date.now()}`, user: { id: 'mock-superadmin', name: identifier, email: identifier } },
      request.rememberMe ?? false,
    );
  }

  /** Counts a wrong password against Settings → Security → Maximum Login Attempts. */
  private failedAttempt(account: HostelAdminAccount, message: string): Observable<never> {
    const max = Number(this.systemSettings.settings.security.maxLoginAttempts) || DEFAULT_MAX_LOGIN_ATTEMPTS;
    const { locked, remaining } = this.hostelAdmins.recordFailedAttempt(account.hostelId, max);
    this.auditLog.record('Login', account.username || account.email, {
      status: 'Failed',
      details: locked ? `Account locked after ${max} failed attempts.` : message,
    });
    if (locked) return this.lockedError();
    return this.fail(`${message} ${remaining} attempt${remaining === 1 ? '' : 's'} left before the account is locked.`);
  }

  private lockedError(): Observable<never> {
    return this.fail(
      'This account is locked after too many failed login attempts. Contact your Admin to unlock it.',
      401,
      'LOCKED',
    );
  }

  /** `reason: 'timeout'` is passed on to the login page to explain an automatic sign-out. */
  logout(reason?: 'timeout'): void {
    const user = this.currentUser;
    if (user) {
      this.auditLog.record('Logout', user.name, {
        user: user.name,
        details: reason === 'timeout' ? 'Signed out automatically after inactivity (Session Timeout).' : undefined,
      });
    }
    this.clearSession();
    this.router.navigate(['/login'], reason ? { queryParams: { reason } } : {});
  }

  /**
   * Admin role: the built-in Admin, or the mock Admin sign-in (which carries no roles).
   * Hostel Owners and Tenants are not Admins.
   */
  get isAdmin(): boolean {
    const roles = this.currentUser?.roles;
    return !roles?.length || roles.includes('Admin');
  }

  get isHostelOwner(): boolean {
    const roles = this.currentUser?.roles;
    return !!roles && (roles.includes('HostelOwner') || roles.includes('Hostel Owner'));
  }

  get isTenant(): boolean {
    const roles = this.currentUser?.roles;
    return !!roles && roles.includes('Tenant');
  }

  /**
   * Whether the signed-in user may open this route. The single source for role-based visibility:
   * the sidebar, global search, dashboard shortcuts, notifications and adminGuard all use it.
   *  - Hostel Owner modules (HOSTEL_OWNER_ROUTES): Hostel Owners only.
   *  - Admin modules (ADMIN_ONLY_ROUTES): Admins only.
   *  - Everything else (Dashboard, Profile, Change Password): every signed-in user.
   */
  canAccess(route: string): boolean {
    if (HOSTEL_OWNER_ROUTES.some((r) => matchesRoute(route, r))) return this.isHostelOwner;
    if (ADMIN_ONLY_ROUTES.some((r) => matchesRoute(route, r))) return this.isAdmin;
    return true;
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  }

  /** Applies profile edits (name, email, photo) to the session so the header updates immediately. */
  updateCurrentUser(changes: Partial<Pick<AuthUser, 'name' | 'email' | 'avatarUrl'>>): void {
    const user = this.currentUser;
    if (!user) return;
    const updated: AuthUser = { ...user, ...changes };
    // Write back to whichever storage holds this session (remember-me vs tab-only).
    const storage = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
    try {
      storage.setItem(USER_KEY, JSON.stringify(updated));
    } catch {
      // Storage full (a large photo can do this) — the change still applies for this session.
    }
    this.currentUserSubject.next(updated);
  }

  private hostelAdminResponse(account: HostelAdminAccount): LoginResponse {
    return {
      token: `mock-token-${Date.now()}`,
      user: {
        id: `${account.hostelId}-admin`,
        name: account.name || account.username,
        email: account.email,
        roles: ['HostelOwner'],
      },
    };
  }

  private completeLogin(response: LoginResponse, rememberMe: boolean): Observable<LoginResponse> {
    return of(response).pipe(
      delay(600),
      tap((res) => {
        this.setSession(res, rememberMe);
        this.auditLog.record('Login', res.user.name);
      }),
    );
  }

  /** A rejected request, shaped like the error a real endpoint would return. */
  private fail(message?: string, status = 401, code?: LoginErrorCode): Observable<never> {
    return timer(600).pipe(
      switchMap(() => throwError(() => new HttpErrorResponse({ status, error: { message, code } }))),
    );
  }

  private setSession(response: LoginResponse, rememberMe: boolean): void {
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem(TOKEN_KEY, response.token);
    storage.setItem(USER_KEY, JSON.stringify(response.user));
    try {
      localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString());
    } catch {
      // Storage blocked: Last Login just isn't shown.
    }
    this.currentUserSubject.next(response.user);
  }

  /** When the user last signed in on this browser, or null if unknown. */
  get lastLoginAt(): string | null {
    try {
      return localStorage.getItem(LAST_LOGIN_KEY);
    } catch {
      return null;
    }
  }

  private clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.currentUserSubject.next(null);
  }

  private readUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }
}
