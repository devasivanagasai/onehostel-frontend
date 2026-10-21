import { Injectable, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  delay,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AccessTokenClaims,
  ApiResponse,
  AuthUser,
  CommonRequestObject,
  JwtUserPayload,
  KeycloakTokenResponse,
  LoginCredentials,
  LoginErrorCode,
  LoginRequest,
  LoginResponse,
  LogoutReason,
  MOBILE_APP_ONLY_MESSAGE,
  OtpPurpose,
  OtpSendResult,
  WEB_ROLES,
  normalizeIdentifier,
} from '../models/auth.models';
import { AuditLogService } from './audit-log.service';
import { HostelAdminAccount, HostelAdminAccountService } from './hostel-admin-account.service';
import { builtInPassword, findBuiltInAccount } from '../models/built-in-accounts';
import { SystemSettingsService } from './system-settings.service';

const TOKEN_KEY = 'onehostel_token';
const USER_KEY = 'onehostel_user';
const REFRESH_TOKEN_KEY = 'onehostel_refresh_token';
/** When the access / refresh token expires (epoch ms). Absent for mock sessions, which never expire. */
const TOKEN_EXPIRES_KEY = 'onehostel_token_expires_at';
const REFRESH_EXPIRES_KEY = 'onehostel_refresh_expires_at';
/** Identifies this browser to the gateway (X-Device-Id). Kept across sign-ins. */
const DEVICE_ID_KEY = 'onehostel_device_id';
const SESSION_KEYS = [TOKEN_KEY, USER_KEY, REFRESH_TOKEN_KEY, TOKEN_EXPIRES_KEY, REFRESH_EXPIRES_KEY];
/** Treat the access token as expired this early, to absorb clock skew and request latency. */
const EXPIRY_SKEW_MS = 30_000;

/** Where each web role lands after signing in (and on "/"), checked in this order. */
const LANDING_ROUTES: { role: string; route: string }[] = [
  { role: 'Admin', route: '/admin/onboarding' },
  { role: 'HostelOwner', route: '/owner/dashboard' },
  { role: 'HostelManager', route: '/manager/branch-overview' },
];
const DEFAULT_LANDING_ROUTE = '/dashboard';

/** Admin-only modules. Hostel Owners and Tenants see only the Dashboard and their own account pages. */
export const ADMIN_ONLY_ROUTES = [
  '/admin',
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
/** Pages for one hostel role only: the Hostel Owner's and the Hostel Manager's landing pages. */
const OWNER_ONLY_ROUTES = ['/owner'];
const MANAGER_ONLY_ROUTES = ['/manager'];
/**
 * Hostel modules: shown only to Hostel Owners and Hostel Managers.
 * Hidden from Admins (Super Admin), in the menu, global search and by URL (adminGuard).
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
/** OTP lifetime when the backend doesn't say (GlobalConstants.OTP_EXPIRY_SECONDS). */
const DEFAULT_OTP_EXPIRY_SECONDS = 300;
/** Mock sign-in (environment.useMockAuth) accepts any 6-digit code; nothing is really sent. */
const MOCK_OTP_PATTERN = /^\d{6}$/;

/**
 * Single source of truth for auth state. Persists the session to
 * localStorage (rememberMe) or sessionStorage (tab-only) and exposes the
 * current user as an observable and as signals, so any component (e.g. the
 * header) can react to login/logout without re-fetching anything.
 *
 * Tokens live in Web Storage, which page scripts can read: keep the access
 * token short-lived (the gateway issues 15 minutes) and the app free of XSS.
 * Moving the refresh token to an HttpOnly cookie set by the gateway would
 * take it out of reach of scripts entirely.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUser());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();
  /** The signed-in user, as a signal. */
  readonly user = toSignal(this.currentUser$, { requireSync: true });
  /** Whether someone is signed in. Use hasValidSession() to also check that the tokens are still usable. */
  readonly isAuthenticated = computed(() => !!this.user());

  /** The refresh in flight, shared by every caller so concurrent 401s trigger a single refresh. */
  private refreshInFlight$: Observable<string> | null = null;

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
    return environment.useMockAuth ? this.mockLogin(request) : this.backendLogin(request);
  }

  /** POST /auth/login on oh-auth-gtwy, which signs in with Keycloak and returns its tokens. */
  private backendLogin(request: LoginRequest): Observable<LoginResponse> {
    const identifier = normalizeIdentifier(request.identifier);
    const credentials: LoginCredentials = { identifier, password: request.password };

    return this.startBackendSession(
      this.http.post<ApiResponse<KeycloakTokenResponse>>(`${this.apiUrl}/login`, envelope(credentials)),
      identifier,
      request.rememberMe ?? false,
    );
  }

  /**
   * POST /auth/refresh-token: swaps the refresh token for a new token pair and stores both
   * (the gateway revokes the old refresh token at once). Emits the new access token.
   * Concurrent callers share one request.
   */
  refreshToken(): Observable<string> {
    if (this.refreshInFlight$) return this.refreshInFlight$;

    const refreshToken = this.getRefreshToken();
    if (environment.useMockAuth || !refreshToken || this.isRefreshTokenExpired()) {
      return throwError(() => new HttpErrorResponse({ status: 401, error: { message: 'Your session has expired.' } }));
    }

    this.refreshInFlight$ = this.http
      .post<ApiResponse<KeycloakTokenResponse>>(`${this.apiUrl}/refresh-token`, null, {
        headers: { 'X-Refresh-Token': refreshToken },
      })
      .pipe(
        map((res) => toLoginResponse(res, this.currentUser?.email ?? '')),
        tap((res) => {
          // Roles and organisation come from the new token; name and photo edits made in the app stay.
          const current = this.currentUser;
          const user = current ? { ...res.user, name: current.name, avatarUrl: current.avatarUrl } : res.user;
          this.storeSession({ ...res, user }, this.activeStorage());
        }),
        map((res) => res.token),
        finalize(() => (this.refreshInFlight$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  /** POST /auth/otp/send: emails (identifier has an @) or texts a 6-digit sign-in code. */
  sendLoginOtp(identifier: string): Observable<OtpSendResult> {
    return this.sendCode('LOGIN', identifier);
  }

  /** POST /auth/otp/verify: signs in with the code from sendLoginOtp. */
  loginWithOtp(identifier: string, otp: string, rememberMe = false): Observable<LoginResponse> {
    identifier = normalizeIdentifier(identifier);
    if (environment.useMockAuth) {
      if (!MOCK_OTP_PATTERN.test(otp)) {
        this.auditLog.record('Login', identifier, { status: 'Failed', details: 'Incorrect OTP.' });
        return this.fail('Incorrect OTP. Please check the code and try again.');
      }
      const account = this.hostelAdmins.findByIdentifier(identifier);
      if (account?.lockedAt) return this.lockedError();
      return this.completeLogin(this.mockResponseFor(identifier), rememberMe);
    }

    return this.startBackendSession(
      this.http.post<ApiResponse<KeycloakTokenResponse>>(
        `${this.apiUrl}/otp/verify`,
        envelope({ identifier, otp }),
      ),
      identifier,
      rememberMe,
    );
  }

  /** POST /auth/otp/send (purpose FORGOT_PASSWORD): emails or texts a 6-digit code for resetting the password. */
  requestPasswordReset(identifier: string): Observable<OtpSendResult> {
    return this.sendCode('FORGOT_PASSWORD', identifier);
  }

  /**
   * POST /auth/forgot-password/reset: sets a new password with the code from requestPasswordReset.
   * The gateway also ends every session of that user, so they sign in again afterwards.
   */
  resetPassword(identifier: string, otp: string, newPassword: string): Observable<string> {
    identifier = normalizeIdentifier(identifier);
    const done = 'Password reset successfully. Please log in with your new password.';
    const audit = () =>
      this.auditLog.record('Reset Password', identifier, { user: identifier, details: 'Password reset with a one-time code.' });

    if (environment.useMockAuth) {
      if (!MOCK_OTP_PATTERN.test(otp)) return this.fail('The code is incorrect or has expired.');
      return of(done).pipe(delay(600), tap(audit));
    }

    return this.http
      .post<ApiResponse<unknown>>(
        `${this.apiUrl}/forgot-password/reset`,
        envelope({ identifier, otp, newPassword }),
      )
      .pipe(
        map((res) => {
          if (!res.success) throw new HttpErrorResponse({ status: res.statusCode || 400, error: res });
          return done;
        }),
        tap(audit),
      );
  }

  /**
   * POST /auth/change-password (signed in): checks the current password and stores the new one.
   * Fails with 400 INVALID_CURRENT_PASSWORD, PASSWORD_REUSED or VALIDATION_FAILED. Emits the backend's message.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<string> {
    return this.http
      .post<ApiResponse<unknown>>(`${this.apiUrl}/change-password`, envelope({ currentPassword, newPassword }))
      .pipe(
        map((res) => {
          if (!res.success) throw new HttpErrorResponse({ status: res.statusCode || 400, error: res });
          return res.message || 'Password changed successfully.';
        }),
      );
  }

  /**
   * POST /auth/otp/send: the gateway emails or texts a code, picking the channel from the identifier.
   * An unknown account fails with 404 ENTITY_NOT_FOUND.
   */
  private sendCode(purpose: OtpPurpose, identifier: string): Observable<OtpSendResult> {
    identifier = normalizeIdentifier(identifier);
    if (environment.useMockAuth) {
      return of({ expiresInSeconds: DEFAULT_OTP_EXPIRY_SECONDS }).pipe(delay(600));
    }

    return this.http
      .post<ApiResponse<OtpSendResult>>(`${this.apiUrl}/otp/send`, envelope({ identifier, purpose }))
      .pipe(
        map((res) => {
          if (!res.success) throw new HttpErrorResponse({ status: res.statusCode || 400, error: res });
          return {
            channel: res.responseObject?.channel,
            expiresInSeconds: res.responseObject?.expiresInSeconds || DEFAULT_OTP_EXPIRY_SECONDS,
          };
        }),
      );
  }

  /**
   * Tenants and security guards use the mobile app: their web sign-in is refused, and the
   * session the gateway just opened for them is revoked.
   */
  private rejectMobileOnly(res: LoginResponse): void {
    if (isWebUser(res.user)) return;
    if (!environment.useMockAuth && res.refreshToken) {
      this.http
        .post(`${this.apiUrl}/logout`, null, { headers: { 'X-Refresh-Token': res.refreshToken } })
        .pipe(catchError(() => EMPTY))
        .subscribe();
    }
    throw new HttpErrorResponse({
      status: 403,
      error: { success: false, statusCode: 403, errorCode: 'MOBILE_APP_ONLY', message: MOBILE_APP_ONLY_MESSAGE },
    });
  }

  /** Turns a Keycloak token reply from the gateway into a session (password and OTP sign-in). */
  private startBackendSession(
    request$: Observable<ApiResponse<KeycloakTokenResponse>>,
    identifier: string,
    rememberMe: boolean,
  ): Observable<LoginResponse> {
    return request$.pipe(
      map((res) => toLoginResponse(res, identifier)),
      tap((res) => this.rejectMobileOnly(res)),
      tap((res) => {
        this.setSession(res, rememberMe);
        this.auditLog.record('Login', res.user.name);
      }),
      catchError((error: HttpErrorResponse) => {
        this.auditLog.record('Login', identifier, { status: 'Failed', details: error.error?.message });
        return throwError(() => error);
      }),
    );
  }

  /** Mock session for an identifier: a Hostel Owner account, a built-in account, or else the mock Admin. */
  private mockResponseFor(identifier: string): LoginResponse {
    const account = this.hostelAdmins.findByIdentifier(identifier);
    if (account) return this.hostelAdminResponse(account);
    const builtIn = findBuiltInAccount(identifier);
    if (builtIn) {
      return {
        token: `mock-token-${Date.now()}`,
        user: {
          id: builtIn.id,
          name: `${builtIn.firstName} ${builtIn.lastName}`,
          email: builtIn.email,
          roles: [builtIn.role],
        },
      };
    }
    return { token: `mock-token-${Date.now()}`, user: { id: 'mock-superadmin', name: identifier, email: identifier } };
  }

  /** Signs in against the local built-in and Hostel Owner accounts (environment.useMockAuth). */
  private mockLogin(request: LoginRequest): Observable<LoginResponse> {
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
    if (builtIn && request.password !== builtInPassword(builtIn)) {
      this.auditLog.record('Login', builtIn.email, { status: 'Failed', details: 'Incorrect password.' });
      return this.fail('Incorrect password.');
    }

    // Anyone else is treated as the mock Admin.
    return this.completeLogin(this.mockResponseFor(identifier), request.rememberMe ?? false);
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

  /**
   * Ends the session and goes to the login page. `reason` is passed on to explain an automatic
   * sign-out; after 'expired' the user comes back to the page they were on once signed in again.
   */
  logout(reason?: LogoutReason): void {
    this.endSession(reason);

    const queryParams: Record<string, string> = {};
    if (reason) queryParams['reason'] = reason;
    const currentUrl = this.router.url;
    if (reason === 'expired' && !currentUrl.startsWith('/login')) queryParams['returnUrl'] = currentUrl;
    this.router.navigate(['/login'], { queryParams });
  }

  /** Signs out without navigating (for guards, which redirect themselves): audit, revoke, clear. */
  endSession(reason?: LogoutReason): void {
    const user = this.currentUser;
    if (user) {
      this.auditLog.record('Logout', user.name, {
        user: user.name,
        details:
          reason === 'timeout'
            ? 'Signed out automatically after inactivity (Session Timeout).'
            : reason === 'expired'
              ? 'Signed out because the session expired.'
              : reason === 'mobile-app'
                ? 'Signed out: this role uses the mobile app.'
                : undefined,
      });
    }
    const refreshToken = this.getRefreshToken();
    // Cleared first so the logout call goes out without the (possibly expired) bearer token.
    this.clearSession();
    if (!environment.useMockAuth && refreshToken && reason !== 'expired') {
      // Fire-and-forget: the user is signed out locally whether or not the backend revokes the token.
      this.http
        .post(`${this.apiUrl}/logout`, null, { headers: { 'X-Refresh-Token': refreshToken } })
        .pipe(catchError(() => EMPTY))
        .subscribe();
    }
  }

  /**
   * Admin role: the Admin role, or (mock sign-in only) the mock Admin, which carries no roles.
   * Hostel Owners and Tenants are not Admins.
   */
  get isAdmin(): boolean {
    const roles = this.currentUser?.roles;
    return roles?.length ? roles.includes('Admin') : environment.useMockAuth;
  }

  get isHostelOwner(): boolean {
    const roles = this.currentUser?.roles;
    return !!roles && (roles.includes('HostelOwner') || roles.includes('Hostel Owner'));
  }

  get isHostelManager(): boolean {
    return !!this.currentUser?.roles?.includes('HostelManager');
  }

  get isTenant(): boolean {
    const roles = this.currentUser?.roles;
    return !!roles && roles.includes('Tenant');
  }

  /** Whether the signed-in user may use the web portal (Admin, Hostel Owner, Hostel Manager). */
  get hasWebAccess(): boolean {
    const user = this.currentUser;
    return !!user && isWebUser(user);
  }

  /** The signed-in user's home page: Admin → onboarding, Hostel Owner → dashboard, Hostel Manager → branch overview. */
  get landingRoute(): string {
    const roles = this.currentUser?.roles ?? [];
    if (!roles.length && this.isAdmin) return LANDING_ROUTES[0].route; // the mock Admin carries no roles
    return LANDING_ROUTES.find((l) => roles.includes(l.role))?.route ?? DEFAULT_LANDING_ROUTE;
  }

  /**
   * Whether the signed-in user has a role, by app name ('Admin', 'HostelOwner', 'Tenant') or by
   * backend name ('SUPER_ADMIN', 'HOSTEL_OWNER', ...). Case, '_' and '-' are ignored.
   */
  hasRole(role: string): boolean {
    const user = this.currentUser;
    if (!user) return false;
    const wanted = normalizeRole(role);
    return [...(user.roles ?? []), ...(user.backendRoles ?? [])].some((r) => normalizeRole(r) === wanted);
  }

  hasAnyRole(roles: readonly string[]): boolean {
    return roles.some((role) => this.hasRole(role));
  }

  /**
   * Whether the signed-in user may open this route. The single source for role-based visibility:
   * the sidebar, global search, dashboard shortcuts, notifications and adminGuard all use it.
   *  - Hostel Owner modules (HOSTEL_OWNER_ROUTES): Hostel Owners only.
   *  - Admin modules (ADMIN_ONLY_ROUTES): Admins only.
   *  - Everything else (Dashboard, Profile, Change Password): every signed-in user.
   */
  canAccess(route: string): boolean {
    if (OWNER_ONLY_ROUTES.some((r) => matchesRoute(route, r))) return this.isHostelOwner;
    if (MANAGER_ONLY_ROUTES.some((r) => matchesRoute(route, r))) return this.isHostelManager;
    if (HOSTEL_OWNER_ROUTES.some((r) => matchesRoute(route, r))) return this.isHostelOwner || this.isHostelManager;
    if (ADMIN_ONLY_ROUTES.some((r) => matchesRoute(route, r))) return this.isAdmin;
    return true;
  }

  /**
   * Signed in with tokens that still work: an unexpired access token, or an expired one
   * with a refresh token that can still renew it.
   */
  hasValidSession(): boolean {
    if (!this.isAuthenticated() || !this.getAccessToken()) return false;
    if (!this.isAccessTokenExpired()) return true;
    return !!this.getRefreshToken() && !this.isRefreshTokenExpired();
  }

  /** Drops a stored session whose tokens can no longer be used, without navigating. True if one was dropped. */
  discardExpiredSession(): boolean {
    if (!this.isAuthenticated() || this.hasValidSession()) return false;
    this.clearSession();
    return true;
  }

  /** True once the access token is (about to be) expired. Mock tokens never expire. */
  isAccessTokenExpired(): boolean {
    const expiresAt = this.readExpiry(TOKEN_EXPIRES_KEY);
    return expiresAt !== null && Date.now() >= expiresAt - EXPIRY_SKEW_MS;
  }

  private isRefreshTokenExpired(): boolean {
    const expiresAt = this.readExpiry(REFRESH_EXPIRES_KEY);
    return expiresAt !== null && Date.now() >= expiresAt;
  }

  getAccessToken(): string | null {
    return this.readSessionValue(TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return this.readSessionValue(REFRESH_TOKEN_KEY);
  }

  /** The claims of the current access token, or null when there is none or it isn't a JWT (mock sign-in). */
  getTokenPayload(): JwtUserPayload | null {
    const token = this.getAccessToken();
    return token ? decodeAccessToken(token) : null;
  }

  /** A random id for this browser, sent as X-Device-Id so the gateway can tie refresh tokens to a device. */
  get deviceId(): string {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = newDeviceId();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch {
      return (this.fallbackDeviceId ??= newDeviceId());
    }
  }
  private fallbackDeviceId?: string;

  /** Applies profile edits (name, email, photo) to the session so the header updates immediately. */
  updateCurrentUser(changes: Partial<Pick<AuthUser, 'name' | 'email' | 'avatarUrl'>>): void {
    const user = this.currentUser;
    if (!user) return;
    const updated: AuthUser = { ...user, ...changes };
    try {
      this.activeStorage().setItem(USER_KEY, JSON.stringify(updated));
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
      tap((res) => this.rejectMobileOnly(res)),
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
    // Drop any session left in the other storage so the two can't disagree.
    this.clearStoredSession();
    this.storeSession(response, rememberMe ? localStorage : sessionStorage);
    try {
      localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString());
    } catch {
      // Storage blocked: Last Login just isn't shown.
    }
  }

  private storeSession(response: LoginResponse, storage: Storage): void {
    const now = Date.now();
    storage.setItem(TOKEN_KEY, response.token);
    storage.setItem(USER_KEY, JSON.stringify(response.user));
    setOrRemove(storage, REFRESH_TOKEN_KEY, response.refreshToken);
    setOrRemove(storage, TOKEN_EXPIRES_KEY, response.expiresIn ? String(now + response.expiresIn * 1000) : undefined);
    setOrRemove(
      storage,
      REFRESH_EXPIRES_KEY,
      response.refreshExpiresIn ? String(now + response.refreshExpiresIn * 1000) : undefined,
    );
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
    this.clearStoredSession();
    this.currentUserSubject.next(null);
  }

  private clearStoredSession(): void {
    for (const key of SESSION_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  }

  /** The storage holding the current session: localStorage after "remember me", else sessionStorage. */
  private activeStorage(): Storage {
    return localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  }

  private readSessionValue(key: string): string | null {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  }

  private readExpiry(key: string): number | null {
    const value = Number(this.readSessionValue(key));
    return value > 0 ? value : null;
  }

  private readUser(): AuthUser | null {
    if (!this.readSessionValue(TOKEN_KEY)) return null;
    const raw = this.readSessionValue(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }
}

/** Wraps a body in the CommonRequestObject envelope every gateway endpoint expects. */
function envelope<T>(requestObject: T): CommonRequestObject<T> {
  return { requestObject, clientSource: 'WEB', requestedAt: new Date().toISOString() };
}

/** Reads a gateway token reply, failing like an HTTP error when it reports no success. */
function toLoginResponse(res: ApiResponse<KeycloakTokenResponse>, identifier: string): LoginResponse {
  const tokens = res.responseObject;
  if (!res.success || !tokens?.access_token) {
    throw new HttpErrorResponse({ status: res.statusCode || 401, error: res });
  }
  return {
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    refreshExpiresIn: tokens.refresh_expires_in,
    user: userFromAccessToken(tokens.access_token, identifier),
  };
}


function setOrRemove(storage: Storage, key: string, value: string | undefined): void {
  if (value) storage.setItem(key, value);
  else storage.removeItem(key);
}

function newDeviceId(): string {
  // randomUUID needs a secure context (https or localhost); getRandomValues works everywhere.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 'SUPER_ADMIN', 'super-admin' and 'SuperAdmin' all compare equal. */
function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[^a-z]/g, '');
}

/** Backend roles (normalized) mapped to the app roles the UI checks. */
const APP_ROLES: Record<string, string> = {
  admin: 'Admin',
  superadmin: 'Admin',
  hostelowner: 'HostelOwner',
  hostelmanager: 'HostelManager',
  tenant: 'Tenant',
  hosteltenant: 'Tenant',
  resident: 'Tenant',
  securityguard: 'SecurityGuard',
};

/** App roles of the web roles (WEB_ROLES). */
const WEB_APP_ROLES = new Set(WEB_ROLES.map((role) => APP_ROLES[normalizeRole(role)]));

/**
 * Admins, Hostel Owners and Hostel Managers use the web portal; tenants and guards the mobile app.
 * The mock Admin (mock sign-in only) carries no roles.
 */
function isWebUser(user: AuthUser): boolean {
  const roles = user.roles ?? [];
  if (!roles.length) return environment.useMockAuth && !user.backendRoles?.length;
  return roles.some((role) => WEB_APP_ROLES.has(role));
}

function decodeClaims(token: string): AccessTokenClaims | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(atob(payload), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}

/** Reads the user from a Keycloak access token issued by the gateway; null if it isn't a readable JWT. */
export function decodeAccessToken(token: string): JwtUserPayload | null {
  const claims = decodeClaims(token);
  if (!claims?.sub) return null;

  const roles = [
    ...new Set([
      ...(claims.roles ?? []),
      ...(claims.realm_access?.roles ?? []),
      ...Object.values(claims.resource_access ?? {}).flatMap((client) => client?.roles ?? []),
    ]),
  ];
  const fullName = [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  const username = claims.preferred_username ?? claims.email ?? claims.sub;

  return {
    userId: claims.sub,
    username,
    email: claims.email ?? '',
    name: claims.name ?? (fullName || username),
    roles,
    organizationId: claims.organization_id,
    expiresAt: claims.exp * 1000,
  };
}

/** Builds the signed-in user from a gateway access token, falling back to what the user typed. */
function userFromAccessToken(token: string, identifier: string): AuthUser {
  const payload = decodeAccessToken(token);
  if (!payload) {
    return { id: identifier, name: identifier, email: identifier.includes('@') ? identifier : '', roles: [] };
  }
  const appRoles = [
    ...new Set(payload.roles.map((role) => APP_ROLES[normalizeRole(role)]).filter((role): role is string => !!role)),
  ];
  return {
    id: payload.userId,
    name: payload.name,
    email: payload.email || (identifier.includes('@') ? identifier : ''),
    username: payload.username,
    organizationId: payload.organizationId,
    roles: appRoles,
    backendRoles: payload.roles,
  };
}
