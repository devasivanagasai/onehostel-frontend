import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { HostelSettingsService } from './hostel-settings.service';
import { ResidentsService } from './residents.service';
import { diffForAudit } from '../models/audit.models';
import { HostelResident } from '../models/residents.models';
import { localDateIso } from '../../shared/utils/local-date';
import {
  AcademicYear,
  AcademicYearEvent,
  AcademicYearInput,
  AcademicYearStatus,
  MAX_ELIGIBILITY_CHIPS,
  MIN_DURATION_DAYS,
  NEXT_STATUSES,
  REASON_MAX,
  daysBetween,
  normalizeYearName,
  scopeKey,
} from '../models/academic-years.models';

// Mock data in localStorage. This service only READS residents (to list and label them): assigning a
// resident to a year, activating or completing a year never checks anyone out, moves a bed or touches
// rooms. Allocations for a new year are separate records, so earlier years keep their history.
// Audit: every mutation goes through AuditLogService.

const STORAGE_KEY = 'onehostel_academic_years_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

const AUDIT_LABELS: Record<string, string> = {
  name: 'Name',
  startDate: 'Start date',
  endDate: 'End date',
  block: 'Applicable block',
  eligibility: 'Resident eligibility',
  allocationWindow: 'Allocation window',
  residentCount: 'Assigned residents',
};

/** Local wall-clock date-time as yyyy-mm-ddTHH:mm:ss. */
function nowIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDateIso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const ev = (at: string, by: string, action: string, note?: string): AcademicYearEvent => ({ at, by, action, note });

/** Seed: last year completed, this year active with a few students, next year a draft. */
function seed(): AcademicYear[] {
  const o = 'Hostel Owner';
  const base = { hostelId: HOSTEL_ID, block: '', eligibility: [] as string[] };
  return [
    {
      ...base, id: 'AY000001', name: '2025–2026', startDate: '2025-06-15', endDate: '2026-05-31', status: 'Completed', residentIds: ['RES000010'],
      allocationWindow: { start: '2025-05-15', end: '2025-07-15' }, createdAt: '2025-04-01T10:00:00', updatedAt: '2026-06-02T09:00:00',
      history: [ev('2025-04-01T10:00:00', o, 'Academic year created'), ev('2025-06-01T09:00:00', o, 'Status changed to Upcoming'), ev('2025-06-15T09:00:00', o, 'Status changed to Active'), ev('2026-06-02T09:00:00', o, 'Status changed to Completed')],
    },
    {
      ...base, id: 'AY000002', name: '2026–2027', startDate: '2026-06-15', endDate: '2027-05-31', status: 'Active', residentIds: ['RES000001', 'RES000003', 'RES000005', 'RES000007'],
      eligibility: ['B.Tech', 'MBBS', 'B.Com'], allocationWindow: { start: '2026-05-15', end: '2026-07-31' }, createdAt: '2026-03-20T10:00:00', updatedAt: '2026-06-15T09:00:00',
      history: [ev('2026-03-20T10:00:00', o, 'Academic year created'), ev('2026-06-01T09:00:00', o, 'Status changed to Upcoming'), ev('2026-06-15T09:00:00', o, 'Status changed to Active')],
    },
    {
      ...base, id: 'AY000003', name: '2027–2028', startDate: '2027-06-15', endDate: '2028-05-31', status: 'Draft', residentIds: [],
      createdAt: '2026-10-10T10:00:00', updatedAt: '2026-10-10T10:00:00', history: [ev('2026-10-10T10:00:00', o, 'Academic year created')],
    },
  ];
}

export interface AssignResult {
  year: AcademicYear;
  /** Residents in the request who were skipped, with the reason. */
  skipped: { residentId: string; reason: string }[];
}

@Injectable({ providedIn: 'root' })
export class AcademicYearsService {
  private readonly auth = inject(AuthService);
  private readonly audit = inject(AuditLogService);
  private readonly settings = inject(HostelSettingsService);
  private readonly residentsService = inject(ResidentsService);

  private readonly subject = new BehaviorSubject<AcademicYear[]>(this.load());
  readonly years$: Observable<AcademicYear[]> = this.subject.asObservable();

  get years(): AcademicYear[] {
    return this.subject.value;
  }

  /** Academic years apply to College Hostels only (hostel type from Hostel Settings). */
  get isCollegeHostel(): boolean {
    return /college/i.test(this.settings.state.hostelType ?? '');
  }

  byId(id: string): AcademicYear | undefined {
    return this.years.find((y) => y.id === id);
  }

  /** The Active year for a scope (block text; '' = whole hostel). Without a scope, the first Active year. */
  activeYear(block?: string): AcademicYear | undefined {
    const active = this.years.filter((y) => y.status === 'Active');
    return block === undefined ? active[0] : active.find((y) => scopeKey(y.block) === scopeKey(block));
  }

  // ---- Derived state -----------------------------------------------------------------

  /** Draft / Upcoming whose start date has arrived (and whose end has not passed). Shown only; status is never changed automatically. */
  isReadyToActivate(y: AcademicYear): boolean {
    const today = localDateIso();
    return (y.status === 'Draft' || y.status === 'Upcoming') && y.startDate <= today && y.endDate >= today;
  }

  /** Statuses this year may move to now. */
  nextStatuses(y: AcademicYear): AcademicYearStatus[] {
    return NEXT_STATUSES[y.status];
  }

  /** Draft / Upcoming / Active can be edited; Completed only through `authorizedCorrection`; Archived never. */
  canEdit(y: AcademicYear): boolean {
    return y.status === 'Draft' || y.status === 'Upcoming' || y.status === 'Active';
  }

  canCorrect(y: AcademicYear): boolean {
    return y.status === 'Completed';
  }

  // ---- Residents (read only) ---------------------------------------------------------

  /** Residents that can be assigned: current ones (not deactivated, not checked out). */
  get assignableResidents(): HostelResident[] {
    return this.residentsService.residents.filter((r) => !r.deactivatedAt && r.status !== 'Checked Out');
  }

  resident(id: string): HostelResident | undefined {
    return this.residentsService.byId(id);
  }

  /** Where a resident sleeps now, for display only. */
  location(residentId: string): string {
    const alloc = this.residentsService.allocationFor(residentId);
    return alloc ? this.residentsService.describe(alloc) : 'No bed';
  }

  /** The other non-archived year in the same scope that already has this resident. */
  assignedElsewhere(residentId: string, year: AcademicYear): AcademicYear | undefined {
    return this.years.find((y) => y.id !== year.id && y.status !== 'Archived' && scopeKey(y.block) === scopeKey(year.block) && y.residentIds.includes(residentId));
  }

  /** Resident's college / group matches one of the year's eligibility labels (informational). */
  matchesEligibility(r: HostelResident, y: AcademicYear): boolean {
    if (!y.eligibility.length) return true;
    const hay = `${r.collegeOrCompany ?? ''} ${r.residentType}`.toLowerCase();
    return y.eligibility.some((e) => hay.includes(e.toLowerCase()));
  }

  // ---- Validation --------------------------------------------------------------------

  /** First problem with the input, or '' when it can be saved. `exceptId` = the year being edited. */
  validate(input: AcademicYearInput, exceptId?: string): string {
    const name = input.name?.trim() ?? '';
    if (!name) return 'Academic year name is required.';
    if (name.length > 60) return 'Name must be 60 characters or fewer.';
    const same = this.years.find((y) => y.id !== exceptId && normalizeYearName(y.name) === normalizeYearName(name));
    if (same) return `An academic year named "${same.name}" already exists (${same.id}).`;
    if (!input.startDate) return 'Start date is required.';
    if (!input.endDate) return 'End date is required.';
    if (input.endDate <= input.startDate) return 'End date must be after the start date.';
    if (daysBetween(input.startDate, input.endDate) + 1 < MIN_DURATION_DAYS) return `An academic year must last at least ${MIN_DURATION_DAYS} days.`;
    const clash = this.overlapping(input.startDate, input.endDate, input.block, exceptId);
    if (clash) return `Dates overlap with ${clash.name} (${clash.id}, ${clash.startDate} to ${clash.endDate}) in the same scope.`;
    const elig = input.eligibility ?? [];
    if (elig.length > MAX_ELIGIBILITY_CHIPS) return `At most ${MAX_ELIGIBILITY_CHIPS} eligibility labels.`;
    const win = input.allocationWindow;
    if (win && (win.start || win.end)) {
      if (!win.start || !win.end) return 'Enter both allocation window dates, or leave both empty.';
      if (win.end < win.start) return 'Allocation window must end on or after it starts.';
      if (win.start > input.endDate || win.end > input.endDate) return 'Allocation window must lie within or before the academic year end.';
    }
    return '';
  }

  /** Another non-archived year in the same scope whose dates overlap [start, end]. */
  overlapping(start: string, end: string, block: string | undefined, exceptId?: string): AcademicYear | undefined {
    return this.years.find((y) => y.id !== exceptId && y.status !== 'Archived' && scopeKey(y.block) === scopeKey(block) && start <= y.endDate && y.startDate <= end);
  }

  // ---- Actions -----------------------------------------------------------------------

  create(input: AcademicYearInput): AcademicYear {
    const problem = this.validate(input);
    if (problem) throw new Error(problem);
    const now = nowIso();
    const y: AcademicYear = {
      id: this.nextId(),
      hostelId: HOSTEL_ID,
      ...this.clean(input),
      status: 'Draft',
      residentIds: [],
      createdAt: now,
      updatedAt: now,
      history: [ev(now, this.userName, 'Academic year created')],
    };
    this.commit([y, ...this.years]);
    this.audit.record('Create Academic Year', this.label(y), { details: `${y.startDate} to ${y.endDate}${y.block ? ` · block ${y.block}` : ''} · Draft` });
    return y;
  }

  /** Edits a Draft / Upcoming / Active year. Completed years need `authorizedCorrection`; Archived are read-only. */
  update(id: string, input: AcademicYearInput): AcademicYear {
    const before = this.require(id);
    if (before.status === 'Archived') throw new Error('Archived academic years are read-only.');
    if (before.status === 'Completed') throw new Error('Completed academic years are read-only. Use an authorized correction with a reason.');
    return this.applyEdit(before, input, 'Academic year updated');
  }

  /** The one way to change a Completed year: needs a reason, which is audited. */
  authorizedCorrection(id: string, input: AcademicYearInput, reason: string): AcademicYear {
    const before = this.require(id);
    if (before.status !== 'Completed') throw new Error('Authorized corrections apply to Completed academic years only.');
    const why = this.cleanReason(reason);
    return this.applyEdit(before, input, 'Authorized correction', why);
  }

  /**
   * Moves a year forward (Draft → Upcoming → Active → Completed → Archived; a Draft may be archived).
   * Activating or completing does NOT check out, move or reallocate any resident.
   */
  changeStatus(id: string, next: AcademicYearStatus, note?: string): AcademicYear {
    const y = this.require(id);
    if (!NEXT_STATUSES[y.status].includes(next)) {
      throw new Error(y.status === 'Archived' ? 'Archived academic years cannot change status.' : `A ${y.status} academic year cannot move to ${next}. Status only moves forward: Draft, Upcoming, Active, Completed, Archived.`);
    }
    if (next === 'Active') {
      const other = this.years.find((x) => x.id !== y.id && x.status === 'Active' && scopeKey(x.block) === scopeKey(y.block));
      if (other) throw new Error(`${other.name} (${other.id}) is already Active for this scope. Complete it first.`);
    }
    const now = nowIso();
    const trimmed = note?.trim();
    const updated: AcademicYear = { ...y, status: next, updatedAt: now, history: [...y.history, ev(now, this.userName, `Status changed to ${next}`, trimmed || undefined)] };
    this.replace(updated);
    this.audit.record('Change Academic Year Status', this.label(y), {
      changes: [{ field: 'Status', oldValue: y.status, newValue: next }],
      ...(next === 'Active' || next === 'Completed' ? { details: 'No resident was checked out or reallocated' } : {}),
    });
    return updated;
  }

  /** Assigns a resident to a year. Their bed allocation is not touched. */
  assignResident(yearId: string, residentId: string): AcademicYear {
    const y = this.require(yearId);
    const problem = this.assignProblem(y, residentId);
    if (problem) throw new Error(problem);
    return this.saveAssignments(y, [...y.residentIds, residentId], `Assigned ${this.residentLabel(residentId)}`);
  }

  unassignResident(yearId: string, residentId: string): AcademicYear {
    const y = this.require(yearId);
    this.assertAssignable(y);
    if (!y.residentIds.includes(residentId)) throw new Error('This resident is not assigned to the academic year.');
    return this.saveAssignments(y, y.residentIds.filter((x) => x !== residentId), `Unassigned ${this.residentLabel(residentId)}`);
  }

  /** Assigns many at once; each resident is checked on its own and skipped (with a reason) when not allowed. */
  assignMany(yearId: string, residentIds: string[]): AssignResult {
    let y = this.require(yearId);
    this.assertAssignable(y);
    const skipped: AssignResult['skipped'] = [];
    const add: string[] = [];
    for (const id of new Set(residentIds)) {
      const problem = this.assignProblem({ ...y, residentIds: [...y.residentIds, ...add] }, id);
      if (problem) skipped.push({ residentId: id, reason: problem });
      else add.push(id);
    }
    if (add.length) y = this.saveAssignments(y, [...y.residentIds, ...add], `Assigned ${add.length} resident${add.length === 1 ? '' : 's'}`);
    return { year: y, skipped };
  }

  // ---------------------------------------------------------------------------

  private assertAssignable(y: AcademicYear): void {
    if (y.status === 'Archived') throw new Error('Archived academic years are read-only.');
    if (y.status === 'Completed') throw new Error('Completed academic years are read-only. Use an authorized correction to change them.');
  }

  /** Why the resident cannot be assigned (empty = can). */
  assignProblem(y: AcademicYear, residentId: string): string {
    if (y.status === 'Archived') return 'Archived academic years are read-only.';
    if (y.status === 'Completed') return 'Completed academic years are read-only.';
    const r = this.resident(residentId);
    if (!r) return 'Resident not found.';
    if (r.deactivatedAt) return `${residentId} is deactivated.`;
    if (r.status === 'Checked Out') return `${residentId} has checked out.`;
    if (y.residentIds.includes(residentId)) return `${residentId} is already assigned to this academic year.`;
    const other = this.assignedElsewhere(residentId, y);
    return other ? `${residentId} is already assigned to ${other.name} (${other.id}) in the same scope. Unassign them there first.` : '';
  }

  private saveAssignments(y: AcademicYear, residentIds: string[], action: string): AcademicYear {
    const now = nowIso();
    const next: AcademicYear = { ...y, residentIds, updatedAt: now, history: [...y.history, ev(now, this.userName, action)] };
    this.replace(next);
    this.audit.record('Update Academic Year', this.label(y), {
      details: action,
      changes: [{ field: AUDIT_LABELS['residentCount'], oldValue: String(y.residentIds.length), newValue: String(residentIds.length) }],
    });
    return next;
  }

  private applyEdit(before: AcademicYear, input: AcademicYearInput, action: string, reason?: string): AcademicYear {
    const problem = this.validate(input, before.id);
    if (problem) throw new Error(problem);
    const now = nowIso();
    const next: AcademicYear = { ...before, ...this.clean(input), updatedAt: now };
    const view = (y: AcademicYear): Record<string, unknown> => ({
      ...y,
      eligibility: y.eligibility.join(', '),
      allocationWindow: y.allocationWindow ? `${y.allocationWindow.start} to ${y.allocationWindow.end}` : '',
    });
    const changes = diffForAudit(view(before), view(next), AUDIT_LABELS);
    next.history = [...before.history, ev(now, this.userName, action, [reason, changes.length ? changes.map((c) => c.field).join(', ') : 'No changes'].filter(Boolean).join(' · '))];
    this.replace(next);
    if (changes.length || reason) {
      this.audit.record('Update Academic Year', this.label(next), { ...(reason ? { details: `Authorized correction. Reason: ${reason}` } : {}), changes });
    }
    return next;
  }

  private clean(input: AcademicYearInput): Pick<AcademicYear, 'name' | 'startDate' | 'endDate' | 'block' | 'eligibility' | 'allocationWindow'> {
    const seen = new Set<string>();
    const eligibility = (input.eligibility ?? [])
      .map((e) => e.trim())
      .filter((e) => e && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
    const w = input.allocationWindow;
    return {
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      block: (input.block ?? '').trim(),
      eligibility,
      allocationWindow: w && w.start && w.end ? { start: w.start, end: w.end } : undefined,
    };
  }

  private cleanReason(reason: string): string {
    const why = reason?.trim() ?? '';
    if (!why) throw new Error('A reason is required for an authorized correction.');
    if (why.length > REASON_MAX) throw new Error(`Reason must be ${REASON_MAX} characters or fewer.`);
    return why;
  }

  private label(y: AcademicYear): string {
    return `${y.id} – ${y.name}`;
  }

  private residentLabel(id: string): string {
    const r = this.resident(id);
    return r ? `${r.firstName} ${r.lastName}`.trim() + ` (${id})` : id;
  }

  private replace(next: AcademicYear): AcademicYear {
    this.commit(this.years.map((y) => (y.id === next.id ? next : y)));
    return next;
  }

  private require(id: string): AcademicYear {
    const y = this.byId(id);
    if (!y) throw new Error('Academic year not found.');
    return y;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.years.reduce((m, y) => Math.max(m, Number(y.id.slice(2)) || 0), 0);
    return `AY${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: AcademicYear[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): AcademicYear[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AcademicYear[];
    } catch {
      // Fall through to the seed data.
    }
    const list = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
    return list;
  }
}
