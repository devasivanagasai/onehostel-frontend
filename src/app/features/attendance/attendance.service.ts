import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AppFormatService } from '../../core/services/app-format.service';
import { ResidentsService } from '../../core/services/residents.service';
import { HostelResident, residentFullName } from '../../core/models/residents.models';
import { LeaveOutpassService } from '../../core/services/leave-outpass.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { NewTenantNotification, TenantNotificationService } from '../../core/services/tenant-notification.service';
import { dayEnd, dayStart, localDate, localIso, time } from '../../core/models/leave-outpass.models';
import {
  AttendanceChange,
  AttendanceChangeInput,
  AttendanceMethod,
  AttendanceRecord,
  AttendanceRow,
  AttendanceSession,
  AttendanceStatus,
  DEFAULT_METHODS,
  MANUAL_METHODS,
  MethodSettings,
  RecordedStatus,
  SessionError,
} from './attendance.models';

// Audit: AUDIT_EVENTS (core/models/audit.models.ts) has no attendance events, so nothing is recorded
// there. Every change is kept in the record's own history (who, when, method, before → after, reason).
// Dependency is one-way: attendance reads leave / movement from LeaveOutpassService, never the reverse.

const STORAGE_KEY = 'onehostel_attendance_v1';
const METHODS_KEY = 'onehostel_attendance_methods_v1';
const CORRECTIONS_KEY = 'onehostel_attendance_corrections_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

const DAY_MS = 86_400_000;
const hhmm = (iso?: string): string => (iso ? iso.slice(11, 16) : '—');

/** Local date `days` from today. */
const dayOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
};

export type CorrectionStatus = 'Open' | 'Accepted' | 'Declined' | 'Withdrawn';

/**
 * A resident's query about an attendance day. It never changes the official record: staff review it and,
 * if justified, correct the record themselves through `save` (with a reason) and then `decideCorrectionRequest`.
 */
export interface AttendanceCorrectionRequest {
  /** e.g. ACR000001 */
  id: string;
  hostelId: string;
  residentId: string;
  /** Hostel-local date the query is about (yyyy-mm-dd). */
  date: string;
  reason: string;
  /** What the official record said when the request was raised. */
  recordedStatus: AttendanceStatus;
  status: CorrectionStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export const CORRECTION_WINDOW_DAYS = 14;
export const CORRECTION_REASON_MIN = 10;
export const CORRECTION_REASON_MAX = 300;
/** How far back a Tenant can browse attendance. */
export const HISTORY_MONTHS = 12;

export interface TenantAttendanceRow {
  date: string;
  status: AttendanceStatus;
  /** First check-in and last check-out of the day (local date-times), when the system captured them. */
  checkIn?: string;
  checkOut?: string;
  sessions: AttendanceSession[];
  method?: AttendanceMethod;
  /** Approved leave covering the day: an approval, not proof the resident was away. */
  leave?: { id: string; type: string; departAt: string; returnAt: string; movement: string | null };
  /** Security's gate records say the resident was out all day. */
  physicallyOut: boolean;
  openCorrection?: AttendanceCorrectionRequest;
}

export interface TenantAttendanceSummary {
  Present: number;
  Absent: number;
  'On Leave': number;
  'Not Expected': number;
  Unknown: number;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly residents = inject(ResidentsService);
  private readonly leave = inject(LeaveOutpassService);
  private readonly auth = inject(AuthService);
  private readonly fmt = inject(AppFormatService);
  private readonly tenantCtx = inject(TenantContextService);
  private readonly tenantNotify = inject(TenantNotificationService);

  private readonly corrections = new BehaviorSubject<AttendanceCorrectionRequest[]>(this.loadCorrections());
  readonly corrections$: Observable<AttendanceCorrectionRequest[]> = this.corrections.asObservable();

  private readonly methodsSubject = new BehaviorSubject<MethodSettings>(this.loadMethods());
  readonly methods$ = this.methodsSubject.asObservable();

  private readonly subject = new BehaviorSubject<AttendanceRecord[]>(this.load());
  readonly records$: Observable<AttendanceRecord[]> = this.subject.asObservable();

  get records(): AttendanceRecord[] {
    return this.subject.value;
  }

  get methods(): MethodSettings {
    return this.methodsSubject.value;
  }

  /** Enabled methods staff can choose on this screen. */
  get manualMethods(): AttendanceMethod[] {
    return MANUAL_METHODS.filter((m) => this.methods[m]);
  }

  /** Corrections need the Hostel Owner (or Admin) role. */
  get canCorrect(): boolean {
    return this.auth.isHostelOwner || this.auth.isAdmin;
  }

  get today(): string {
    return localDate();
  }

  recordFor(residentId: string, date: string): AttendanceRecord | undefined {
    return this.records.find((r) => r.residentId === residentId && r.date === date && r.hostelId === HOSTEL_ID);
  }

  byId(id: string): AttendanceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  // ---- Daily list --------------------------------------------------------------

  /**
   * Residents for a date: current residents with a bed, plus anyone checked out on/after that date.
   * Those who joined after the date (or left before it) are listed as Not Expected.
   */
  rows(date: string): AttendanceRow[] {
    const list: AttendanceRow[] = [];
    for (const r of this.residents.residents) {
      if (r.deactivatedAt) continue;
      const alloc = this.residents.allocationFor(r.residentId);
      const leftOnOrAfter = r.status === 'Checked Out' && !!r.checkOutDate && r.checkOutDate >= date;
      if (!(alloc && (r.status === 'Active' || r.status === 'On Leave')) && !leftOnOrAfter) continue;
      if (alloc && alloc.room.hostelId !== HOSTEL_ID) continue;

      const expected = r.joiningDate <= date && (!r.checkOutDate || r.checkOutDate >= date);
      const record = expected ? this.recordFor(r.residentId, date) : undefined;
      const leave = expected ? this.leave.approvedOn(r.residentId, date) : undefined;
      const leaveOut = !!leave && this.leave.outAllDay(leave, date);
      const status = !expected ? 'Not Expected' : record?.status ?? 'Unknown';
      list.push({
        resident: r,
        name: residentFullName(r),
        location: alloc ? this.residents.describe(alloc) : `Checked out ${r.checkOutDate}`,
        building: alloc?.room.building ?? '',
        expected,
        status,
        record,
        leave,
        leaveOut,
        conflict:
          status === 'Present' && leaveOut
            ? `Leave ${leave!.id} shows ${residentFullName(r)} out since ${this.fmt.date(leave!.exitAt!, 'datetime')} with no return — confirm physical presence.`
            : '',
      });
    }
    return list.sort((a, b) => Number(b.expected) - Number(a.expected) || a.location.localeCompare(b.location, undefined, { numeric: true }));
  }

  // ---- Validation -----------------------------------------------------------------

  /**
   * Impossible time sequences: times off the date or in the future, check-out before check-in,
   * stays overlapping the previous one, or more than one open check-in. A check-out may fall on the
   * next day (a stay that runs past midnight); a later stay can't start before it (overlap check).
   */
  sessionErrors(date: string, sessions: AttendanceSession[]): SessionError[] {
    const now = Date.now() + 60_000;
    return sessions.map((s, i) => {
      const e: SessionError = {};
      const tin = s.in ? time(s.in) : NaN;
      const tout = s.out ? time(s.out) : NaN;
      const prevOut = i > 0 ? sessions[i - 1].out : undefined;
      if (!s.in || isNaN(tin)) e.in = 'Enter the check-in time';
      else if (tin < dayStart(date) || tin > dayEnd(date)) e.in = 'Must be on the selected date';
      else if (tin > now) e.in = 'Check-in cannot be in the future';
      else if (i > 0 && !prevOut) e.in = 'Already checked in — check out first';
      else if (prevOut && tin < time(prevOut)) e.in = `Overlaps the previous stay (out ${hhmm(prevOut)})`;
      if (s.out) {
        if (isNaN(tout)) e.out = 'Enter a valid time';
        else if (tout > dayEnd(date) + DAY_MS) e.out = 'Must be on the selected date or the next day';
        else if (tout > now) e.out = 'Check-out cannot be in the future';
        else if (!isNaN(tin) && tout <= tin) e.out = 'Check-out must be after check-in';
      }
      return e;
    });
  }

  /** A reason is needed to correct a saved record, or for any entry on a past date. */
  needsReason(date: string, correcting: boolean): boolean {
    return correcting || date < this.today;
  }

  // ---- Recording --------------------------------------------------------------

  /** Create or change the record for a resident on a date. */
  save(residentId: string, date: string, input: AttendanceChangeInput, method: AttendanceMethod, reason = '', action?: AttendanceChange['action']): AttendanceRecord {
    const row = this.rows(date).find((r) => r.resident.residentId === residentId);
    if (!row) throw new Error('Resident is not on the list for this date.');
    if (!row.expected) throw new Error(`${row.name} was not expected on this date.`);
    if (date > this.today) throw new Error('Attendance cannot be recorded for a future date.');
    if (!this.methods[method]) throw new Error(`${method} recording is turned off.`);
    if (input.status === 'Absent' && input.sessions.length) throw new Error('Check-in times exist — mark Present or remove them.');
    const errors = this.sessionErrors(date, input.sessions);
    const bad = errors.find((e) => e.in || e.out);
    if (bad) throw new Error(bad.in || bad.out);

    // Changing a saved record, or any entry on a past date, is a correction: permission + reason.
    const existing = row.record;
    const timing = action === 'Checked in' || action === 'Checked out';
    if (this.needsReason(date, !!existing && !timing)) {
      if (!this.canCorrect) throw new Error('You do not have permission to correct attendance.');
      if (!reason.trim()) throw new Error('A reason is required for this change.');
    }

    const now = localIso();
    const by = this.userName;
    const details = this.describeChange(existing, input);
    if (existing && !details) throw new Error('Nothing changed — update the status, times or remarks first.');

    const entry: AttendanceChange = {
      at: now,
      by,
      method,
      action: action ?? (existing ? 'Corrected' : date < this.today ? 'Late entry' : 'Marked'),
      details: details || input.status,
      reason: reason.trim() || undefined,
    };
    const next: AttendanceRecord = {
      id: existing?.id ?? this.nextId(),
      hostelId: HOSTEL_ID,
      residentId,
      date,
      status: input.status,
      sessions: input.sessions,
      remarks: input.remarks?.trim() || undefined,
      method,
      recordedBy: by,
      recordedAt: now,
      history: [...(existing?.history ?? []), entry],
    };
    this.commit(existing ? this.records.map((r) => (r.id === existing.id ? next : r)) : [...this.records, next]);
    return next;
  }

  /** Check in at `when` (local date-time). Marks Present; refuses a second open check-in. */
  checkIn(residentId: string, date: string, when: string, method: AttendanceMethod, reason = ''): AttendanceRecord {
    const rec = this.recordFor(residentId, date);
    const sessions = [...(rec?.sessions ?? [])];
    const open = sessions.find((s) => !s.out);
    if (open) throw new Error(`Already checked in at ${hhmm(open.in)} — check out first.`);
    if (rec?.status === 'Absent') throw new Error('Marked Absent — correct the status before checking in.');
    sessions.push({ in: when, inMethod: method });
    return this.save(residentId, date, { status: rec?.status === 'On Leave' ? 'On Leave' : 'Present', sessions, remarks: rec?.remarks }, method, reason, 'Checked in');
  }

  checkOut(residentId: string, date: string, when: string, method: AttendanceMethod, reason = ''): AttendanceRecord {
    const rec = this.recordFor(residentId, date);
    const sessions = (rec?.sessions ?? []).map((s) => ({ ...s }));
    const open = sessions.find((s) => !s.out);
    if (!rec || !open) throw new Error('Not checked in — nothing to check out.');
    if (when.slice(0, 10) > date) {
      // After midnight: the next day's own record must not already show the resident inside before this check-out.
      const nextRec = this.records.find((r) => r.residentId === residentId && r.date === when.slice(0, 10));
      if (nextRec?.sessions.some((s) => s.in && time(s.in) < time(when))) throw new Error('A check-in on the next day starts before this check-out.');
    }
    open.out = when;
    open.outMethod = method;
    return this.save(residentId, date, { status: rec.status, sessions, remarks: rec.remarks }, method, reason, 'Checked out');
  }

  /** Today only: mark expected, unmarked residents as Present, except those on approved leave for the whole day. */
  markAllPresent(date: string, method: AttendanceMethod): { marked: number; skipped: number } {
    if (date !== this.today) throw new Error('Bulk marking is only available for today.');
    const unmarked = this.rows(date).filter((r) => r.expected && !r.record);
    let marked = 0;
    for (const row of unmarked.filter((r) => !r.leaveOut)) {
      this.save(row.resident.residentId, date, { status: 'Present', sessions: [] }, method);
      marked++;
    }
    return { marked, skipped: unmarked.length - marked };
  }

  // ---- Tenant (resident app) -------------------------------------------------------
  // Read-only access to the Tenant's own record. The only write is a correction request, which is a
  // query for staff; the official record is never edited from here.

  /** Months a Tenant can browse, newest first, as yyyy-mm (current month back `HISTORY_MONTHS`). */
  tenantMonths(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i <= HISTORY_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }

  /** The Tenant's attendance for a month (today and earlier), newest day first. Months outside the permitted period are refused. */
  tenantHistory(month: string): TenantAttendanceRow[] {
    const me = this.tenantCtx.requireResidentId();
    if (!/^\d{4}-\d{2}$/.test(month) || !this.tenantMonths().includes(month)) {
      throw new Error(`Attendance is available for the current month and the previous ${HISTORY_MONTHS} months.`);
    }
    const resident = this.tenantCtx.requireResident();
    const today = this.today;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const rows: TenantAttendanceRow[] = [];
    for (let day = 1; day <= lastDay; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      if (date > today) break;
      const expected = resident.joiningDate <= date && (!resident.checkOutDate || resident.checkOutDate >= date);
      const record = expected ? this.recordFor(me, date) : undefined;
      const leave = expected ? this.leave.approvedOn(me, date) : undefined;
      const sessions = record?.sessions ?? [];
      const lastOut = [...sessions].reverse().find((s) => s.out)?.out;
      rows.push({
        date,
        status: !expected ? 'Not Expected' : record?.status ?? 'Unknown',
        checkIn: sessions[0]?.in,
        checkOut: sessions.every((s) => s.out) ? lastOut : undefined,
        sessions,
        method: record?.method,
        leave: leave ? { id: leave.id, type: leave.type, departAt: leave.departAt, returnAt: leave.returnAt, movement: this.leave.movement(leave) } : undefined,
        physicallyOut: !!leave && this.leave.outAllDay(leave, date),
        openCorrection: this.corrections.value.find((c) => c.residentId === me && c.date === date && c.status === 'Open'),
      });
    }
    return rows.reverse();
  }

  tenantSummary(rows: TenantAttendanceRow[]): TenantAttendanceSummary {
    const s: TenantAttendanceSummary = { Present: 0, Absent: 0, 'On Leave': 0, 'Not Expected': 0, Unknown: 0 };
    for (const r of rows) s[r.status]++;
    return s;
  }

  /** The Tenant's correction requests, newest first. */
  tenantCorrections(): AttendanceCorrectionRequest[] {
    const me = this.tenantCtx.residentId;
    if (!me) return [];
    return this.corrections.value.filter((c) => c.residentId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  /** Problem with a new correction request, or '' when it can be raised. */
  correctionError(date: string, reason: string): string {
    const me = this.tenantCtx.residentId;
    if (!me) return 'Sign in as a Tenant to do this.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || isNaN(new Date(`${date}T00:00:00`).getTime())) return 'Pick the attendance date.';
    if (date > this.today) return 'You can only query a date that has already happened.';
    if (date < dayOffset(-CORRECTION_WINDOW_DAYS)) return `Corrections can be requested only for the last ${CORRECTION_WINDOW_DAYS} days.`;
    const resident = this.tenantCtx.resident;
    if (!resident || resident.joiningDate > date || (resident.checkOutDate && resident.checkOutDate < date)) return 'You were not expected at the hostel on that date.';
    const text = reason?.trim() ?? '';
    if (text.length < CORRECTION_REASON_MIN) return `Give a reason of at least ${CORRECTION_REASON_MIN} characters.`;
    if (text.length > CORRECTION_REASON_MAX) return `Reason can be at most ${CORRECTION_REASON_MAX} characters.`;
    const open = this.corrections.value.find((c) => c.residentId === me && c.date === date && c.status === 'Open');
    if (open) return `You already have an open request (${open.id}) for this date.`;
    return '';
  }

  /** Raises a correction request for one of the Tenant's own days. The official record is not changed. */
  createCorrectionRequest(input: { date: string; reason: string }): AttendanceCorrectionRequest {
    const me = this.tenantCtx.requireResidentId();
    const err = this.correctionError(input.date, input.reason);
    if (err) throw new Error(err);
    const req: AttendanceCorrectionRequest = {
      id: this.nextCorrectionId(),
      hostelId: HOSTEL_ID,
      residentId: me,
      date: input.date,
      reason: input.reason.trim(),
      recordedStatus: this.recordFor(me, input.date)?.status ?? 'Unknown',
      status: 'Open',
      createdAt: localIso(),
    };
    this.commitCorrections([req, ...this.corrections.value]);
    this.notifyTenant(me, { category: 'Support', title: 'Attendance query received', body: `${req.id} for ${req.date} is with the hostel office for review.`, route: '/my/attendance' });
    return req;
  }

  /** The Tenant withdraws their own open request. */
  withdrawCorrectionRequest(id: string): AttendanceCorrectionRequest {
    const me = this.tenantCtx.requireResidentId();
    const c = this.corrections.value.find((x) => x.id === id);
    if (!c || c.residentId !== me) throw new Error('Correction request not found.');
    if (c.status !== 'Open') throw new Error('Only an open request can be withdrawn.');
    const next: AttendanceCorrectionRequest = { ...c, status: 'Withdrawn', decidedAt: localIso(), decidedBy: 'Resident' };
    this.commitCorrections(this.corrections.value.map((x) => (x.id === id ? next : x)));
    return next;
  }

  /** OWNER SIDE (for the owner screen to use later): every correction request, newest first. Owner / Admin only. */
  allCorrectionRequests(): AttendanceCorrectionRequest[] {
    if (!this.canCorrect) throw new Error('You do not have permission to view correction requests.');
    return [...this.corrections.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  /**
   * OWNER SIDE: accept or decline a request. Accepting does not edit the record: correct it with `save`
   * (which needs a reason) and then record the outcome here. A decline needs a note.
   */
  decideCorrectionRequest(id: string, accept: boolean, note: string): AttendanceCorrectionRequest {
    if (!this.canCorrect) throw new Error('You do not have permission to decide correction requests.');
    const c = this.corrections.value.find((x) => x.id === id);
    if (!c) throw new Error('Correction request not found.');
    if (c.status !== 'Open') throw new Error('This request has already been decided.');
    if (!accept && !note?.trim()) throw new Error('Give a reason for declining.');
    const next: AttendanceCorrectionRequest = { ...c, status: accept ? 'Accepted' : 'Declined', decidedBy: this.userName, decidedAt: localIso(), decisionNote: note?.trim() || undefined };
    this.commitCorrections(this.corrections.value.map((x) => (x.id === id ? next : x)));
    this.notifyTenant(c.residentId, {
      category: 'Support',
      title: accept ? 'Attendance query accepted' : 'Attendance query declined',
      body: `${c.id} for ${c.date} was ${accept ? 'accepted' : 'declined'}${next.decisionNote ? ': ' + next.decisionNote : '.'}`,
      route: '/my/attendance',
    });
    return next;
  }

  private notifyTenant(residentId: string, n: NewTenantNotification): void {
    try {
      this.tenantNotify.push(residentId, n);
    } catch {
      // A notification must never block the action itself.
    }
  }

  private nextCorrectionId(): string {
    const max = this.corrections.value.reduce((m, c) => Math.max(m, Number(c.id.slice(3)) || 0), 0);
    return `ACR${String(max + 1).padStart(6, '0')}`;
  }

  private commitCorrections(list: AttendanceCorrectionRequest[]): void {
    this.corrections.next(list);
    this.store(CORRECTIONS_KEY, list);
  }

  private loadCorrections(): AttendanceCorrectionRequest[] {
    try {
      const raw = localStorage.getItem(CORRECTIONS_KEY);
      if (raw) return JSON.parse(raw) as AttendanceCorrectionRequest[];
    } catch {
      // Fall through to the seed data.
    }
    const list: AttendanceCorrectionRequest[] = [
      {
        id: 'ACR000001',
        hostelId: HOSTEL_ID,
        residentId: 'RES000001',
        date: dayOffset(-9),
        reason: 'I was in the college library until late and did not scan at the gate.',
        recordedStatus: 'Unknown',
        status: 'Declined',
        createdAt: `${dayOffset(-8)}T09:30:00`,
        decidedBy: 'Hostel Owner',
        decidedAt: `${dayOffset(-8)}T15:10:00`,
        decisionNote: 'No gate or CCTV record found for that night. Please raise it with your warden.',
      },
    ];
    this.store(CORRECTIONS_KEY, list);
    return list;
  }

  saveMethods(methods: MethodSettings): void {
    if (!Object.values(methods).some(Boolean)) throw new Error('Keep at least one method enabled.');
    this.methodsSubject.next({ ...methods });
    this.store(METHODS_KEY, methods);
  }

  // ---------------------------------------------------------------------------

  /** "Absent → Present · In 21:40 · Remarks updated"; '' when nothing changed. */
  private describeChange(prev: AttendanceRecord | undefined, next: AttendanceChangeInput): string {
    const parts: string[] = [];
    if (!prev || prev.status !== next.status) parts.push(prev ? `${prev.status} → ${next.status}` : next.status);
    const fmt = (ss: AttendanceSession[]) => ss.map((s) => `In ${hhmm(s.in)}${s.out ? ', Out ' + hhmm(s.out) : ''}`).join('; ');
    const before = fmt(prev?.sessions ?? []);
    const after = fmt(next.sessions);
    if (before !== after) parts.push(prev && before ? `Times ${before} → ${after || 'none'}` : after);
    if ((prev?.remarks ?? '') !== (next.remarks?.trim() ?? '')) parts.push(next.remarks?.trim() ? `Remarks: ${next.remarks.trim()}` : 'Remarks cleared');
    return parts.filter(Boolean).join(' · ');
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.records.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0);
    return `ATT${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: AttendanceRecord[]): void {
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

  private loadMethods(): MethodSettings {
    try {
      const raw = localStorage.getItem(METHODS_KEY);
      if (raw) return { ...DEFAULT_METHODS, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
    return { ...DEFAULT_METHODS };
  }

  private load(): AttendanceRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AttendanceRecord[];
    } catch {
      // Fall through to the seed data.
    }
    const list = this.seed();
    this.store(STORAGE_KEY, list);
    return list;
  }

  /** Three past days plus this morning (when it's late enough), matching the leave seed. */
  private seed(): AttendanceRecord[] {
    const list: AttendanceRecord[] = [];
    const add = (residentId: string, date: string, status: RecordedStatus, method: AttendanceMethod, by: string, recAt: string, sessions: AttendanceSession[] = [], remarks?: string, history?: AttendanceChange[]) => {
      list.push({
        id: `ATT${String(list.length + 1).padStart(6, '0')}`,
        hostelId: HOSTEL_ID, residentId, date, status, sessions, remarks, method, recordedBy: by, recordedAt: recAt,
        history: history ?? [{ at: recAt, by, method, action: 'Marked', details: [status, ...sessions.map((s) => `In ${hhmm(s.in)}${s.out ? ', Out ' + hhmm(s.out) : ''}`)].join(' · ') }],
      });
    };
    const t = (date: string, hm: string) => `${date}T${hm}:00`;
    const owner = 'Hostel Owner';
    const guard = 'Security Desk';
    const qr = (date: string, hm: string): AttendanceSession => ({ in: t(date, hm), inMethod: 'QR' });

    for (const [offset, i] of [[-3, 0], [-2, 1], [-1, 2]] as const) {
      const d = dayOffset(offset);
      const roll = t(d, '22:15');
      // Rohit is on approved leave (out since 11 days ago).
      if (offset === -1) {
        // Marked Present by the night guard although the leave record shows him out: flagged as a conflict.
        add('RES000004', d, 'Present', 'Security', guard, roll, [], 'Marked at roll call');
      } else {
        add('RES000004', d, 'On Leave', 'Admin', owner, t(d, '09:00'), [], 'Approved leave LVR000004');
      }
      // Vivek came back from leave on day -3 evening.
      add('RES000003', d, 'Present', offset === -3 ? 'Security' : 'QR', offset === -3 ? guard : 'Gate scanner', roll,
        [offset === -3 ? { in: t(d, '17:45'), inMethod: 'Security' } : qr(d, `19:${10 + i * 7}`)]);
      add('RES000001', d, 'Present', 'QR', 'Gate scanner', roll, [{ ...qr(d, '08:05'), out: t(d, '09:00'), outMethod: 'QR' }, qr(d, `20:${15 + i * 5}`)]);
      add('RES000002', d, 'Present', 'QR', 'Gate scanner', roll, [qr(d, `21:0${i * 3}`)]);
      if (offset !== -3) add('RES000006', d, 'Present', 'Admin', owner, roll); // left unmarked on day -3
      if (offset === -2) {
        add('RES000007', d, 'Absent', 'Security', guard, roll, [], 'Not in at night roll call');
        // Corrected next morning: QR failed at the gate, CCTV shows him coming in.
        add('RES000005', d, 'Present', 'Admin', owner, t(dayOffset(-1), '09:20'), [{ in: t(d, '21:40'), inMethod: 'Admin' }], 'QR scan failed at gate', [
          { at: roll, by: guard, method: 'Security', action: 'Marked', details: 'Absent', reason: undefined },
          { at: t(dayOffset(-1), '09:20'), by: owner, method: 'Admin', action: 'Corrected', details: 'Absent → Present · In 21:40', reason: 'QR scan failed at the gate; CCTV confirms entry at 9:40 PM.' },
        ]);
      } else {
        add('RES000007', d, 'Present', 'QR', 'Gate scanner', roll, [qr(d, '22:02')]);
        add('RES000005', d, 'Present', 'QR', 'Gate scanner', roll, [qr(d, '20:48')]);
      }
    }

    // This morning, only when enough of the day has passed for the times to be in the past.
    const now = new Date();
    if (now.getHours() >= 10) {
      const d = localDate();
      const ago = (h: number) => localIso(new Date(Math.round((now.getTime() - h * 3_600_000) / 300_000) * 300_000));
      add('RES000003', d, 'Present', 'QR', 'Gate scanner', ago(2), [{ in: ago(2), inMethod: 'QR' }]);
      // Both left later on approved outpasses (see the leave seed).
      add('RES000002', d, 'Present', 'Security', guard, ago(7.8), [{ in: ago(9), inMethod: 'QR', out: ago(7.8), outMethod: 'Security' }]);
      add('RES000001', d, 'Present', 'Security', guard, ago(2.9), [{ in: ago(5), inMethod: 'Security', out: ago(2.9), outMethod: 'Security' }]);
    }
    return list;
  }
}
