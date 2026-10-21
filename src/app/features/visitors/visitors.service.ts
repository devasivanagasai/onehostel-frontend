import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HostelSettingsService } from '../hostel-settings/hostel-settings.service';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident } from '../residents/residents.models';
import {
  DEFAULT_RULES,
  MOBILE_PATTERN,
  Visitor,
  VisitorEvent,
  VisitorInput,
  VisitorPolicy,
  VisitorRules,
  localIso,
  withinHours,
} from './visitors.models';

// Audit: AUDIT_EVENTS (core/models/audit.models.ts) has no visitor events, so nothing is recorded there.
// Every step is kept in the visitor's own history instead (including ID reveals).

const STORAGE_KEY = 'onehostel_visitors_v1';
const RULES_KEY = 'onehostel_visitor_rules_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

/** Requests for a time this far in the past are still accepted (late entry at the desk). */
const PAST_GRACE_MS = 15 * 60_000;

export interface VisitorStats {
  inside: number;
  expectedToday: number;
  pending: number;
  checkedOutToday: number;
}

export interface CheckInDetails {
  idType?: Visitor['idType'];
  idReference?: string;
  overrideReason?: string;
}

const today = (): string => localIso().slice(0, 10);

/** Local date-time `days` from today at hh:mm. */
const at = (days: number, time: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${localIso(d).slice(0, 10)}T${time}:00`;
};

/** `minutes` ago (negative = from now). */
const ago = (minutes: number): string => localIso(new Date(Date.now() - minutes * 60_000));

const ev = (when: string, by: string, action: string, icon: string, note?: string): VisitorEvent => ({ at: when, by, action, icon, note });

/** Seed data relative to today, so there is always someone inside, expected and waiting for approval. */
function seed(): Visitor[] {
  const owner = 'Hostel Owner';
  const guard = 'Ramesh (Security)';
  const base = (id: string, createdAt: string, createdBy = owner, source: Visitor['source'] = 'Staff') => ({
    id, hostelId: HOSTEL_ID, createdAt, createdBy, source, walkIn: false,
  });
  const v = (x: Omit<Visitor, 'hostelId' | 'walkIn'> & Partial<Pick<Visitor, 'walkIn'>>): Visitor => ({ hostelId: HOSTEL_ID, walkIn: false, ...x });

  return [
    v({
      ...base('VIS000014', at(0, '08:10'), 'Sahil Khan', 'Resident'),
      name: 'Farhan Khan', mobile: '9876012345', residentId: 'RES000005', purpose: 'Friend visit', count: 1,
      expectedAt: at(0, '18:00'), approval: 'Pending', status: 'Expected',
      history: [ev(at(0, '08:10'), 'Sahil Khan', 'Request raised from the Resident App', 'add_circle')],
    }),
    v({
      ...base('VIS000013', at(-1, '20:15'), 'Rahul Sharma', 'Resident'),
      name: 'Sunita Sharma', mobile: '9811002233', residentId: 'RES000001', purpose: 'Parent / Guardian', count: 2,
      idType: 'Aadhaar Card', idReference: '4521 7789 3012',
      expectedAt: at(1, '11:00'), approval: 'Pending', status: 'Expected',
      history: [ev(at(-1, '20:15'), 'Rahul Sharma', 'Request raised from the Resident App', 'add_circle')],
    }),
    v({
      ...base('VIS000012', at(-1, '10:30')),
      name: 'Arjun Mehta', mobile: '9900112244', residentId: 'RES000003', purpose: 'Official / Document work', count: 1,
      idType: 'Driving Licence', idReference: 'TS0920210045871',
      expectedAt: at(2, '15:30'), approval: 'Approved', approvalBy: owner, approvalAt: at(-1, '10:31'), status: 'Expected',
      history: [ev(at(-1, '10:30'), owner, 'Visitor registered', 'add_circle'), ev(at(-1, '10:31'), owner, 'Approved', 'verified')],
    }),
    v({
      ...base('VIS000011', at(-2, '19:00'), 'Mohit Yadav', 'Resident'),
      name: 'Kavita Yadav', mobile: '9822001122', residentId: 'RES000007', purpose: 'Family visit', count: 2,
      idType: 'Voter ID', idReference: 'UPV4471029',
      expectedAt: at(0, '16:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(-1, '09:15'), approvalReason: 'Mother and sister',
      status: 'Expected',
      history: [ev(at(-2, '19:00'), 'Mohit Yadav', 'Request raised from the Resident App', 'add_circle'), ev(at(-1, '09:15'), owner, 'Approved', 'verified', 'Mother and sister')],
    }),
    v({
      ...base('VIS000010', at(0, '09:05'), 'Aman Verma', 'Resident'),
      name: 'Nikhil Rao', mobile: '9765432109', residentId: 'RES000002', purpose: 'Friend visit', count: 1,
      expectedAt: at(0, '13:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(0, '09:20'), status: 'Cancelled',
      cancelReason: 'Resident cancelled — friend could not travel',
      history: [
        ev(at(0, '09:05'), 'Aman Verma', 'Request raised from the Resident App', 'add_circle'),
        ev(at(0, '09:20'), owner, 'Approved', 'verified'),
        ev(at(0, '11:40'), 'Aman Verma', 'Cancelled', 'cancel', 'Friend could not travel'),
      ],
    }),
    v({
      ...base('VIS000009', ago(40)), walkIn: true,
      name: 'Ravi Kumar', mobile: '9849012345', residentId: 'RES000006', purpose: 'Delivery / Drop-off', count: 1,
      idType: 'Aadhaar Card', idReference: '7788 1200 4567',
      expectedAt: ago(40), approval: 'Not Required', status: 'Checked In', checkInAt: ago(38), checkInBy: guard,
      history: [ev(ago(40), guard, 'Walk-in registered at the gate', 'directions_walk'), ev(ago(38), guard, 'Checked in', 'login')],
    }),
    v({
      ...base('VIS000008', at(-1, '18:40'), 'Vivek Singh', 'Resident'),
      name: 'Meera Singh', mobile: '9123004567', residentId: 'RES000003', purpose: 'Family visit', count: 2,
      idType: 'Aadhaar Card', idReference: '3344 5566 7788',
      expectedAt: ago(90), approval: 'Approved', approvalBy: owner, approvalAt: at(-1, '19:00'),
      status: 'Checked In', checkInAt: ago(85), checkInBy: guard,
      history: [
        ev(at(-1, '18:40'), 'Vivek Singh', 'Request raised from the Resident App', 'add_circle'),
        ev(at(-1, '19:00'), owner, 'Approved', 'verified'),
        ev(ago(85), guard, 'Checked in', 'login'),
      ],
    }),
    v({
      ...base('VIS000007', at(-1, '12:00')),
      name: 'Pooja Nair', mobile: '9447001234', residentId: 'RES000001', purpose: 'Friend visit', count: 1,
      idType: 'Employee / College ID', idReference: 'INF-55210',
      expectedAt: at(0, '10:30'), approval: 'Approved', approvalBy: owner, approvalAt: at(-1, '12:05'),
      status: 'Checked Out', checkInAt: at(0, '10:34'), checkInBy: guard, checkOutAt: at(0, '12:10'), checkOutBy: guard,
      history: [
        ev(at(-1, '12:00'), owner, 'Visitor registered', 'add_circle'),
        ev(at(-1, '12:05'), owner, 'Approved', 'verified'),
        ev(at(0, '10:34'), guard, 'Checked in', 'login'),
        ev(at(0, '12:10'), guard, 'Checked out', 'logout'),
      ],
    }),
    v({
      ...base('VIS000006', at(-2, '17:00'), 'Sagar Gupta', 'Resident'),
      name: 'Anil Gupta', mobile: '9810098100', residentId: 'RES000006', purpose: 'Parent / Guardian', count: 1,
      idType: 'PAN Card', idReference: 'ABCPG1234K',
      expectedAt: at(-1, '11:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(-2, '17:30'), status: 'Expected',
      history: [ev(at(-2, '17:00'), 'Sagar Gupta', 'Request raised from the Resident App', 'add_circle'), ev(at(-2, '17:30'), owner, 'Approved', 'verified')],
    }),
    v({
      ...base('VIS000005', at(-3, '15:20')), walkIn: true,
      name: 'Imran Sheikh', mobile: '9700112233', residentId: 'RES000005', purpose: 'Friend visit', count: 1,
      idType: 'Driving Licence', idReference: 'TS0720190031122',
      expectedAt: at(-3, '15:20'), approval: 'Not Required', status: 'Checked Out',
      checkInAt: at(-3, '15:22'), checkInBy: guard, checkOutAt: at(-3, '16:45'), checkOutBy: guard,
      history: [ev(at(-3, '15:20'), guard, 'Walk-in registered at the gate', 'directions_walk'), ev(at(-3, '15:22'), guard, 'Checked in', 'login'), ev(at(-3, '16:45'), guard, 'Checked out', 'logout')],
    }),
    v({
      ...base('VIS000004', at(-6, '21:10'), 'Rohit Patel', 'Resident'),
      name: 'Karan Malhotra', mobile: '9988001122', residentId: 'RES000004', purpose: 'Friend visit', count: 3,
      expectedAt: at(-5, '21:00'), approval: 'Rejected', approvalBy: owner, approvalAt: at(-6, '21:30'),
      approvalReason: 'Requested time is after the gate closes; group of 3 exceeds the visitor limit.', status: 'Cancelled',
      history: [
        ev(at(-6, '21:10'), 'Rohit Patel', 'Request raised from the Resident App', 'add_circle'),
        ev(at(-6, '21:30'), owner, 'Rejected', 'block', 'Requested time is after the gate closes; group of 3 exceeds the visitor limit.'),
      ],
    }),
    v({
      ...base('VIS000003', at(-10, '09:00')),
      name: 'Lakshmi Iyer', mobile: '9840011223', residentId: 'RES000002', purpose: 'Maintenance', count: 1,
      idType: 'Aadhaar Card', idReference: '9012 3456 7801',
      expectedAt: at(-9, '11:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(-10, '09:02'), status: 'Checked Out',
      checkInAt: at(-9, '11:05'), checkInBy: guard, checkOutAt: at(-9, '12:30'), checkOutBy: guard,
      history: [ev(at(-10, '09:00'), owner, 'Visitor registered', 'add_circle'), ev(at(-10, '09:02'), owner, 'Approved', 'verified'), ev(at(-9, '11:05'), guard, 'Checked in', 'login'), ev(at(-9, '12:30'), guard, 'Checked out', 'logout')],
    }),
    v({
      ...base('VIS000002', at(-21, '18:00'), 'Mohit Yadav', 'Resident'),
      name: 'Suresh Yadav', mobile: '9415012345', residentId: 'RES000007', purpose: 'Parent / Guardian', count: 2,
      idType: 'Aadhaar Card', idReference: '5566 7788 9900',
      expectedAt: at(-20, '12:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(-21, '18:30'), status: 'Checked Out',
      checkInAt: at(-20, '12:10'), checkInBy: guard, checkOutAt: at(-20, '17:40'), checkOutBy: guard,
      history: [ev(at(-21, '18:00'), 'Mohit Yadav', 'Request raised from the Resident App', 'add_circle'), ev(at(-21, '18:30'), owner, 'Approved', 'verified'), ev(at(-20, '12:10'), guard, 'Checked in', 'login'), ev(at(-20, '17:40'), guard, 'Checked out', 'logout')],
    }),
    v({
      ...base('VIS000001', at(-46, '10:00')),
      name: 'Deepa Sharma', mobile: '9811445566', residentId: 'RES000001', purpose: 'Family visit', count: 1,
      idType: 'Passport', idReference: 'Z4412987',
      expectedAt: at(-45, '11:00'), approval: 'Approved', approvalBy: owner, approvalAt: at(-46, '10:05'), status: 'Checked Out',
      checkInAt: at(-45, '11:02'), checkInBy: guard, checkOutAt: at(-45, '18:20'), checkOutBy: guard,
      history: [ev(at(-46, '10:00'), owner, 'Visitor registered', 'add_circle'), ev(at(-46, '10:05'), owner, 'Approved', 'verified'), ev(at(-45, '11:02'), guard, 'Checked in', 'login'), ev(at(-45, '18:20'), guard, 'Checked out', 'logout')],
    }),
  ];
}

@Injectable({ providedIn: 'root' })
export class VisitorsService {
  private readonly auth = inject(AuthService);
  private readonly hostelSettings = inject(HostelSettingsService);
  private readonly residentsService = inject(ResidentsService);

  private readonly rulesSubject = new BehaviorSubject<VisitorRules>(this.loadRules());
  readonly rules$ = this.rulesSubject.asObservable();

  private readonly subject = new BehaviorSubject<Visitor[]>(this.purge(this.load(), this.rulesSubject.value));
  readonly visitors$: Observable<Visitor[]> = this.subject.asObservable();

  readonly stats$: Observable<VisitorStats> = combineLatest([this.visitors$, this.residentsService.residents$]).pipe(map(([list]) => this.statsOf(list)));

  get visitors(): Visitor[] {
    return this.subject.value;
  }

  get rules(): VisitorRules {
    return this.rulesSubject.value;
  }

  /** Visitor policy from Hostel Settings → Rules (read on every call so a saved change applies at once). */
  get policy(): VisitorPolicy {
    const r = this.hostelSettings.state.value.rules;
    return { visitorsAllowed: r.visitorsAllowed, visitingFrom: r.visitingFrom, visitingTo: r.visitingTo, maxVisitors: Math.max(1, r.maxVisitors || 1), idRequired: r.visitorIdRequired };
  }

  byId(id: string): Visitor | undefined {
    return this.visitors.find((v) => v.id === id);
  }

  // ---- Residents ------------------------------------------------------------------

  /** Residents who can receive visitors: current (Active / On Leave), not deactivated. */
  get currentResidents(): HostelResident[] {
    return this.residentsService.residents.filter((r) => !r.deactivatedAt && (r.status === 'Active' || r.status === 'On Leave'));
  }

  resident(id: string): HostelResident | undefined {
    return this.residentsService.byId(id);
  }

  location(residentId: string): string {
    const alloc = this.residentsService.allocationFor(residentId);
    return alloc ? this.residentsService.describe(alloc) : 'No bed';
  }

  // ---- Derived state --------------------------------------------------------------

  isToday(v: Visitor): boolean {
    const d = today();
    return v.expectedAt.startsWith(d) || !!v.checkInAt?.startsWith(d) || !!v.checkOutAt?.startsWith(d);
  }

  /** Expected visit whose day has passed without a check-in. */
  isMissed(v: Visitor): boolean {
    return v.status === 'Expected' && v.expectedAt.slice(0, 10) < today();
  }

  /** Inside after the visiting window closed. */
  isOverstay(v: Visitor): boolean {
    return v.status === 'Checked In' && localIso().slice(11, 16) > this.policy.visitingTo;
  }

  /** Why security can't check this visitor in right now (empty = ready, apart from ID / hours checks in the dialog). */
  checkInBlocker(v: Visitor): string {
    if (v.status !== 'Expected') return 'Only expected visitors can be checked in.';
    if (!this.policy.visitorsAllowed) return 'Visitors are not allowed under the current hostel rules.';
    if (v.approval === 'Pending') return 'Waiting for approval.';
    if (v.approval === 'Rejected') return 'The request was rejected.';
    if (this.isMissed(v)) return 'The visit date has passed. Register the visitor again.';
    return '';
  }

  /** Earliest moment the closed record's ID can be purged from. */
  closedAt(v: Visitor): string | undefined {
    if (v.status === 'Checked Out') return v.checkOutAt;
    if (v.status === 'Cancelled') return v.history[v.history.length - 1]?.at ?? v.createdAt;
    if (this.isMissed(v)) return v.expectedAt;
    return undefined;
  }

  // ---- Actions --------------------------------------------------------------------

  /** Problems with a new request under the current policy; the dialog shows the same messages inline. */
  validate(input: VisitorInput): string[] {
    const p = this.policy;
    const errors: string[] = [];
    if (!p.visitorsAllowed) errors.push('Visitors are not allowed under the current hostel rules.');
    if (input.walkIn && this.rules.walkInPolicy === 'blocked') errors.push('Walk-in visitors are not allowed.');
    if (!input.name.trim()) errors.push('Visitor name is required.');
    if (input.mobile && !MOBILE_PATTERN.test(input.mobile)) errors.push('Enter a valid 10-digit mobile number.');
    if (!this.currentResidents.some((r) => r.residentId === input.residentId)) errors.push('Select a current resident.');
    if (!input.purpose.trim()) errors.push('Purpose is required.');
    if (!Number.isInteger(input.count) || input.count < 1) errors.push('Visitor count must be a whole number of at least 1.');
    else if (input.count > p.maxVisitors) errors.push(`At most ${p.maxVisitors} visitor(s) are allowed per visit.`);
    if (p.idRequired && (!input.idType || !input.idReference?.trim())) errors.push('ID type and reference are required.');
    const t = new Date(input.expectedAt).getTime();
    if (!input.expectedAt || isNaN(t)) errors.push('Pick a valid visit date and time.');
    else {
      if (!input.walkIn && t < Date.now() - PAST_GRACE_MS) errors.push('Expected visit time cannot be in the past.');
      if (!withinHours(input.expectedAt, p.visitingFrom, p.visitingTo) && !input.overrideReason?.trim()) {
        errors.push('The visit is outside visiting hours — give a reason to override.');
      }
    }
    return errors;
  }

  /**
   * New request / record. Approval follows the local rules; walk-ins follow the walk-in policy
   * and, when allowed outright, are checked in immediately.
   */
  create(input: VisitorInput): Visitor {
    const errors = this.validate(input);
    if (errors.length) throw new Error(errors[0]);
    const now = localIso();
    const by = this.userName;
    const walkInAllowed = input.walkIn && this.rules.walkInPolicy === 'allow';
    const needsApproval = input.walkIn ? this.rules.walkInPolicy === 'approval' : this.rules.approvalRequired;
    const history: VisitorEvent[] = [ev(now, by, input.walkIn ? 'Walk-in registered at the gate' : 'Visitor registered', input.walkIn ? 'directions_walk' : 'add_circle')];
    if (input.overrideReason?.trim()) history.push(ev(now, by, 'Visiting hours overridden', 'schedule', input.overrideReason.trim()));
    if (walkInAllowed) history.push(ev(now, by, 'Checked in', 'login'));

    const v: Visitor = {
      id: this.nextId(),
      hostelId: HOSTEL_ID,
      name: input.name.trim(),
      mobile: input.mobile || undefined,
      residentId: input.residentId,
      purpose: input.purpose.trim(),
      count: input.count,
      idType: input.idReference?.trim() ? input.idType : undefined,
      idReference: input.idReference?.trim() || undefined,
      expectedAt: input.walkIn ? now : input.expectedAt,
      walkIn: input.walkIn,
      source: 'Staff',
      approval: needsApproval ? 'Pending' : 'Not Required',
      status: walkInAllowed ? 'Checked In' : 'Expected',
      checkInAt: walkInAllowed ? now : undefined,
      checkInBy: walkInAllowed ? by : undefined,
      overrideReason: input.overrideReason?.trim() || undefined,
      createdBy: by,
      createdAt: now,
      history,
    };
    this.commit([v, ...this.visitors]);
    return v;
  }

  decide(id: string, approve: boolean, reason?: string): Visitor {
    const v = this.require(id);
    if (v.approval !== 'Pending') throw new Error('This request has already been decided.');
    if (!approve && !reason?.trim()) throw new Error('Give a reason for the rejection.');
    const now = localIso();
    const note = reason?.trim() || undefined;
    return this.update(v, {
      approval: approve ? 'Approved' : 'Rejected',
      approvalBy: this.userName,
      approvalAt: now,
      approvalReason: note,
      status: approve ? v.status : 'Cancelled',
    }, ev(now, this.userName, approve ? 'Approved' : 'Rejected', approve ? 'verified' : 'block', note));
  }

  /** Security records arrival after checking approval, ID and visiting hours. */
  checkIn(id: string, details: CheckInDetails = {}): Visitor {
    const v = this.require(id);
    const blocker = this.checkInBlocker(v);
    if (blocker) throw new Error(blocker);
    const p = this.policy;
    const idType = details.idType ?? v.idType;
    const idReference = details.idReference?.trim() || v.idReference;
    if (p.idRequired && (!idType || !idReference)) throw new Error('A visitor ID is required by the hostel rules.');
    const now = localIso();
    const reason = details.overrideReason?.trim();
    if (!withinHours(now, p.visitingFrom, p.visitingTo) && !reason) throw new Error('Outside visiting hours — give a reason to override.');
    const events = [ev(now, this.userName, 'Checked in', 'login', reason ? `Outside visiting hours: ${reason}` : undefined)];
    return this.update(v, { status: 'Checked In', checkInAt: now, checkInBy: this.userName, idType, idReference, overrideReason: reason || v.overrideReason }, ...events);
  }

  checkOut(id: string): Visitor {
    const v = this.require(id);
    if (v.status !== 'Checked In') throw new Error('Only visitors inside can be checked out.');
    const now = localIso();
    return this.update(v, { status: 'Checked Out', checkOutAt: now, checkOutBy: this.userName }, ev(now, this.userName, 'Checked out', 'logout'));
  }

  cancel(id: string, reason: string): Visitor {
    const v = this.require(id);
    if (v.status !== 'Expected') throw new Error('Only expected visits can be cancelled.');
    if (!reason.trim()) throw new Error('Give a reason for cancelling.');
    const now = localIso();
    return this.update(v, { status: 'Cancelled', cancelReason: reason.trim() }, ev(now, this.userName, 'Cancelled', 'cancel', reason.trim()));
  }

  /** Full ID reference; every reveal is written to the visitor's history. */
  revealId(id: string): string {
    const v = this.require(id);
    if (!v.idReference) throw new Error('No ID reference on record.');
    this.update(v, {}, ev(localIso(), this.userName, 'ID reference revealed', 'visibility'));
    return v.idReference;
  }

  saveRules(rules: VisitorRules): void {
    const clean: VisitorRules = { ...rules, idRetentionDays: Math.min(365, Math.max(1, Math.round(rules.idRetentionDays) || DEFAULT_RULES.idRetentionDays)) };
    this.rulesSubject.next(clean);
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(clean));
    } catch {
      // ignore
    }
    // A shorter retention period applies straight away.
    this.commit(this.purge(this.visitors, clean));
  }

  // ---------------------------------------------------------------------------

  private statsOf(list: Visitor[]): VisitorStats {
    const d = today();
    const mine = list.filter((v) => v.hostelId === HOSTEL_ID);
    return {
      inside: mine.filter((v) => v.status === 'Checked In').length,
      expectedToday: mine.filter((v) => v.status === 'Expected' && v.expectedAt.startsWith(d) && v.approval !== 'Rejected').length,
      pending: mine.filter((v) => v.approval === 'Pending' && v.status === 'Expected').length,
      checkedOutToday: mine.filter((v) => v.status === 'Checked Out' && v.checkOutAt?.startsWith(d)).length,
    };
  }

  /** Retention: drop the ID reference of visits closed longer ago than the retention period. */
  private purge(list: Visitor[], rules: VisitorRules): Visitor[] {
    const cutoff = Date.now() - rules.idRetentionDays * 86_400_000;
    const now = localIso();
    let changed = false;
    const next = list.map((v) => {
      const closed = this.closedAt(v);
      if (!v.idReference || !closed || new Date(closed).getTime() > cutoff) return v;
      changed = true;
      return { ...v, idReference: undefined, idPurgedAt: now, history: [...v.history, ev(now, 'System', 'ID purged per retention policy', 'auto_delete', `${rules.idRetentionDays}-day retention`)] };
    });
    if (changed) this.save(next);
    return next;
  }

  private update(v: Visitor, patch: Partial<Visitor>, ...events: VisitorEvent[]): Visitor {
    const next: Visitor = { ...v, ...patch, history: [...v.history, ...events] };
    this.commit(this.visitors.map((x) => (x.id === v.id ? next : x)));
    return next;
  }

  private require(id: string): Visitor {
    const v = this.byId(id);
    if (!v) throw new Error('Visitor record not found.');
    return v;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.visitors.reduce((m, v) => Math.max(m, Number(v.id.slice(3)) || 0), 0);
    return `VIS${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Visitor[]): void {
    this.subject.next(list);
    this.save(list);
  }

  private save(list: Visitor[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): Visitor[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Visitor[];
    } catch {
      // Fall through to the seed data.
    }
    const list = seed();
    this.save(list);
    return list;
  }

  private loadRules(): VisitorRules {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      if (raw) return { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<VisitorRules>) };
    } catch {
      // ignore
    }
    return { ...DEFAULT_RULES };
  }
}
