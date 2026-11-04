import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { AuthService } from './auth.service';
import { ResidentsService } from './residents.service';
import { HostelSettingsService } from './hostel-settings.service';
import { Bed, Room } from '../models/rooms.models';
import { HostelResident } from '../models/residents.models';
import { TENANT_MODULES, TenantModule, tenantModuleForUrl } from '../models/tenant.models';

/**
 * "Who am I?" for every Tenant page. All Tenant data is read through the signed-in Tenant's own
 * resident record, so a page can never show another resident's information: pages take the id from
 * here, never from the URL or a form field.
 */
@Injectable({ providedIn: 'root' })
export class TenantContextService {
  private readonly auth = inject(AuthService);
  private readonly residents = inject(ResidentsService);
  private readonly hostelSettings = inject(HostelSettingsService);

  /** The signed-in Tenant's resident id, or null for anyone else. */
  get residentId(): string | null {
    const user = this.auth.currentUser;
    return user?.roles?.includes('Tenant') ? (user.residentId ?? null) : null;
  }

  /** Throws unless a Tenant is signed in. Use at the top of every Tenant mutation. */
  requireResidentId(): string {
    const id = this.residentId;
    if (!id) throw new Error('Sign in as a Tenant to do this.');
    return id;
  }

  get resident(): HostelResident | undefined {
    const id = this.residentId;
    return id ? this.residents.byId(id) : undefined;
  }

  requireResident(): HostelResident {
    const r = this.resident;
    if (!r) throw new Error('Your resident record was not found. Contact your hostel office.');
    return r;
  }

  /** Emits the resident record now and whenever it changes. */
  readonly resident$: Observable<HostelResident | undefined> = this.residents.residents$.pipe(map(() => this.resident));

  /** The current bed and room, read from the room records. */
  get allocation(): { room: Room; bed: Bed } | undefined {
    const id = this.residentId;
    return id ? (this.residents.allocationFor(id) as { room: Room; bed: Bed } | undefined) : undefined;
  }

  get hostelName(): string {
    return this.hostelSettings.state.value.profile.hostelName;
  }

  get isCollegeHostel(): boolean {
    return this.hostelSettings.state.hostelType === 'College Hostel';
  }

  /** Whether a Tenant page is available: its subscription feature is on (and, for Academic Info, the hostel is a College Hostel). */
  isEnabled(module: TenantModule): boolean {
    if (module.collegeOnly && !this.isCollegeHostel) return false;
    if (!module.feature) return true;
    const modules = this.hostelSettings.subscription.modules;
    if (module.feature === 'laundry') return !!(modules['laundry'] || modules['washingMachine']);
    return !!modules[module.feature];
  }

  isRouteEnabled(url: string): boolean {
    const module = tenantModuleForUrl(url);
    return module ? this.isEnabled(module) : true;
  }

  get enabledModules(): TenantModule[] {
    return TENANT_MODULES.filter((m) => this.isEnabled(m));
  }

  /** Emits when the resident record changes, for pages that only need a refresh signal. */
  readonly changes$ = combineLatest([this.residents.residents$]).pipe(map(() => undefined));
}
