import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident, formatMobile, residentFullName } from '../residents/residents.models';
import {
  ApprovalStatus,
  DEFAULT_POLICY,
  LeaveContact,
  LeaveInput,
  LeaveNotification,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  MovementState,
  REASON_MAX,
  dayEnd,
  dayStart,
  localDate,
  localIso,
  time,
} from './leave-outpass.models';

// Audit: AUDIT_EVENTS (core/models/audit.models.ts) has no leave / outpass events, so nothing is
// recorded there. Submitted / decided / cancelled / exit / return by + at are kept on each request.

const STORAGE_KEY = 'onehostel_leave_requests_v1';
const POLICY_KEY = 'onehostel_leave_policy_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

/** How early security may record an exit before the approved departure. */
const EARLY_EXIT_MS = 2 * 3_600_000;

export interface LeaveStats {
  pending: number;
  upcoming: number;
  out: number;
  returningToday: number;
  overdue: number;
}

export interface TimeErrors {
  depart?: string;
  return?: string;
}

/** Local date-time `hours` from now, rounded to 5 minutes. */
const rel = (hours: number): string => {
  const t = Date.now() + hours * 3_600_000;
  return localIso(new Date(Math.round(t / 300_000) * 300_000));
};

/** Local date-time `days` from today at hh:mm. */
const at = (days: number, hhmm: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${localDate(d)}T${hhmm}:00`;
};

@Injectable({ providedIn: 'root' })
export class LeaveOutpassService {
  private readonly residents = inject(ResidentsService);
  private readonly auth = inject(AuthService);

  private readonly policySubject = new BehaviorSubject<LeavePolicy>(this.loadPolicy());
  readonly policy$ = this.policySubject.asObservable();

  private readonly subject = new BehaviorSubject<LeaveRequest[]>(this.load());
  readonly requests$: Observable<LeaveRequest[]> = this.subject.asObservable();

  readonly stats$: Observable<LeaveStats> = this.requests$.pipe(
    map((list) => {
      const today = localDate();
      const mine = list.filter((r) => r.hostelId === HOSTEL_ID);
      const moving = (s: MovementState) => mine.filter((r) => this.movement(r) === s);
      return {
        pending: mine.filter((r) => r.status === 'Pending').length,
        upcoming: moving('Not yet left').length,
        out: moving('Out').length + moving('Overdue return').length,
        returningToday: moving('Out').filter((r) => r.returnAt.slice(0, 10) === today).length,
        overdue: moving('Overdue return').length,
      };
    }),
  );

  get requests(): LeaveRequest[] {
    return this.subject.value;
  }

  get policy(): LeavePolicy {
    return this.policySubject.value;
  }

  byId(id: string): LeaveRequest | undefined {
    return this.requests.find((r) => r.id === id);
  }

  // ---- Residents ---------------------------------------------------------------

  /** Residents who can ask for leave: current (Active / On Leave) with a bed. */
  get eligibleResidents(): HostelResident[] {
    return this.residents.residents.filter(
      (r) => !r.deactivatedAt && (r.status === 'Active' || r.status === 'On Leave') && !!this.residents.allocationFor(r.residentId),
    );
  }

  resident(id: string): HostelResident | undefined {
    return this.residents.byId(id);
  }

  residentName(id: string): string {
    const r = this.resident(id);
    return r ? residentFullName(r) : id;
  }

  location(id: string): string {
    const alloc = this.residents.allocationFor(id);
    return alloc ? this.residents.describe(alloc) : 'No bed';
  }

  /** Authorised contacts already on the resident's profile (emergency contact, guardian). */
  contactsFor(r: HostelResident): LeaveContact[] {
    const out: LeaveContact[] = [];
    if (r.emergencyContactName && r.emergencyContactMobile) {
      out.push({ source: 'Emergency', name: r.emergencyContactName, mobile: formatMobile(r.mobileCode, r.emergencyContactMobile) });
    }
    if (r.guardian?.name && r.guardian.mobile) {
      out.push({ source: 'Guardian', name: r.guardian.name, mobile: formatMobile(r.mobileCode, r.guardian.mobile), relationship: r.guardian.relationship });
    }
    return out;
  }

  /** Why a guardian would not be told, or '' when they would. */
  guardianBlock(residentId: string): string {
    const r = this.resident(residentId);
    if (!this.policy.notifyGuardian) return 'Guardian notifications are turned off';
    if (!r?.guardian?.name || !r.guardian.mobile) return 'No guardian on record';
    if (!r.guardian.consent) return 'Guardian consent not given';
    return '';
  }

  // ---- Movement ----------------------------------------------------------------

  /** Physical movement of an approved request; null when not approved (or tracking is off and nothing was recorded). */
  movement(r: LeaveRequest, now = Date.now()): MovementState | null {
    if (r.status !== 'Approved') return null;
    if (r.returnedAt) return 'Returned';
    if (r.exitAt) return time(r.returnAt) < now ? 'Overdue return' : 'Out';
    return this.policy.movementTracking ? 'Not yet left' : null;
  }

  /** Approved request covering any part of a local date (used by Attendance). */
  approvedOn(residentId: string, date: string): LeaveRequest | undefined {
    const from = dayStart(date);
    const to = dayEnd(date);
    return this.requests.find(
      (r) =>
        r.residentId === residentId &&
        r.status === 'Approved' &&
        time(r.departAt) <= to &&
        time(r.returnedAt ?? r.returnAt) >= from &&
        // An approved request that ended early (returned) before the day doesn't count.
        !(r.returnedAt && time(r.returnedAt) < from),
    );
  }

  /** Was the resident physically out (per security records) for the whole of that date? */
  outAllDay(r: LeaveRequest, date: string): boolean {
    if (!r.exitAt || time(r.exitAt) > dayStart(date)) return false;
    const end = date === localDate() ? Date.now() : dayEnd(date);
    return !r.returnedAt || time(r.returnedAt) > end;
  }

  // ---- Validation -----------------------------------------------------------------

  /** Departure must be valid and not in the past; return must follow departure (and fit the outpass limit). */
  checkTimes(type: LeaveType, departAt: string, returnAt: string): TimeErrors {
    const errors: TimeErrors = {};
    const d = departAt ? time(departAt) : NaN;
    const r = returnAt ? time(returnAt) : NaN;
    if (!departAt) errors.depart = 'Pick the departure date and time';
    else if (isNaN(d)) errors.depart = 'Enter a valid date and time';
    else if (d < Date.now() - 15 * 60_000) errors.depart = 'Departure cannot be in the past';
    if (!returnAt) errors.return = 'Pick the expected return';
    else if (isNaN(r)) errors.return = 'Enter a valid date and time';
    else if (!isNaN(d) && r <= d) errors.return = 'Must be after the departure';
    else if (!isNaN(d) && type === 'Outpass' && r - d > this.policy.outpassMaxHours * 3_600_000) {
      errors.return = `An outpass can be at most ${this.policy.outpassMaxHours} hours — use Leave for longer`;
    }
    return errors;
  }

  /** Another pending / approved (not returned) request overlapping the same window. */
  overlapping(residentId: string, departAt: string, returnAt: string, exceptId?: string): LeaveRequest | undefined {
    const d = time(departAt);
    const r = time(returnAt);
    return this.requests.find(
      (x) =>
        x.id !== exceptId &&
        x.residentId === residentId &&
        (x.status === 'Pending' || (x.status === 'Approved' && !x.returnedAt)) &&
        time(x.departAt) < r &&
        time(x.returnAt) > d,
    );
  }

  // ---- Actions ---------------------------------------------------------------------

  /** Staff raise a request on the resident's behalf; it starts Pending like one from the app. */
  create(input: LeaveInput): LeaveRequest {
    const resident = this.eligibleResidents.find((r) => r.residentId === input.residentId);
    if (!resident) throw new Error('Pick a current resident with a bed.');
    if (!input.reason.trim() || input.reason.length > REASON_MAX) throw new Error('Reason is required.');
    const errors = this.checkTimes(input.type, input.departAt, input.returnAt);
    if (errors.depart || errors.return) throw new Error(errors.depart || errors.return);
    if (this.policy.destinationRequired[input.type] && !input.destination?.trim()) throw new Error('Destination is required.');
    if (!input.contact.name.trim() || !input.contact.mobile.trim()) throw new Error('Emergency contact is required.');
    if (input.contact.source === 'Other' && !input.contact.reason?.trim()) throw new Error('Say why a different contact is used.');
    const clash = this.overlapping(input.residentId, input.departAt, input.returnAt);
    if (clash) throw new Error(`${residentFullName(resident)} already has ${clash.id} (${clash.status}) in this period.`);

    const now = localIso();
    const req: LeaveRequest = {
      id: this.nextId(),
      hostelId: HOSTEL_ID,
      ...input,
      reason: input.reason.trim(),
      destination: input.destination?.trim() || undefined,
      status: 'Pending',
      submittedBy: this.userName,
      submittedVia: 'Front Desk',
      createdAt: now,
      notifications: [this.notice(now, input.residentId, 'Resident', `Your ${input.type.toLowerCase()} request was raised by the front desk and is awaiting approval.`)],
    };
    this.commit([req, ...this.requests]);
    return req;
  }

  approve(id: string, note?: string): LeaveRequest {
    const r = this.require(id);
    this.assertPending(r);
    if (time(r.returnAt) <= Date.now()) throw new Error('The requested period has already ended. Reject it or ask for a new request.');
    const clash = this.requests.find((x) => x.id !== id && x.residentId === r.residentId && x.status === 'Approved' && !x.returnedAt && time(x.departAt) < time(r.returnAt) && time(x.returnAt) > time(r.departAt));
    if (clash) throw new Error(`Overlaps approved request ${clash.id}.`);
    return this.decide(r, 'Approved', note?.trim() || undefined);
  }

  /** A reason is mandatory when rejecting. */
  reject(id: string, reason: string): LeaveRequest {
    const r = this.require(id);
    this.assertPending(r);
    if (!reason.trim()) throw new Error('A reason is required to reject.');
    return this.decide(r, 'Rejected', reason.trim());
  }

  /** Pending requests, or approved ones the resident hasn't left on yet. */
  cancel(id: string, reason?: string): LeaveRequest {
    const r = this.require(id);
    if (!this.canCancel(r)) throw new Error('Only pending requests or approved ones not yet used can be cancelled.');
    const now = localIso();
    const next: LeaveRequest = {
      ...r,
      status: 'Cancelled',
      cancelledBy: this.userName,
      cancelledAt: now,
      cancelReason: reason?.trim() || undefined,
      notifications: [...r.notifications, this.notice(now, r.residentId, 'Resident', `Your ${r.type.toLowerCase()} request ${r.id} was cancelled.`)],
    };
    this.replace(next);
    return next;
  }

  canCancel(r: LeaveRequest): boolean {
    return r.status === 'Pending' || (r.status === 'Approved' && !r.exitAt);
  }

  /** Movement errors for an exit / return time, or ''. */
  movementError(r: LeaveRequest, kind: 'exit' | 'return', value: string): string {
    if (!value) return 'Pick the date and time';
    const t = time(value);
    if (isNaN(t)) return 'Enter a valid date and time';
    if (t > Date.now() + 60_000) return 'Cannot be in the future';
    if (kind === 'exit') {
      if (t < time(r.departAt) - EARLY_EXIT_MS) return 'More than 2 hours before the approved departure';
      if (t > time(r.returnAt)) return 'After the expected return — the approved period is over';
      return '';
    }
    return r.exitAt && t <= time(r.exitAt) ? 'Must be after the recorded exit' : '';
  }

  recordExit(id: string, when: string): LeaveRequest {
    const r = this.require(id);
    if (!this.policy.movementTracking) throw new Error('Movement tracking is turned off.');
    if (r.status !== 'Approved') throw new Error('Exit can be recorded only for approved requests.');
    if (r.exitAt) throw new Error('Exit is already recorded.');
    const err = this.movementError(r, 'exit', when);
    if (err) throw new Error(err);
    const next: LeaveRequest = { ...r, exitAt: when, exitBy: this.userName };
    this.replace(next);
    return next;
  }

  recordReturn(id: string, when: string): LeaveRequest {
    const r = this.require(id);
    if (!r.exitAt) throw new Error('Record the exit first.');
    if (r.returnedAt) throw new Error('Return is already recorded.');
    const err = this.movementError(r, 'return', when);
    if (err) throw new Error(err);
    const next: LeaveRequest = { ...r, returnedAt: when, returnBy: this.userName };
    this.replace(next);
    return next;
  }

  savePolicy(policy: LeavePolicy): void {
    const hours = Math.round(policy.outpassMaxHours);
    if (!(hours >= 1 && hours <= 24)) throw new Error('Outpass limit must be between 1 and 24 hours.');
    const next = { ...policy, outpassMaxHours: hours };
    this.policySubject.next(next);
    this.store(POLICY_KEY, next);
    this.subject.next([...this.requests]); // movement states depend on the policy
  }

  // ---------------------------------------------------------------------------

  private decide(r: LeaveRequest, status: ApprovalStatus, reason?: string): LeaveRequest {
    const now = localIso();
    const next: LeaveRequest = {
      ...r,
      status,
      decidedBy: this.userName,
      decidedAt: now,
      decisionReason: reason,
      notifications: [...r.notifications, ...this.decisionNotices(r, status, now, reason)],
    };
    this.replace(next);
    return next;
  }

  /** Resident always; guardian only when enabled, on record and consented — otherwise logged as skipped. */
  private decisionNotices(r: Pick<LeaveRequest, 'residentId' | 'type' | 'id' | 'departAt'>, status: ApprovalStatus, now: string, reason?: string): LeaveNotification[] {
    const what = `${r.type} request ${r.id} was ${status.toLowerCase()}${reason ? ': ' + reason : '.'}`;
    const resident = this.resident(r.residentId);
    const guardian = resident?.guardian;
    const block = this.guardianBlock(r.residentId);
    return [
      this.notice(now, r.residentId, 'Resident', `Your ${what}`),
      {
        at: now,
        to: 'Guardian',
        name: guardian?.name || 'Guardian',
        channel: 'SMS',
        message: `${resident ? residentFullName(resident) : 'Resident'}'s ${what}`,
        status: block ? 'Skipped' : 'Sent',
        note: block || undefined,
      },
    ];
  }

  private notice(at: string, residentId: string, to: 'Resident', message: string): LeaveNotification {
    return { at, to, name: this.residentName(residentId), channel: 'In-app · Push', message, status: 'Sent' };
  }

  private assertPending(r: LeaveRequest): void {
    if (r.status !== 'Pending') throw new Error(`${r.id} is already ${r.status.toLowerCase()}.`);
  }

  private require(id: string): LeaveRequest {
    const r = this.byId(id);
    if (!r) throw new Error('Request not found.');
    return r;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.requests.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0);
    return `LVR${String(max + 1).padStart(6, '0')}`;
  }

  private replace(next: LeaveRequest): void {
    this.commit(this.requests.map((x) => (x.id === next.id ? next : x)));
  }

  private commit(list: LeaveRequest[]): void {
    this.subject.next(list);
    this.store(STORAGE_KEY, list);
  }

  private store(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private loadPolicy(): LeavePolicy {
    try {
      const raw = localStorage.getItem(POLICY_KEY);
      if (raw) return { ...DEFAULT_POLICY, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
    return { ...DEFAULT_POLICY };
  }

  private load(): LeaveRequest[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as LeaveRequest[];
    } catch {
      // Fall through to the seed data.
    }
    const list = this.seed();
    this.store(STORAGE_KEY, list);
    return list;
  }

  /** Seed data relative to now, one or more requests in every state. Residents match the Residents seed. */
  private seed(): LeaveRequest[] {
    const desk = 'Hostel Owner';
    const contact = (id: string): LeaveContact => {
      const r = this.resident(id);
      return (r && this.contactsFor(r)[0]) ?? { source: 'Other', name: 'Mahesh Patel', mobile: '+91 98250 11223', relationship: 'Father', reason: 'No emergency contact on the profile yet' };
    };
    const base = (id: string, residentId: string, type: LeaveType, createdAt: string, rest: Partial<LeaveRequest>): LeaveRequest => ({
      id, hostelId: HOSTEL_ID, residentId, type, reason: '', departAt: '', returnAt: '', contact: contact(residentId), status: 'Pending',
      submittedBy: this.residentName(residentId), submittedVia: 'Resident App', createdAt, notifications: [], ...rest,
    });
    const decided = (r: LeaveRequest, status: ApprovalStatus, when: string, reason?: string): LeaveRequest => ({
      ...r, status, decidedBy: desk, decidedAt: when, decisionReason: reason, notifications: this.decisionNotices(r, status, when, reason),
    });

    return [
      base('LVR000009', 'RES000006', 'Outpass', rel(-1), { reason: 'Bank visit and document submission at the passport office', departAt: rel(3), returnAt: rel(6), destination: 'Passport Seva Kendra, Begumpet' }),
      base('LVR000008', 'RES000005', 'Leave', rel(-5), { reason: 'Cousin\'s wedding at home', departAt: at(2, '07:00'), returnAt: at(5, '20:00'), destination: 'Lucknow, Uttar Pradesh' }),
      decided(base('LVR000007', 'RES000007', 'Leave', at(-1, '19:20'), { reason: 'Semester break — going home', departAt: at(1, '06:30'), returnAt: at(3, '21:00'), destination: 'Nagpur, Maharashtra' }), 'Approved', at(0, '08:45')),
      { ...decided(base('LVR000006', 'RES000001', 'Outpass', rel(-6), { reason: 'Dental appointment', departAt: rel(-3), returnAt: rel(1), destination: 'Smile Dental Clinic, Ameerpet' }), 'Approved', rel(-5)), exitAt: rel(-2.9), exitBy: 'Security Desk' },
      { ...decided(base('LVR000005', 'RES000002', 'Outpass', rel(-10), { reason: 'Office team dinner', departAt: rel(-8), returnAt: rel(-1), destination: 'Jubilee Hills' }), 'Approved', rel(-9)), exitAt: rel(-7.8), exitBy: 'Security Desk' },
      { ...decided(base('LVR000004', 'RES000004', 'Leave', at(-12, '18:00'), { reason: 'Family function — sister\'s engagement', departAt: at(-11, '08:00'), returnAt: at(4, '18:00'), destination: 'Ahmedabad, Gujarat' }), 'Approved', at(-12, '20:10')), exitAt: at(-11, '08:20'), exitBy: 'Security Desk' },
      { ...decided(base('LVR000003', 'RES000003', 'Leave', at(-8, '10:00'), { reason: 'Diwali holidays at home', departAt: at(-6, '07:00'), returnAt: at(-3, '18:00'), destination: 'Patna, Bihar' }), 'Approved', at(-8, '12:30')), exitAt: at(-6, '07:15'), exitBy: 'Security Desk', returnedAt: at(-3, '17:40'), returnBy: 'Security Desk' },
      decided(base('LVR000002', 'RES000007', 'Outpass', at(-3, '16:00'), { reason: 'Friend\'s birthday party', departAt: at(-2, '20:00'), returnAt: at(-1, '01:30'), destination: 'Banjara Hills' }), 'Rejected', at(-3, '18:05'), 'Return after the 10:30 PM gate closing time is not permitted for outpasses.'),
      { ...base('LVR000001', 'RES000001', 'Leave', at(-10, '09:00'), { reason: 'Hometown visit', departAt: at(-8, '06:00'), returnAt: at(-6, '20:00'), destination: 'Jaipur, Rajasthan' }), status: 'Cancelled', cancelledBy: 'Rahul Sharma', cancelledAt: at(-9, '11:30'), cancelReason: 'Plans changed — exams rescheduled.' },
    ];
  }
}
