import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { GuardiansService } from './guardians.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import {
  ACCESS_SCOPES,
  AccessScope,
  AccessState,
  CONSENT_CHANNELS,
  ConsentChannel,
  Guardian,
  GuardianRelationship,
  VerificationStatus,
} from '../models/guardians.models';
import { localDateIso } from '../../shared/utils/local-date';

const STORAGE_KEY = 'onehostel_tenant_guardian_requests_v1';
export const REMOVAL_REASON_MIN = 10;
export const REMOVAL_REASON_MAX = 200;

export type RemovalStatus = 'Pending' | 'Approved' | 'Declined' | 'Withdrawn';

/** A Tenant's request for the owner to remove one of their guardians. */
export interface GuardianRemovalRequest {
  id: string;
  residentId: string;
  guardianId: string;
  guardianName: string;
  reason: string;
  status: RemovalStatus;
  createdAt: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface GuardianAlertRow {
  kind: AccessScope;
  willReceive: boolean;
  /** Why not (empty when they will receive it). */
  blocker: string;
}

/** What a Tenant may see about their own guardian: no verification code, no internal history, masked contact. */
export interface MyGuardianView {
  id: string;
  name: string;
  relationship: GuardianRelationship;
  primary: boolean;
  verification: VerificationStatus;
  maskedMobile?: string;
  maskedEmail?: string;
  consent: ConsentChannel;
  consentDate: string;
  scope: AccessScope[];
  access: { state: AccessState; reason: string };
  alerts: GuardianAlertRow[];
  pendingRemoval?: GuardianRemovalRequest;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const maskMobile = (m?: string): string | undefined => (m ? `${'•'.repeat(Math.max(0, m.length - 3))}${m.slice(-3)}` : undefined);
const maskEmail = (e?: string): string | undefined => {
  if (!e) return undefined;
  const [user, host] = e.split('@');
  return `${user.slice(0, 1)}•••@${host ?? ''}`;
};

/**
 * The Tenant's window on their OWN guardians (FRD 7.1). Reads GuardiansService, never exposes another
 * resident's guardians, and the only change a Tenant can make directly is their own notification-consent channel.
 * Guardians sign in separately and never see other residents or complaint / disciplinary records.
 */
@Injectable({ providedIn: 'root' })
export class TenantGuardianAccessService {
  private readonly guardians = inject(GuardiansService);
  private readonly tenant = inject(TenantContextService);
  private readonly staffAuth = inject(AuthService);
  private readonly notices = inject(TenantNotificationService);
  private readonly requests = new BehaviorSubject<GuardianRemovalRequest[]>(this.load());

  readonly scopes = ACCESS_SCOPES;
  readonly consentChannels = CONSENT_CHANNELS;

  /** The signed-in Tenant's guardians, primary first. */
  readonly mine$: Observable<MyGuardianView[]> = combineLatest([this.guardians.guardians$, this.requests, this.tenant.resident$]).pipe(map(() => this.mine));

  readonly myRequests$: Observable<GuardianRemovalRequest[]> = this.requests.pipe(map(() => this.myRequests));

  get mine(): MyGuardianView[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    return this.guardians.byResident(me).map((g) => this.toView(g));
  }

  get myRequests(): GuardianRemovalRequest[] {
    const me = this.tenant.residentId;
    return me ? this.requests.value.filter((r) => r.residentId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  }

  /**
   * Changes how one of MY guardians is notified. Uses GuardiansService.update() with the guardian's
   * existing details, so only the consent channel and its date change. Throws for anyone else's guardian.
   */
  changeConsent(guardianId: string, channel: ConsentChannel): MyGuardianView {
    const g = this.requireOwn(guardianId);
    if (!CONSENT_CHANNELS.includes(channel)) throw new Error('Choose SMS, Email, Push or None.');
    if (g.consent === channel) throw new Error('That is already the current choice.');
    if (channel === 'SMS' && !g.mobile) throw new Error('This guardian has no mobile number on record, so SMS is not possible.');
    if (channel === 'Email' && !g.email) throw new Error('This guardian has no email on record, so Email is not possible.');
    const next = this.guardians.update(g.id, {
      residentId: g.residentId,
      name: g.name,
      relationship: g.relationship,
      mobile: g.mobile,
      email: g.email,
      primary: g.primary,
      consent: channel,
      consentDate: localDateIso(),
      scope: [...g.scope],
    });
    return this.toView(next);
  }

  /** Asks the owner to remove one of MY guardians. One open request per guardian; reason 10-200 characters. */
  requestRemoval(guardianId: string, reason: string): GuardianRemovalRequest {
    const g = this.requireOwn(guardianId);
    const me = this.tenant.requireResidentId();
    const why = (reason ?? '').trim();
    if (why.length < REMOVAL_REASON_MIN) throw new Error(`Tell us why in at least ${REMOVAL_REASON_MIN} characters.`);
    if (why.length > REMOVAL_REASON_MAX) throw new Error(`Keep the reason within ${REMOVAL_REASON_MAX} characters.`);
    if (this.requests.value.some((r) => r.guardianId === g.id && r.residentId === me && r.status === 'Pending')) {
      throw new Error('You already have a pending removal request for this guardian.');
    }
    const req: GuardianRemovalRequest = {
      id: `GRR${String(this.requests.value.length + 1).padStart(5, '0')}`,
      residentId: me,
      guardianId: g.id,
      guardianName: g.name,
      reason: why,
      status: 'Pending',
      createdAt: nowIso(),
    };
    this.save([req, ...this.requests.value]);
    this.notices.push(me, { category: 'Profile', title: 'Guardian removal requested', body: `Your request to remove ${g.name} was sent to the hostel office.`, route: '/my/guardians' });
    return req;
  }

  /** Withdraw MY pending request. */
  withdrawRequest(requestId: string): GuardianRemovalRequest {
    const me = this.tenant.requireResidentId();
    const r = this.requests.value.find((x) => x.id === requestId);
    if (!r || r.residentId !== me) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('Only a pending request can be withdrawn.');
    return this.replace({ ...r, status: 'Withdrawn', decidedAt: nowIso() });
  }

  // ---- Owner side ---------------------------------------------------------------------

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.staffAuth.isHostelOwner || this.staffAuth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  /** Owner decision on a removal request. (Removing the guardian itself is done in Guardians.) */
  decideRemoval(requestId: string, decision: 'Approved' | 'Declined', note?: string): GuardianRemovalRequest {
    this.requireStaff();
    const r = this.requests.value.find((x) => x.id === requestId);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request has already been closed.');
    if (decision === 'Declined' && !(note ?? '').trim()) throw new Error('A note is required when declining.');
    const next = this.replace({ ...r, status: decision, decidedAt: nowIso(), decisionNote: note?.trim() || undefined });
    this.notices.push(r.residentId, {
      category: 'Profile',
      title: `Guardian removal ${decision.toLowerCase()}`,
      body: `Your request about ${r.guardianName} was ${decision.toLowerCase()}.`,
      route: '/my/guardians',
    });
    return next;
  }

  // ---- internals ----------------------------------------------------------------------

  private requireOwn(guardianId: string): Guardian {
    const me = this.tenant.requireResidentId();
    const g = this.guardians.byId(guardianId);
    if (!g || g.residentId !== me) throw new Error('Guardian not found.');
    return g;
  }

  private toView(g: Guardian): MyGuardianView {
    const access = this.guardians.effectiveAccess(g);
    return {
      id: g.id,
      name: g.name,
      relationship: g.relationship,
      primary: g.primary,
      verification: g.verification,
      maskedMobile: maskMobile(g.mobile),
      maskedEmail: maskEmail(g.email),
      consent: g.consent,
      consentDate: g.consentDate,
      scope: [...g.scope],
      // A hand revoke carries the owner's own reason; the Tenant only needs to know it was revoked.
      access: { state: access.state, reason: access.state === 'Revoked' && !access.automatic ? 'Access revoked by the hostel office' : access.reason },
      alerts: ACCESS_SCOPES.map((kind) => {
        const blocker = this.guardians.notifyBlocker(g, kind);
        return { kind, willReceive: !blocker, blocker };
      }),
      pendingRemoval: this.requests.value.find((r) => r.guardianId === g.id && r.residentId === g.residentId && r.status === 'Pending'),
    };
  }

  private replace(next: GuardianRemovalRequest): GuardianRemovalRequest {
    this.save(this.requests.value.map((r) => (r.id === next.id ? next : r)));
    return next;
  }

  private save(list: GuardianRemovalRequest[]): void {
    this.requests.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* kept in memory */
    }
  }

  private load(): GuardianRemovalRequest[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as GuardianRemovalRequest[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* use seed */
    }
    return [];
  }
}
