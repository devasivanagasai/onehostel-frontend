import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantContextService } from '../services/tenant-context.service';

/** A Tenant page whose subscription feature is off (or Academic Info outside a College Hostel) sends the Tenant home. */
export const tenantModuleGuard: CanActivateFn = (_route, state) => {
  const tenant = inject(TenantContextService);
  return tenant.isRouteEnabled(state.url) ? true : inject(Router).createUrlTree(['/dashboard']);
};
