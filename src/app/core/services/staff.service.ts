import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import {
  STAFF_CATEGORIES,
  STAFF_STATUSES,
  TASK_PRIORITIES,
  TASK_TRANSITIONS,
  Staff,
  StaffErrors,
  StaffEvent,
  StaffInput,
  StaffShift,
  StaffStatus,
  Task,
  TaskErrors,
  TaskInput,
  TaskStats,
  TaskStatus,
} from '../models/staff.models';
import { AuditEvent, diffForAudit } from '../models/audit.models';
import { localDateIso } from '../../shared/utils/local-date';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';

const STORAGE_KEY = 'onehostel_staff_v1';
export const STAFF_HOSTEL_ID = 'HST-OWNER-01';

const MOBILE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface StaffState {
  staff: Staff[];
  tasks: Task[];
}

const STAFF_LABELS: Record<string, string> = {
  name: 'Name',
  mobile: 'Mobile',
  email: 'Email',
  category: 'Category',
  duties: 'Duties',
  shift: 'Shift',
  employmentStart: 'Employment start',
  employmentEnd: 'Employment end',
  status: 'Status',
  loginAccess: 'Login access',
  roleTemplate: 'Role template',
};

const TASK_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  dueDate: 'Due date',
  priority: 'Priority',
  assigneeId: 'Assignee',
  status: 'Status',
};

const nowIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDateIso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** Local date `n` days from today. */
const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateIso(d);
};

const shiftText = (s?: StaffShift): string => (s ? `${s.name} ${s.start}–${s.end}` : '');

/** Shift as stored: all-blank = no shift; a name defaults to "Custom". */
function normaliseShift(s?: StaffInput['shift']): StaffShift | undefined {
  const start = s?.start?.trim() ?? '';
  const end = s?.end?.trim() ?? '';
  if (!start && !end && !s?.name?.trim()) return undefined;
  return { name: s?.name?.trim() || 'Custom', start, end };
}

const ev = (at: string, by: string, action: string, note?: string): StaffEvent => ({ at, by, action, note });

function seed(): StaffState {
  const by = 'Hostel Owner';
  const created = (at: string) => [ev(at, by, 'Staff added')];
  const s = (x: Omit<Staff, 'hostelId' | 'history'> & { history?: StaffEvent[] }): Staff => ({
    hostelId: STAFF_HOSTEL_ID, history: created(`${x.employmentStart}T09:00:00`), ...x,
  });
  const staff: Staff[] = [
    s({
      id: 'STF000001', name: 'Ramesh Kumar', mobile: '9876501234', email: 'ramesh.kumar@example.com', category: 'Security',
      duties: ['Gate duty', 'Visitor log', 'Night patrol'], shift: { name: 'Evening', start: '14:00', end: '22:00' },
      employmentStart: '2023-06-01', status: 'Active', loginAccess: true, roleTemplate: 'Security',
    }),
    s({
      id: 'STF000002', name: 'Lakshmi Devi', mobile: '9876502345', email: 'lakshmi.devi@example.com', category: 'Warden',
      duties: ['Front desk', 'Attendance', 'Resident queries'], shift: { name: 'Day', start: '08:00', end: '17:00' },
      employmentStart: '2022-04-15', status: 'Active', loginAccess: true, roleTemplate: 'Warden',
    }),
    s({
      id: 'STF000003', name: 'Suresh Babu', mobile: '9876503456', category: 'Maintenance',
      duties: ['Plumbing', 'Electrical', 'General repairs'], shift: { name: 'Day', start: '09:00', end: '18:00' },
      employmentStart: '2024-01-10', status: 'Active', loginAccess: true, roleTemplate: 'Maintenance',
    }),
    s({
      id: 'STF000004', name: 'Anita Rao', mobile: '9876504567', email: 'anita.rao@example.com', category: 'Housekeeping',
      duties: ['Room cleaning', 'Common areas'], shift: { name: 'Morning', start: '07:00', end: '15:00' },
      employmentStart: '2023-09-04', status: 'On Leave', loginAccess: false, roleTemplate: 'None',
    }),
    s({
      id: 'STF000005', name: 'Prakash Reddy', mobile: '9876505678', email: 'prakash.reddy@example.com', category: 'Mess',
      duties: ['Cooking', 'Serving meals', 'Kitchen hygiene'], shift: { name: 'Kitchen', start: '05:00', end: '14:00' },
      employmentStart: '2021-11-20', status: 'Active', loginAccess: true, roleTemplate: 'Mess Manager',
    }),
    s({
      id: 'STF000006', name: 'Meena Joshi', mobile: '9876506789', email: 'meena.joshi@example.com', category: 'Other',
      duties: ['Fee collection', 'Record keeping'], shift: { name: 'Office', start: '10:00', end: '18:00' },
      employmentStart: '2024-03-01', status: 'Active', loginAccess: true, roleTemplate: 'Accountant',
    }),
    s({
      id: 'STF000007', name: 'Gopal Naidu', mobile: '9876507890', category: 'Security',
      duties: ['Gate duty'], employmentStart: '2022-08-01', employmentEnd: '2025-12-31', status: 'Inactive', loginAccess: false, roleTemplate: 'None',
      history: [ev('2022-08-01T09:00:00', by, 'Staff added'), ev('2026-01-02T10:00:00', by, 'Deactivated', 'Contract ended')],
    }),
  ];

  const t = (id: string, title: string, assigneeId: string, dueDate: string, priority: Task['priority'], status: TaskStatus, description?: string): Task => ({
    id, hostelId: STAFF_HOSTEL_ID, title, description, dueDate, priority, assigneeId, status,
    createdAt: `${inDays(-6)}T10:00:00`, createdBy: by, updatedAt: `${inDays(-2)}T10:00:00`,
    history: [ev(`${inDays(-6)}T10:00:00`, by, 'Task created')],
  });
  const tasks: Task[] = [
    t('TSK000001', 'Fix leaking tap in Room 204 bathroom', 'STF000003', inDays(-1), 'High', 'In Progress', 'Reported by the resident; washer needs replacing.'),
    t('TSK000002', 'Replace corridor tube lights, 2nd floor', 'STF000003', inDays(2), 'Medium', 'Open'),
    t('TSK000003', 'Update visitor register and night patrol log', 'STF000001', inDays(0), 'Medium', 'Open'),
    t('TSK000004', 'Deep clean the common bathrooms', 'STF000004', inDays(3), 'Low', 'Open', 'Assigned before leave began; to be reassigned if needed.'),
    t('TSK000005', 'Stock check: rice, dal and cooking oil', 'STF000005', inDays(1), 'High', 'Open'),
    t('TSK000006', 'Reconcile this week\'s fee receipts', 'STF000006', inDays(-3), 'Urgent', 'Open', 'Missed the due date; follow up.'),
    t('TSK000007', 'Repaint the entrance gate', 'STF000003', inDays(-5), 'Low', 'Done'),
    t('TSK000008', 'Lock-up check on all floors', 'STF000007', inDays(-60), 'Medium', 'Cancelled'),
  ];
  return { staff, tasks };
}

/**
 * Staff, their duties and their tasks (FRD 6.1). Deactivating staff keeps their tasks and history;
 * deactivated staff cannot be given new tasks. Every create / update is audited with old and new values.
 * UI-only build: kept in memory and persisted to localStorage.
 */
@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly audit = inject(AuditLogService);
  private readonly auth = inject(AuthService);

  private readonly subject = new BehaviorSubject<StaffState>(this.load());
  readonly staff$: Observable<Staff[]> = this.subject.pipe(map((s) => s.staff));
  readonly tasks$: Observable<Task[]> = this.subject.pipe(map((s) => s.tasks));

  /** Open / in progress / done / overdue counts (for Analytics). */
  readonly taskStats$: Observable<TaskStats> = this.tasks$.pipe(map((list) => this.statsOf(list)));

  get staff(): Staff[] { return this.subject.value.staff; }
  get tasks(): Task[] { return this.subject.value.tasks; }

  /** Staff who can be given new tasks. */
  get activeStaff(): Staff[] { return this.staff.filter((s) => s.status === 'Active'); }

  byId(id: string): Staff | undefined { return this.staff.find((s) => s.id === id); }
  taskById(id: string): Task | undefined { return this.tasks.find((t) => t.id === id); }

  tasksFor(staffId: string): Task[] { return this.tasks.filter((t) => t.assigneeId === staffId); }
  /** Tasks not yet finished or cancelled. */
  openTasksFor(staffId: string): Task[] { return this.tasksFor(staffId).filter((t) => this.isPending(t)); }

  isPending(t: Task): boolean { return t.status === 'Open' || t.status === 'In Progress'; }

  /** Overdue = still pending and due before the hostel-local today. */
  isOverdue(t: Task): boolean { return this.isPending(t) && t.dueDate < localDateIso(); }

  /** Pending task whose assignee has since been deactivated. */
  isOrphaned(t: Task): boolean { return this.isPending(t) && this.byId(t.assigneeId)?.status === 'Inactive'; }

  allowedTransitions(status: TaskStatus): TaskStatus[] { return TASK_TRANSITIONS[status] ?? []; }

  statsOf(list: Task[]): TaskStats {
    return {
      open: list.filter((t) => t.status === 'Open').length,
      inProgress: list.filter((t) => t.status === 'In Progress').length,
      done: list.filter((t) => t.status === 'Done').length,
      overdue: list.filter((t) => this.isOverdue(t)).length,
    };
  }

  // ---- Staff ----------------------------------------------------------------------

  /** Field errors for a staff form (empty object = valid). `excludeId` = the staff member being edited. */
  validateStaff(input: StaffInput, excludeId?: string): StaffErrors {
    const e: StaffErrors = {};
    const name = (input.name ?? '').trim();
    const mobile = (input.mobile ?? '').trim();
    const email = (input.email ?? '').trim().toLowerCase();
    const others = this.staff.filter((s) => s.id !== excludeId);

    if (!name) e.name = 'Name is required.';
    else if (name.length > 80) e.name = 'Name must be 80 characters or fewer.';

    if (!mobile) e.mobile = 'Mobile number is required.';
    else if (!MOBILE_RE.test(mobile)) e.mobile = 'Enter a valid 10-digit mobile number (digits only).';
    else if (others.some((s) => s.mobile === mobile)) e.mobile = 'This mobile number belongs to another staff member.';

    if (email) {
      if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email address.';
      else if (others.some((s) => s.email?.toLowerCase() === email)) e.email = 'This email belongs to another staff member.';
    }

    if (!(STAFF_CATEGORIES as readonly string[]).includes(input.category)) e.category = 'Choose a category.';
    if (!input.duties?.some((d) => d.trim())) e.duties = 'Assign at least one duty.';

    const shift = normaliseShift(input.shift);
    if (shift) {
      if (!TIME_RE.test(shift.start) || !TIME_RE.test(shift.end)) e.shift = 'Enter both a start and an end time.';
      else if (shift.end <= shift.start) e.shift = 'Shift end must be after the start.';
    }

    if (!input.employmentStart) e.employmentStart = 'Employment start date is required.';
    if (input.employmentEnd && input.employmentStart && input.employmentEnd < input.employmentStart) {
      e.employmentEnd = 'End date must be on or after the start date.';
    }

    if (input.roleTemplate === 'Accountant' && input.category === 'Maintenance') {
      e.roleTemplate = 'Maintenance staff cannot be given financial access.';
    }
    return e;
  }

  createStaff(input: StaffInput): Staff {
    this.raise(this.validateStaff(input));
    const now = nowIso();
    const by = this.userName;
    const staff: Staff = {
      id: this.nextStaffId(),
      hostelId: STAFF_HOSTEL_ID,
      ...this.fromInput(input),
      status: input.status ?? 'Active',
      history: [ev(now, by, 'Staff added')],
    };
    this.commit({ ...this.subject.value, staff: [staff, ...this.staff] });
    this.audit.record('Create Staff', `${staff.name} (${staff.id})`, {
      details: `${staff.category} · ${staff.duties.join(', ')}`,
    });
    return staff;
  }

  updateStaff(id: string, input: StaffInput): Staff {
    const cur = this.requireStaff(id);
    this.raise(this.validateStaff(input, id));
    const fields = this.fromInput(input);
    const next: Staff = {
      ...cur,
      ...fields,
      status: input.status ?? cur.status,
      history: [...cur.history, ev(nowIso(), this.userName, 'Details updated')],
    };
    const changes = diffForAudit(this.flat(cur), this.flat(next), STAFF_LABELS);
    if (!changes.length) return cur;
    this.replaceStaff(next);
    this.audit.record('Update Staff', `${next.name} (${next.id})`, { changes });
    return next;
  }

  /** Open tasks that would stay behind if this person were deactivated. */
  deactivationImpact(id: string): Task[] { return this.openTasksFor(id); }

  /**
   * Activate / Deactivate / put on leave. Tasks and history are kept; the staff member simply stops
   * being offered for new tasks. Returns the updated staff.
   */
  setStatus(id: string, status: StaffStatus, note?: string): Staff {
    const cur = this.requireStaff(id);
    if (!(STAFF_STATUSES as readonly string[]).includes(status)) throw new Error('Invalid status.');
    if (cur.status === status) throw new Error(`${cur.name} is already ${status}.`);
    const next: Staff = {
      ...cur,
      status,
      history: [...cur.history, ev(nowIso(), this.userName, status === 'Active' ? 'Activated' : status === 'Inactive' ? 'Deactivated' : 'Marked On Leave', note)],
    };
    this.replaceStaff(next);
    const event: AuditEvent = status === 'Active' ? 'Activate Staff' : status === 'Inactive' ? 'Deactivate Staff' : 'Update Staff';
    this.audit.record(event, `${next.name} (${next.id})`, {
      changes: [{ field: 'Status', oldValue: cur.status, newValue: status }],
      details: status === 'Inactive' ? `${this.openTasksFor(id).length} open task(s) kept` : undefined,
    });
    return next;
  }

  // ---- Tasks ----------------------------------------------------------------------

  validateTask(input: TaskInput, existing?: Task): TaskErrors {
    const e: TaskErrors = {};
    const title = (input.title ?? '').trim();
    if (!title) e.title = 'Title is required.';
    else if (title.length > 120) e.title = 'Title must be 120 characters or fewer.';

    if (!input.dueDate) e.dueDate = 'Due date is required.';
    else if (!existing || existing.dueDate !== input.dueDate) {
      // Past dates are only refused when the date is new or changed.
      if (input.dueDate < localDateIso()) e.dueDate = 'Due date cannot be in the past.';
    }

    const assignee = this.byId(input.assigneeId);
    if (!assignee) e.assigneeId = 'Choose who the task is for.';
    else if (assignee.status !== 'Active' && assignee.id !== existing?.assigneeId) {
      e.assigneeId = `${assignee.name} is ${assignee.status} and cannot be given new tasks.`;
    }
    if (!(TASK_PRIORITIES as readonly string[]).includes(input.priority)) e.title = e.title ?? 'Choose a priority.';
    return e;
  }

  createTask(input: TaskInput): Task {
    this.raise(this.validateTask(input));
    const now = nowIso();
    const by = this.userName;
    const task: Task = {
      id: this.nextTaskId(),
      hostelId: STAFF_HOSTEL_ID,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      dueDate: input.dueDate,
      priority: input.priority,
      assigneeId: input.assigneeId,
      status: 'Open',
      createdAt: now,
      createdBy: by,
      updatedAt: now,
      history: [ev(now, by, 'Task created', `Assigned to ${this.byId(input.assigneeId)?.name}`)],
    };
    this.commit({ ...this.subject.value, tasks: [task, ...this.tasks] });
    this.audit.record('Create Task', `${task.title} (${task.id})`, {
      details: `Assigned to ${this.byId(task.assigneeId)?.name} · due ${task.dueDate} · ${task.priority}`,
    });
    return task;
  }

  /** Edits a task that is still Open / In Progress. Finished or cancelled tasks are read-only. */
  updateTask(id: string, input: TaskInput): Task {
    const cur = this.requireTask(id);
    if (!this.isPending(cur)) throw new Error(`A ${cur.status.toLowerCase()} task can't be edited.`);
    this.raise(this.validateTask(input, cur));
    const next: Task = {
      ...cur,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      dueDate: input.dueDate,
      priority: input.priority,
      assigneeId: input.assigneeId,
      updatedAt: nowIso(),
      history: [...cur.history, ev(nowIso(), this.userName, 'Task updated')],
    };
    const label = (t: Task) => ({ ...t, assigneeId: this.byId(t.assigneeId)?.name ?? t.assigneeId });
    const changes = diffForAudit(label(cur) as unknown as Record<string, unknown>, label(next) as unknown as Record<string, unknown>, TASK_LABELS);
    if (!changes.length) return cur;
    this.replaceTask(next);
    this.audit.record('Update Task', `${next.title} (${next.id})`, { changes });
    return next;
  }

  /** Moves a task forward (Open to In Progress / Done / Cancelled, In Progress to Done / Cancelled). */
  setTaskStatus(id: string, status: TaskStatus): Task {
    const cur = this.requireTask(id);
    if (!this.allowedTransitions(cur.status).includes(status)) {
      throw new Error(`A ${cur.status.toLowerCase()} task can't move to ${status.toLowerCase()}.`);
    }
    const now = nowIso();
    const next: Task = { ...cur, status, updatedAt: now, history: [...cur.history, ev(now, this.userName, `Status: ${cur.status} → ${status}`)] };
    this.replaceTask(next);
    this.audit.record('Update Task', `${next.title} (${next.id})`, { changes: [{ field: 'Status', oldValue: cur.status, newValue: status }] });
    return next;
  }

  // ---------------------------------------------------------------------------

  private fromInput(input: StaffInput) {
    return {
      name: input.name.trim(),
      mobile: input.mobile.trim(),
      email: input.email?.trim() || undefined,
      category: input.category,
      duties: [...new Set(input.duties.map((d) => d.trim()).filter(Boolean))],
      shift: normaliseShift(input.shift),
      employmentStart: input.employmentStart,
      employmentEnd: input.employmentEnd || undefined,
      loginAccess: !!input.loginAccess,
      roleTemplate: input.roleTemplate,
    };
  }

  /** Staff as comparable audit values (duties and shift as text). */
  private flat(s: Staff): Record<string, unknown> {
    return { ...s, duties: s.duties.join(', '), shift: shiftText(s.shift) };
  }

  private raise(errors: object): void {
    const first = Object.values(errors)[0] as string | undefined;
    if (first) throw new Error(first);
  }

  private requireStaff(id: string): Staff {
    const s = this.byId(id);
    if (!s) throw new Error('Staff member not found.');
    return s;
  }

  private requireTask(id: string): Task {
    const t = this.taskById(id);
    if (!t) throw new Error('Task not found.');
    return t;
  }

  private replaceStaff(next: Staff): void {
    this.commit({ ...this.subject.value, staff: this.staff.map((s) => (s.id === next.id ? next : s)) });
  }

  private replaceTask(next: Task): void {
    this.commit({ ...this.subject.value, tasks: this.tasks.map((t) => (t.id === next.id ? next : t)) });
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextStaffId(): string {
    const max = this.staff.reduce((m, s) => Math.max(m, Number(s.id.slice(3)) || 0), 0);
    return `STF${String(max + 1).padStart(6, '0')}`;
  }

  private nextTaskId(): string {
    const max = this.tasks.reduce((m, t) => Math.max(m, Number(t.id.slice(3)) || 0), 0);
    return `TSK${String(max + 1).padStart(6, '0')}`;
  }

  private commit(next: StaffState): void {
    this.subject.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): StaffState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<StaffState>;
        if (Array.isArray(s.staff) && Array.isArray(s.tasks)) return { staff: s.staff, tasks: s.tasks };
      }
    } catch {
      // Fall through to the seed data.
    }
    const fresh = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
    return fresh;
  }
}
