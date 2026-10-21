import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protects routes that require a signed-in web user (Admin, Hostel Owner, Hostel Manager) with a
 * usable session: an unexpired access token, or a refresh token that can still renew it.
 * Redirects to /login otherwise, with a returnUrl and the reason when there is one.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.hasValidSession() && authService.hasWebAccess) {
    return true;
  }

  // A tenant or guard session (e.g. left over from before the web portal was restricted).
  if (authService.hasValidSession()) {
    authService.endSession('mobile-app');
    return router.createUrlTree(['/login'], { queryParams: { reason: 'mobile-app' } });
  }

  const expired = authService.discardExpiredSession();
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url, ...(expired ? { reason: 'expired' } : {}) },
  });
};

/** Keeps an already-signed-in user off the login page, sending them to their home page. */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.hasValidSession()) {
    authService.discardExpiredSession();
    return true;
  }
  if (!authService.hasWebAccess) {
    authService.endSession('mobile-app');
    return true;
  }

  return router.parseUrl(authService.landingRoute);
};

/**
 * Lets the route open only for users with at least one of `roles`, by backend name
 * ('SUPER_ADMIN', 'HOSTEL_OWNER', 'HOSTEL_MANAGER') or app name ('Admin', 'HostelOwner', 'HostelManager').
 * Others are sent to their home page. Use after authGuard:
 *
 *   { path: 'audit-logs', canActivate: [roleGuard('SUPER_ADMIN')], loadComponent: ... }
 */
export function roleGuard(...roles: string[]): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    return authService.hasAnyRole(roles) ? true : inject(Router).parseUrl(authService.landingRoute);
  };
}
