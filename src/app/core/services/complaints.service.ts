import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { TenantNotificationService } from './tenant-notification.service';
import { ResidentsService } from './residents.service';
import { residentFullName } from '../models/residents.models';
import { localDateIso } from '../../shared/utils/local-date';
import {
  Complaint,
  ComplaintAttachment,
  ComplaintCategory,
  ComplaintEvent,
  ComplaintEventType,
  ComplaintPriority,
  ComplaintStatus,
  REOPEN_WINDOW_DAYS,
  isActive,
  staffLabel,
} from '../models/complaints.models';

const STORAGE_KEY = 'onehostel_complaints_v1';

export interface ComplaintStats {
  open: number;
  inProgress: number;
  urgent: number;
  overdue: number;
  resolvedThisMonth: number;
  /** Average hours from creation to resolution, over complaints resolved this month. */
  avgResolutionHours: number | null;
}

export interface NewComplaintInput {
  residentId: string;
  category: ComplaintCategory;
  title: string;
  description: string;
  priority: ComplaintPriority;
  targetDate?: string;
  assignedTo?: string;
  attachments: ComplaintAttachment[];
}

const todayIso = (): string => localDateIso();

/** Event author used for anything a Tenant did (matches the seed data). */
export const TENANT_AUTHOR = 'Resident App';
export const CONFIRMED_TEXT = 'Tenant confirmed the issue is resolved.';
/** Staff notes starting with this tag are internal: never shown to the Tenant. */
export const INTERNAL_NOTE = /^\s*\[internal\]/i;

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
const nowIso = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
};

@Injectable({ providedIn: 'root' })
export class ComplaintsService {
  private readonly residents = inject(ResidentsService);
  private readonly auditLog = inject(AuditLogService);
  private readonly auth = inject(AuthService);
  private readonly tenantNotes = inject(TenantNotificationService);

  private readonly subject = new BehaviorSubject<Complaint[]>(this.load());
  readonly complaints$: Observable<Complaint[]> = this.subject.asObservable();

  readonly stats$: Observable<ComplaintStats> = this.complaints$.pipe(
    map((list) => {
      const month = todayIso().slice(0, 7);
      const resolvedThisMonth = list.filter((c) => c.resolvedAt?.startsWith(month));
      const hours = resolvedThisMonth.map((c) => (new Date(c.resolvedAt!).getTime() - new Date(c.createdAt).getTime()) / 3_600_000);
      return {
        open: list.filter((c) => c.status === 'Open' || c.status === 'Reopened').length,
        inProgress: list.filter((c) => c.status === 'In Progress').length,
        urgent: list.filter((c) => isActive(c) && c.priority === 'Urgent').length,
        overdue: list.filter((c) => this.isOverdue(c)).length,
        resolvedThisMonth: resolvedThisMonth.length,
        avgResolutionHours: hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
      };
    }),
  );

  get complaints(): Complaint[] {
    return this.subject.value;
  }

  byId(id: string): Complaint | undefined {
    return this.complaints.find((c) => c.id === id);
  }

  /** Resolve / close / reopen need Admin or Hostel Owner rights. */
  get canResolve(): boolean {
    return this.auth.isAdmin || this.auth.isHostelOwner;
  }

  isOverdue(c: Complaint, today = todayIso()): boolean {
    return isActive(c) && !!c.targetDate && c.targetDate < today;
  }

  /** Reopening is allowed only for Resolved complaints, within the policy window. */
  canReopen(c: Complaint): boolean {
    if (c.status !== 'Resolved' || !c.resolvedAt) return false;
    const days = (Date.now() - new Date(c.resolvedAt).getTime()) / 86_400_000;
    return days <= REOPEN_WINDOW_DAYS;
  }

  /** Statuses an admin can move to from the current one (Resolve / Close / Reopen have their own actions). */
  canStart(c: Complaint): boolean {
    return c.status === 'Open' || c.status === 'Reopened';
  }

  // ---- Actions ----------------------------------------------------------------

  /** Logged by an admin on a resident's behalf (residents normally use the Resident App). */
  create(input: NewComplaintInput): Complaint {
    const r = this.residents.byId(input.residentId);
    if (!r) throw new Error('Resident not found.');
    if (!input.title.trim()) throw new Error('Title is required.');
    if (input.targetDate && input.targetDate < todayIso()) throw new Error('Target resolution date cannot be in the past.');

    const now = nowIso();
    const alloc = this.residents.allocationFor(r.residentId);
    const history: ComplaintEvent[] = [this.event('created', `Logged by ${this.userName} on behalf of the resident.`, now)];
    if (input.assignedTo) history.unshift(this.event('assigned', `Assigned to ${staffLabel(input.assignedTo)}.`, now));

    const complaint: Complaint = {
      id: this.nextId(),
      residentId: r.residentId,
      residentName: residentFullName(r),
      location: alloc ? this.residents.describe(alloc) : undefined,
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      attachments: input.attachments,
      priority: input.priority,
      assignedTo: input.assignedTo,
      createdAt: now,
      targetDate: input.targetDate || undefined,
      status: 'Open',
      source: 'Admin',
      reopenCount: 0,
      updatedAt: now,
      history,
    };
    this.commit([complaint, ...this.complaints]);
    this.auditLog.record('Create Complaint', this.entity(complaint), { details: `${complaint.category} · ${complaint.priority} · ${complaint.title}` });
    if (input.assignedTo) this.auditLog.record('Assign Complaint', this.entity(complaint), { details: `Assigned to ${staffLabel(input.assignedTo)}.` });
    return complaint;
  }

  assign(id: string, staffId: string | undefined): Complaint {
    const c = this.require(id);
    this.assertEditable(c);
    if (c.assignedTo === staffId) return c;
    const text = staffId ? `Assigned to ${staffLabel(staffId)}.` : `Unassigned (was ${staffLabel(c.assignedTo)}).`;
    const next = this.patch(c, { assignedTo: staffId }, this.event('assigned', text));
    this.auditLog.record('Assign Complaint', this.entity(c), { details: text });
    return next;
  }

  setPriority(id: string, priority: ComplaintPriority): Complaint {
    const c = this.require(id);
    this.assertEditable(c);
    if (c.priority === priority) return c;
    const text = `Priority changed ${c.priority} → ${priority}.`;
    const next = this.patch(c, { priority }, this.event('priority', text));
    this.auditLog.record('Update Complaint', this.entity(c), { details: text });
    return next;
  }

  setTarget(id: string, targetDate: string | undefined): Complaint {
    const c = this.require(id);
    this.assertEditable(c);
    if (targetDate && targetDate < todayIso()) throw new Error('Target resolution date cannot be in the past.');
    const text = targetDate ? `Target resolution set to ${targetDate}.` : 'Target resolution cleared.';
    const next = this.patch(c, { targetDate: targetDate || undefined }, this.event('status', text));
    this.auditLog.record('Update Complaint', this.entity(c), { details: text });
    return next;
  }

  /** Open / Reopened → In Progress. */
  startWork(id: string): Complaint {
    const c = this.require(id);
    if (!this.canStart(c)) throw new Error(`${c.id} is ${c.status}; it can't be moved to In Progress.`);
    const next = this.patch(c, { status: 'In Progress' }, this.event('status', `Status changed ${c.status} → In Progress.`));
    this.auditLog.record('Update Complaint', this.entity(c), { details: `${c.status} → In Progress` });
    this.notifyTenant(next, `${next.id} is now In Progress.`);
    return next;
  }

  addNote(id: string, text: string, attachments: ComplaintAttachment[] = []): Complaint {
    const c = this.require(id);
    if (!text.trim() && !attachments.length) throw new Error('Write a note or attach a photo.');
    if (c.status === 'Closed') throw new Error('Closed complaints are read-only.');
    const next = this.patch(c, {}, this.event('note', text.trim(), undefined, attachments));
    this.auditLog.record('Update Complaint', this.entity(c), { details: `Note added${attachments.length ? ` (${attachments.length} attachment(s))` : ''}.` });
    // Internal notes ("[Internal] ...") are never announced to the Tenant.
    if (!INTERNAL_NOTE.test(text)) this.notifyTenant(next, `There is a new update on ${next.id}.`);
    return next;
  }

  /** Marks Resolved with a resolution note; the resident is notified. */
  resolve(id: string, note: string): Complaint {
    if (!this.canResolve) throw new Error("You don't have permission to resolve complaints.");
    const c = this.require(id);
    if (!isActive(c)) throw new Error(`${c.id} is already ${c.status}.`);
    if (note.trim().length < 5) throw new Error('Enter a resolution note (at least 5 characters).');

    const now = nowIso();
    const resolved = this.event('resolved', note.trim(), now);
    const notified = this.event('notified', 'Resident notified in the Resident App and by SMS.', now);
    const next = this.patch(c, { status: 'Resolved', resolvedAt: now, resolutionNote: note.trim() }, notified, resolved);
    this.auditLog.record('Resolve Complaint', this.entity(c), { details: note.trim() });
    this.notifyTenant(next, `${next.id} was marked Resolved. Please confirm or reopen it.`);
    return next;
  }

  /** Resolved → Closed (final; stays searchable). */
  close(id: string): Complaint {
    if (!this.canResolve) throw new Error("You don't have permission to close complaints.");
    const c = this.require(id);
    if (c.status !== 'Resolved') throw new Error('Only resolved complaints can be closed.');
    const now = nowIso();
    const next = this.patch(c, { status: 'Closed', closedAt: now }, this.event('status', 'Status changed Resolved → Closed.', now));
    this.auditLog.record('Close Complaint', this.entity(c));
    this.notifyTenant(next, `${next.id} is now Closed.`);
    return next;
  }

  /** Resolved → Reopened, within the policy window. */
  reopen(id: string, reason: string): Complaint {
    if (!this.canResolve) throw new Error("You don't have permission to reopen complaints.");
    const c = this.require(id);
    if (!this.canReopen(c)) {
      throw new Error(c.status === 'Resolved' ? `Reopening is only allowed within ${REOPEN_WINDOW_DAYS} days of resolution.` : 'Only resolved complaints can be reopened.');
    }
    if (reason.trim().length < 5) throw new Error('Give a reason for reopening (at least 5 characters).');
    const now = nowIso();
    const next = this.patch(
      c,
      { status: 'Reopened', reopenCount: c.reopenCount + 1, resolvedAt: undefined, resolutionNote: undefined },
      this.event('notified', 'Resident notified that the complaint was reopened.', now),
      this.event('status', `Reopened: ${reason.trim()}`, now),
    );
    this.auditLog.record('Reopen Complaint', this.entity(c), { details: reason.trim() });
    this.notifyTenant(next, `${next.id} was reopened.`);
    return next;
  }

  // ---- Tenant (Resident App) paths -----------------------------------------------
  // Separate from the owner actions above so their permission checks stay as they are. Each takes the
  // signed-in Tenant's resident id (from TenantContextService, never from a form) and refuses any
  // complaint that belongs to someone else. Tenants cannot resolve, close or edit Admin updates.

  /** A Tenant raising a complaint for themselves. Priority is only their suggestion; Admin sets the final one. */
  createForTenant(residentId: string, input: Omit<NewComplaintInput, 'residentId' | 'assignedTo' | 'targetDate'> & { location: string }): Complaint {
    const r = this.residents.byId(residentId);
    if (!r) throw new Error('Resident not found.');
    if (!input.title.trim()) throw new Error('Title is required.');
    const now = nowIso();
    const complaint: Complaint = {
      id: this.nextId(),
      residentId: r.residentId,
      residentName: residentFullName(r),
      location: input.location.trim(),
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      attachments: input.attachments,
      priority: input.priority,
      createdAt: now,
      status: 'Open',
      source: 'Resident App',
      reopenCount: 0,
      updatedAt: now,
      history: [{ at: now, type: 'created', by: TENANT_AUTHOR, text: `Submitted from the Resident App. Suggested priority: ${input.priority}.` }],
    };
    this.commit([complaint, ...this.complaints]);
    this.auditLog.record('Create Complaint', this.entity(complaint), { details: `${complaint.category} · ${complaint.priority} · ${complaint.title}` });
    return complaint;
  }

  /** Adds the Tenant's follow-up comment (not allowed once Closed). */
  tenantComment(residentId: string, id: string, text: string): Complaint {
    const c = this.requireOwned(residentId, id);
    if (c.status === 'Closed') throw new Error('Closed complaints are read-only.');
    if (!text.trim()) throw new Error('Write a comment first.');
    if (text.trim().length > 1000) throw new Error('Comments can be up to 1000 characters.');
    return this.patch(c, {}, { at: nowIso(), type: 'note', by: TENANT_AUTHOR, text: text.trim() });
  }

  /** The Tenant agrees a Resolved complaint is fixed. It stays Resolved (only the hostel closes it). */
  tenantConfirmResolved(residentId: string, id: string): Complaint {
    const c = this.requireOwned(residentId, id);
    if (c.status !== 'Resolved') throw new Error('Only a resolved complaint can be confirmed.');
    if (c.history.some((e) => e.by === TENANT_AUTHOR && e.text === CONFIRMED_TEXT && e.at >= (c.resolvedAt ?? ''))) {
      throw new Error('You have already confirmed this resolution.');
    }
    return this.patch(c, {}, { at: nowIso(), type: 'status', by: TENANT_AUTHOR, text: CONFIRMED_TEXT });
  }

  /** Resolved -> Reopened by its own Tenant, inside the reopen window. */
  tenantReopen(residentId: string, id: string, reason: string): Complaint {
    const c = this.requireOwned(residentId, id);
    if (!this.canReopen(c)) {
      throw new Error(c.status === 'Resolved' ? `Reopening is only allowed within ${REOPEN_WINDOW_DAYS} days of resolution. Please raise a new complaint.` : 'Only resolved complaints can be reopened.');
    }
    if (reason.trim().length < 10) throw new Error('Give a reason for reopening (at least 10 characters).');
    if (reason.trim().length > 1000) throw new Error('The reason can be up to 1000 characters.');
    const next = this.patch(
      c,
      { status: 'Reopened', reopenCount: c.reopenCount + 1, resolvedAt: undefined, resolutionNote: undefined },
      { at: nowIso(), type: 'status', by: TENANT_AUTHOR, text: `Reopened: ${reason.trim()}` },
    );
    this.auditLog.record('Reopen Complaint', this.entity(c), { details: reason.trim() });
    return next;
  }

  /** Demo data: adds the given complaints (new ids) unless the same resident already has one with that title. */
  seedIfMissing(rows: Complaint[]): void {
    const fresh = rows.filter((r) => !this.complaints.some((c) => c.residentId === r.residentId && c.title === r.title));
    if (!fresh.length) return;
    let list = this.complaints;
    for (const r of fresh) {
      const max = list.reduce((m, c) => Math.max(m, Number(c.id.slice(3)) || 0), 0);
      list = [{ ...r, id: `CMP${String(max + 1).padStart(6, '0')}` }, ...list];
    }
    this.commit(list);
  }

  // ---------------------------------------------------------------------------

  private get userName(): string {
    return this.auth.currentUser?.name ?? 'Hostel Owner';
  }

  private event(type: ComplaintEventType, text: string, at = nowIso(), attachments?: ComplaintAttachment[]): ComplaintEvent {
    return { at, type, by: this.userName, text, attachments: attachments?.length ? attachments : undefined };
  }

  private assertEditable(c: Complaint): void {
    if (!isActive(c)) throw new Error(`${c.id} is ${c.status}. Reopen it to make changes.`);
  }

  /** Applies changes and prepends events (given newest first). */
  private patch(c: Complaint, changes: Partial<Complaint>, ...events: ComplaintEvent[]): Complaint {
    const next: Complaint = { ...c, ...changes, updatedAt: nowIso(), history: [...events, ...c.history] };
    this.commit(this.complaints.map((x) => (x.id === c.id ? next : x)));
    return next;
  }

  /** The complaint, only if it belongs to `residentId`; anything else reads as "not found". */
  private requireOwned(residentId: string, id: string): Complaint {
    const c = this.byId(id);
    if (!residentId || !c || c.residentId !== residentId) throw new Error('Complaint not found.');
    return c;
  }

  /** In-app notification for the complaint's Tenant; never blocks the owner action. */
  private notifyTenant(c: Complaint, body: string): void {
    try {
      this.tenantNotes.push(c.residentId, { category: 'Complaint', title: 'Complaint update', body, route: '/my/complaints' });
    } catch {
      // notification text rules or storage; the status change itself already succeeded
    }
  }

  private require(id: string): Complaint {
    const c = this.byId(id);
    if (!c) throw new Error('Complaint not found.');
    return c;
  }

  private entity(c: Complaint): string {
    return `${c.id} · ${c.residentName}`;
  }

  private nextId(): string {
    const max = this.complaints.reduce((m, c) => Math.max(m, Number(c.id.slice(3)) || 0), 0);
    return `CMP${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Complaint[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // storage quota (large photos)
    }
  }

  private load(): Complaint[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored) as Complaint[];
    } catch {
      // fall back to seed
    }
    return SEED_COMPLAINTS;
  }
}

// ---------------------------------------------------------------------------
// Seed data (residents and rooms from the Residents / Rooms seeds)
// ---------------------------------------------------------------------------

const ev = (at: string, type: ComplaintEventType, by: string, text: string): ComplaintEvent => ({ at, type, by, text });
const RESIDENT = 'Resident App';
const OWNER = 'Hostel Owner';

const base = (c: Partial<Complaint> & Pick<Complaint, 'id' | 'residentId' | 'residentName' | 'category' | 'title' | 'description' | 'priority' | 'createdAt' | 'status' | 'history'>): Complaint => ({
  attachments: [],
  source: 'Resident App',
  reopenCount: 0,
  updatedAt: c.history[0]?.at ?? c.createdAt,
  ...c,
});

const SEED_COMPLAINTS: Complaint[] = [
  base({
    id: 'CMP000009', residentId: 'RES000006', residentName: 'Sagar Gupta', location: 'Room 203 · Bed B1',
    category: 'Electrical', title: 'Sparking from switchboard near bed',
    description: 'The switchboard next to bed B1 sparks when the fan is switched on. Burning smell this morning.',
    priority: 'Urgent', createdAt: '2026-10-19T08:10:00', targetDate: '2026-10-19', status: 'Open',
    history: [ev('2026-10-19T08:10:00', 'created', RESIDENT, 'Submitted from the Resident App.')],
  }),
  base({
    id: 'CMP000007', residentId: 'RES000002', residentName: 'Aman Verma', location: 'Room 101 · Bed B2',
    category: 'Wi-Fi', title: 'Wi-Fi drops every evening',
    description: 'Connection keeps dropping between 8 and 11 PM. Speed test shows under 1 Mbps.',
    priority: 'Medium', assignedTo: 'STF04', createdAt: '2026-10-17T21:30:00', targetDate: '2026-10-20', status: 'In Progress',
    history: [
      ev('2026-10-18T11:00:00', 'note', 'Arjun Rao', 'Router on 1st floor overheating. Replacement ordered, temporary repeater installed.'),
      ev('2026-10-18T10:05:00', 'status', OWNER, 'Status changed Open → In Progress.'),
      ev('2026-10-18T09:40:00', 'assigned', OWNER, 'Assigned to Arjun Rao (IT / Wi-Fi).'),
      ev('2026-10-17T21:30:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000005', residentId: 'RES000003', residentName: 'Vivek Singh', location: 'Room 201 · Bed B1',
    category: 'Plumbing', title: 'Bathroom tap leaking',
    description: 'The washbasin tap in the attached bathroom leaks continuously.',
    priority: 'High', assignedTo: 'STF01', createdAt: '2026-10-14T07:45:00', targetDate: '2026-10-16', status: 'In Progress',
    history: [
      ev('2026-10-15T16:20:00', 'note', 'Ravi Kumar', 'Washer replaced, still dripping. Needs a new cartridge — waiting for part.'),
      ev('2026-10-14T12:00:00', 'status', OWNER, 'Status changed Open → In Progress.'),
      ev('2026-10-14T09:15:00', 'assigned', OWNER, 'Assigned to Ravi Kumar (Plumber).'),
      ev('2026-10-14T07:45:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000006', residentId: 'RES000005', residentName: 'Sahil Khan', location: 'Room 201 · Bed B3',
    category: 'Furniture', title: 'Study chair broken',
    description: 'One leg of the study chair is cracked; unsafe to sit on.',
    priority: 'Low', createdAt: '2026-10-16T19:00:00', status: 'Open',
    history: [ev('2026-10-16T19:00:00', 'created', RESIDENT, 'Submitted from the Resident App.')],
  }),
  base({
    id: 'CMP000004', residentId: 'RES000007', residentName: 'Mohit Yadav', location: 'Room 203 · Bed B2',
    category: 'Cleaning', title: 'Corridor not cleaned for 2 days',
    description: '2nd floor corridor near Room 203 has not been swept since Thursday.',
    priority: 'Medium', assignedTo: 'STF03', createdAt: '2026-10-12T09:00:00', targetDate: '2026-10-13', status: 'Resolved',
    resolvedAt: '2026-10-13T11:30:00', resolutionNote: 'Corridor cleaned; housekeeping roster updated to cover the 2nd floor daily.',
    history: [
      ev('2026-10-13T11:30:00', 'notified', OWNER, 'Resident notified in the Resident App and by SMS.'),
      ev('2026-10-13T11:30:00', 'resolved', OWNER, 'Corridor cleaned; housekeeping roster updated to cover the 2nd floor daily.'),
      ev('2026-10-12T10:00:00', 'status', OWNER, 'Status changed Open → In Progress.'),
      ev('2026-10-12T09:20:00', 'assigned', OWNER, 'Assigned to Lakshmi Devi (Housekeeping).'),
      ev('2026-10-12T09:00:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000003', residentId: 'RES000001', residentName: 'Rahul Sharma', location: 'Room 101 · Bed B1',
    category: 'Electrical', title: 'Tube light flickering',
    description: 'Tube light above bed B1 flickers constantly.',
    priority: 'Low', assignedTo: 'STF02', createdAt: '2026-10-08T20:15:00', status: 'Resolved', reopenCount: 1,
    resolvedAt: '2026-10-16T15:00:00', resolutionNote: 'Choke replaced along with the tube; tested for 30 minutes.',
    history: [
      ev('2026-10-16T15:00:00', 'notified', OWNER, 'Resident notified in the Resident App and by SMS.'),
      ev('2026-10-16T15:00:00', 'resolved', OWNER, 'Choke replaced along with the tube; tested for 30 minutes.'),
      ev('2026-10-12T08:30:00', 'status', RESIDENT, 'Reopened: Still flickering after the tube change.'),
      ev('2026-10-09T17:00:00', 'resolved', OWNER, 'Tube replaced.'),
      ev('2026-10-09T10:00:00', 'assigned', OWNER, 'Assigned to Suresh Babu (Electrician).'),
      ev('2026-10-08T20:15:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000002', residentId: 'RES000004', residentName: 'Rohit Patel', location: 'Room 201 · Bed B2',
    category: 'Plumbing', title: 'No hot water in the morning',
    description: 'Geyser in Room 201 bathroom does not heat water before 8 AM.',
    priority: 'High', assignedTo: 'STF02', createdAt: '2026-09-28T07:10:00', targetDate: '2026-09-30', status: 'Closed',
    resolvedAt: '2026-09-29T18:00:00', resolutionNote: 'Geyser thermostat replaced. Timer set to 5:30 AM.', closedAt: '2026-10-05T10:00:00',
    history: [
      ev('2026-10-05T10:00:00', 'status', OWNER, 'Status changed Resolved → Closed.'),
      ev('2026-09-29T18:00:00', 'notified', OWNER, 'Resident notified in the Resident App and by SMS.'),
      ev('2026-09-29T18:00:00', 'resolved', OWNER, 'Geyser thermostat replaced. Timer set to 5:30 AM.'),
      ev('2026-09-28T09:00:00', 'assigned', OWNER, 'Assigned to Suresh Babu (Electrician).'),
      ev('2026-09-28T07:10:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000001', residentId: 'RES000002', residentName: 'Aman Verma', location: 'Room 101 · Bed B2',
    category: 'Other', title: 'Noise from construction next door',
    description: 'Construction work starts at 6 AM next to the hostel; very noisy.',
    priority: 'Low', assignedTo: 'STF06', createdAt: '2026-09-20T07:30:00', status: 'Closed',
    resolvedAt: '2026-09-22T12:00:00', resolutionNote: 'Spoke with the site supervisor; work now starts at 8 AM.', closedAt: '2026-09-30T09:00:00',
    history: [
      ev('2026-09-30T09:00:00', 'status', OWNER, 'Status changed Resolved → Closed.'),
      ev('2026-09-22T12:00:00', 'resolved', OWNER, 'Spoke with the site supervisor; work now starts at 8 AM.'),
      ev('2026-09-20T09:00:00', 'assigned', OWNER, 'Assigned to Prakash Reddy (Warden).'),
      ev('2026-09-20T07:30:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
  base({
    id: 'CMP000008', residentId: 'RES000006', residentName: 'Sagar Gupta', location: 'Room 203 · Bed B1',
    category: 'Wi-Fi', title: 'Cannot connect new laptop',
    description: 'New laptop is not getting an IP address on the hostel Wi-Fi.',
    priority: 'Medium', createdAt: '2026-10-18T22:40:00', targetDate: '2026-10-21', status: 'Reopened', reopenCount: 1,
    history: [
      ev('2026-10-19T07:50:00', 'status', RESIDENT, 'Reopened: Works on phone but laptop still fails.'),
      ev('2026-10-19T07:00:00', 'resolved', OWNER, 'MAC address added to the allow-list.'),
      ev('2026-10-18T22:40:00', 'created', RESIDENT, 'Submitted from the Resident App.'),
    ],
  }),
];
