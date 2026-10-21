import { inject } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { Observable, catchError, of, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

/**
 * Gateway endpoints called without a bearer token: signing in, renewing and ending a session, and
 * password reset. Everything else, /auth/change-password included, carries the access token.
 */
const PUBLIC_ENDPOINTS = ['login', 'refresh-token', 'logout', 'otp/send', 'otp/verify', 'forgot-password/reset'].map(
  (path) => `${environment.apiUrl}/auth/${path}`,
);

function isApiRequest(url: string): boolean {
  return url.startsWith(environment.apiUrl);
}

function isPublicEndpoint(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return PUBLIC_ENDPOINTS.includes(path);
}

function isUnauthorized(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 401;
}

/**
 * For calls to the gateway:
 *  - adds X-Device-Id to every call and `Authorization: Bearer <access token>` to protected ones;
 *  - renews an access token that has already expired before sending, instead of waiting for the 401;
 *  - on a 401 (the gateway's is an empty body), refreshes once and retries. Requests failing at the
 *    same time share that one refresh (AuthService.refreshToken), so none of them are dropped;
 *  - signs out to /login (keeping the page as returnUrl) when the session can't be renewed.
 * Calls to other hosts pass through untouched, so the token never leaves for a third party.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url)) return next(req);

  const auth = inject(AuthService);
  const deviceReq = req.clone({ setHeaders: { 'X-Device-Id': auth.deviceId } });
  if (isPublicEndpoint(req.url)) return next(deviceReq);

  const send = (token: string | null): Observable<HttpEvent<unknown>> =>
    next(token ? deviceReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : deviceReq);

  /** A token pair the session can't renew: sign out and fail the request. */
  const endSession = (error: unknown): Observable<never> => {
    auth.logout('expired');
    return throwError(() => error);
  };

  const token = auth.getAccessToken();
  if (!token) return send(null);

  // Expired already: renew first, so the request goes out once with a working token.
  if (auth.isAccessTokenExpired() && auth.getRefreshToken()) {
    return auth.refreshToken().pipe(
      catchError(endSession),
      switchMap((fresh) => send(fresh)),
      catchError((error: unknown) => (isUnauthorized(error) && auth.getAccessToken() ? endSession(error) : throwError(() => error))),
    );
  }

  return send(token).pipe(
    catchError((error: unknown) => {
      if (!isUnauthorized(error) || !auth.getAccessToken()) return throwError(() => error);

      // Another request may have refreshed while this one was in flight: then just resend with that token.
      const current = auth.getAccessToken();
      const fresh$ = current && current !== token && !auth.isAccessTokenExpired() ? of(current) : auth.refreshToken();

      return fresh$.pipe(
        catchError(() => endSession(error)),
        switchMap((fresh) => send(fresh)),
        // Rejected again with a brand-new token: the session itself is no longer valid.
        catchError((retryError: unknown) =>
          isUnauthorized(retryError) && auth.getAccessToken() ? endSession(retryError) : throwError(() => retryError),
        ),
      );
    }),
  );
};
