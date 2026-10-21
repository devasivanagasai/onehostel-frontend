import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Admin modules (see ADMIN_ONLY_ROUTES) are Admin-only. Hostel Owners and Tenants who open one
 * (by URL, bookmark or link) are sent to the Dashboard instead.
 */
export const adminGuard: CanActivateChildFn = (_route, state) => {
  const authService = inject(AuthService);
  const path = state.url.split(/[?#]/)[0];
  return authService.canAccess(path) ? true : inject(Router).parseUrl(authService.landingRoute);
};
