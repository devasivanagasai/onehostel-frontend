import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident } from '../residents/residents.models';
import {
  NotificationStatus,
  OVERDUE_DAYS,
  Parcel,
  ParcelCollector,
  ParcelEvent,
  ParcelInput,
  ParcelNotice,
  REMINDER_GAP_HOURS,
  localIso,
} from './parcels.models';

// Audit: AUDIT_EVENTS (core/models/audit.models.ts) has no parcel events, so nothing is recorded there.
// Each parcel keeps its own history and notification log instead.
// Notifications are mocked: nothing leaves the app, the outcome is recorded on the parcel.

const STORAGE_KEY = 'onehostel_parcels_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

const DAY = 86_400_000;

export interface ParcelStats {
  awaiting: number;
  collectedToday: number;
  overdue: number;
  returned: number;
}

export interface BulkReminderResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** `minutes` ago (negative = from now). */
const ago = (minutes: number): string => localIso(new Date(Date.now() - minutes * 60_000));
const H = 60;

const ev = (at: string, by: string, action: string, icon: string, note?: string): ParcelEvent => ({ at, by, action, icon, note });

/** Stable 0..1 value per key, so mock read times don't change between renders. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Seed data relative to now: fresh arrivals, overdue parcels, pickups by others and a return. */
function seed(): Parcel[] {
  const guard = 'Ramesh (Security)';
  const desk = 'Lakshmi (Front Desk)';
  const owner = 'Hostel Owner';
  const sent = (minsAgo: number, readAfter?: number, kind: ParcelNotice['kind'] = 'Arrival'): ParcelNotice => ({
    at: ago(minsAgo), kind, status: 'Sent', channels: 'In-app, SMS, Email', readAt: readAfter === undefined ? undefined : ago(minsAgo - readAfter),
  });
  const p = (x: Omit<Parcel, 'hostelId' | 'reminderCount' | 'notices'> & Partial<Pick<Parcel, 'reminderCount' | 'notices'>>): Parcel => ({
    hostelId: HOSTEL_ID, reminderCount: 0, notices: [], ...x,
  });

  return [
    p({
      id: 'PCL000014', residentId: 'RES000001', courier: 'Amazon', tracking: '402-8817265-1130745', storage: 'Reception shelf A',
      receivedBy: guard, receivedAt: ago(25), status: 'Awaiting Pickup', notices: [sent(24)],
      history: [ev(ago(25), guard, 'Parcel logged', 'inventory_2'), ev(ago(24), 'System', 'Arrival notification sent', 'notifications')],
    }),
    p({
      id: 'PCL000013', residentId: 'RES000003', courier: 'Flipkart', tracking: 'FMPP1928374650', storage: 'Parcel locker L-02',
      receivedBy: desk, receivedAt: ago(3 * H), status: 'Awaiting Pickup', notices: [sent(3 * H - 1, 40)],
      history: [ev(ago(3 * H), desk, 'Parcel logged', 'inventory_2'), ev(ago(3 * H - 1), 'System', 'Arrival notification sent', 'notifications')],
    }),
    p({
      id: 'PCL000012', residentId: 'RES000002', courier: 'Professional Couriers', tracking: 'PC44120987', storage: 'Security cabin',
      receivedBy: guard, receivedAt: ago(7 * H), status: 'Awaiting Pickup',
      history: [ev(ago(7 * H), guard, 'Parcel logged', 'inventory_2', 'Notification turned off — resident was at the desk')],
    }),
    p({
      id: 'PCL000011', residentId: 'RES000005', courier: 'Myntra', tracking: 'MYN7712093', storage: 'Reception shelf B',
      receivedBy: desk, receivedAt: ago(9 * H), status: 'Collected', notices: [sent(9 * H - 1, 15)],
      collectedAt: ago(5 * H), handedOverBy: desk, collector: { self: true, name: 'Sahil Khan' },
      history: [ev(ago(9 * H), desk, 'Parcel logged', 'inventory_2'), ev(ago(9 * H - 1), 'System', 'Arrival notification sent', 'notifications'), ev(ago(5 * H), desk, 'Collected by the resident', 'task_alt')],
    }),
    p({
      id: 'PCL000010', residentId: 'RES000006', courier: 'Blue Dart', tracking: '79215538410', storage: 'Parcel locker L-01',
      receivedBy: guard, receivedAt: ago(28 * H), status: 'Awaiting Pickup', notices: [sent(28 * H - 1, 180)],
      history: [ev(ago(28 * H), guard, 'Parcel logged', 'inventory_2'), ev(ago(28 * H - 1), 'System', 'Arrival notification sent', 'notifications')],
    }),
    p({
      id: 'PCL000009', residentId: 'RES000004', courier: 'Delhivery', tracking: '1491820093381', storage: 'Reception shelf A',
      receivedBy: desk, receivedAt: ago(2 * 24 * H), status: 'Awaiting Pickup',
      notices: [{ at: ago(2 * 24 * H - 1), kind: 'Arrival', status: 'Failed', channels: 'SMS', note: 'SMS gateway timeout — not delivered' }],
      history: [ev(ago(2 * 24 * H), desk, 'Parcel logged', 'inventory_2'), ev(ago(2 * 24 * H - 1), 'System', 'Arrival notification failed', 'error', 'SMS gateway timeout — not delivered')],
    }),
    p({
      id: 'PCL000008', residentId: 'RES000004', courier: 'India Post', tracking: 'EK209384756IN', storage: 'Security cabin',
      receivedBy: guard, receivedAt: ago(4 * 24 * H), status: 'Awaiting Pickup', reminderCount: 1, lastReminderAt: ago(26 * H),
      notices: [sent(4 * 24 * H - 2), sent(26 * H, undefined, 'Reminder')],
      history: [
        ev(ago(4 * 24 * H), guard, 'Parcel logged', 'inventory_2'),
        ev(ago(4 * 24 * H - 2), 'System', 'Arrival notification sent', 'notifications'),
        ev(ago(26 * H), owner, 'Reminder sent', 'notifications_active'),
      ],
    }),
    p({
      id: 'PCL000007', residentId: 'RES000007', courier: 'Amazon', tracking: '171-2283910-5567712', storage: 'Parcel locker L-03',
      receivedBy: desk, receivedAt: ago(5 * 24 * H + 3 * H), status: 'Awaiting Pickup', reminderCount: 2, lastReminderAt: ago(20 * H),
      notices: [sent(5 * 24 * H + 3 * H - 1, 60), sent(2 * 24 * H, 300, 'Reminder'), sent(20 * H, undefined, 'Reminder')],
      history: [
        ev(ago(5 * 24 * H + 3 * H), desk, 'Parcel logged', 'inventory_2'),
        ev(ago(5 * 24 * H + 3 * H - 1), 'System', 'Arrival notification sent', 'notifications'),
        ev(ago(2 * 24 * H), owner, 'Reminder sent', 'notifications_active'),
        ev(ago(20 * H), owner, 'Reminder sent', 'notifications_active'),
      ],
    }),
    p({
      id: 'PCL000006', residentId: 'RES000002', courier: 'DTDC', tracking: 'D78812093', storage: 'Reception shelf B',
      receivedBy: guard, receivedAt: ago(3 * 24 * H), status: 'Collected', notices: [sent(3 * 24 * H - 1, 90)],
      collectedAt: ago(30 * H), handedOverBy: desk,
      collector: { self: false, name: 'Vivek Singh', relation: 'Roommate', idReference: 'RES000003', reason: 'Aman is at college till late; asked his roommate on call.' },
      history: [
        ev(ago(3 * 24 * H), guard, 'Parcel logged', 'inventory_2'),
        ev(ago(3 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'),
        ev(ago(30 * H), desk, 'Collected by Vivek Singh (Roommate)', 'task_alt', 'Aman is at college till late; asked his roommate on call.'),
      ],
    }),
    p({
      id: 'PCL000005', residentId: 'RES000006', courier: 'Ekart', tracking: 'FMPC2093847561', storage: 'Parcel locker L-01',
      receivedBy: desk, receivedAt: ago(6 * 24 * H), status: 'Collected', notices: [sent(6 * 24 * H - 1, 25)],
      collectedAt: ago(6 * 24 * H - 4 * H), handedOverBy: guard, collector: { self: true, name: 'Sagar Gupta' },
      history: [ev(ago(6 * 24 * H), desk, 'Parcel logged', 'inventory_2'), ev(ago(6 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'), ev(ago(6 * 24 * H - 4 * H), guard, 'Collected by the resident', 'task_alt')],
    }),
    p({
      id: 'PCL000004', residentId: 'RES000005', courier: 'Xpressbees', tracking: '13520948573', storage: 'Reception shelf A',
      receivedBy: guard, receivedAt: ago(9 * 24 * H), status: 'Collected', notices: [sent(9 * 24 * H - 1, 120)],
      collectedAt: ago(8 * 24 * H), handedOverBy: desk, collector: { self: true, name: 'Sahil Khan' },
      history: [ev(ago(9 * 24 * H), guard, 'Parcel logged', 'inventory_2'), ev(ago(9 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'), ev(ago(8 * 24 * H), desk, 'Collected by the resident', 'task_alt')],
    }),
    p({
      id: 'PCL000003', residentId: 'RES000001', courier: 'Amazon', tracking: '408-1192837-4401928', storage: 'Security cabin',
      receivedBy: guard, receivedAt: ago(14 * 24 * H), status: 'Returned', reminderCount: 2, lastReminderAt: ago(10 * 24 * H),
      notices: [sent(14 * 24 * H - 1, 200), sent(12 * 24 * H, 100, 'Reminder'), sent(10 * 24 * H, 60, 'Reminder')],
      returnedAt: ago(7 * 24 * H), returnedBy: owner, returnedTo: 'Amazon delivery associate (Suresh)', returnReason: 'Not collected for 7 days; resident asked to return it (wrong size).',
      history: [
        ev(ago(14 * 24 * H), guard, 'Parcel logged', 'inventory_2'),
        ev(ago(14 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'),
        ev(ago(12 * 24 * H), owner, 'Reminder sent', 'notifications_active'),
        ev(ago(10 * 24 * H), owner, 'Reminder sent', 'notifications_active'),
        ev(ago(7 * 24 * H), owner, 'Returned to sender', 'assignment_return', 'Not collected for 7 days; resident asked to return it (wrong size).'),
      ],
    }),
    p({
      id: 'PCL000002', residentId: 'RES000003', courier: 'Delhivery', tracking: '1491820011201', storage: 'Parcel locker L-02',
      receivedBy: desk, receivedAt: ago(18 * 24 * H), status: 'Collected', notices: [sent(18 * 24 * H - 1, 30)],
      collectedAt: ago(18 * 24 * H - 6 * H), handedOverBy: desk, collector: { self: true, name: 'Vivek Singh' },
      history: [ev(ago(18 * 24 * H), desk, 'Parcel logged', 'inventory_2'), ev(ago(18 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'), ev(ago(18 * 24 * H - 6 * H), desk, 'Collected by the resident', 'task_alt')],
    }),
    p({
      id: 'PCL000001', residentId: 'RES000007', courier: 'Flipkart', tracking: 'FMPP1002938475', storage: 'Reception shelf B',
      receivedBy: guard, receivedAt: ago(25 * 24 * H), status: 'Collected', notices: [sent(25 * 24 * H - 1, 45)],
      collectedAt: ago(25 * 24 * H - 2 * H), handedOverBy: guard, collector: { self: true, name: 'Mohit Yadav' },
      history: [ev(ago(25 * 24 * H), guard, 'Parcel logged', 'inventory_2'), ev(ago(25 * 24 * H - 1), 'System', 'Arrival notification sent', 'notifications'), ev(ago(25 * 24 * H - 2 * H), guard, 'Collected by the resident', 'task_alt')],
    }),
  ];
}

@Injectable({ providedIn: 'root' })
export class ParcelsService {
  private readonly auth = inject(AuthService);
  private readonly residentsService = inject(ResidentsService);

  private readonly subject = new BehaviorSubject<Parcel[]>(this.load());
  readonly parcels$: Observable<Parcel[]> = this.subject.asObservable();

  readonly stats$: Observable<ParcelStats> = this.parcels$.pipe(
    map((list) => {
      const mine = list.filter((p) => p.hostelId === HOSTEL_ID);
      const today = localIso().slice(0, 10);
      const monthAgo = localIso(new Date(Date.now() - 30 * DAY));
      return {
        awaiting: mine.filter((p) => p.status === 'Awaiting Pickup').length,
        collectedToday: mine.filter((p) => p.status === 'Collected' && p.collectedAt?.startsWith(today)).length,
        overdue: mine.filter((p) => this.isOverdue(p)).length,
        returned: mine.filter((p) => p.status === 'Returned' && (p.returnedAt ?? '') >= monthAgo).length,
      };
    }),
  );

  get parcels(): Parcel[] {
    return this.subject.value;
  }

  byId(id: string): Parcel | undefined {
    return this.parcels.find((p) => p.id === id);
  }

  // ---- Residents ------------------------------------------------------------------

  /** Residents a new parcel can be logged for: current (Active / On Leave), not deactivated. */
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

  /** Channels a notification would go out on; empty = no way to reach the resident. */
  channelsFor(residentId: string): string[] {
    const r = this.resident(residentId);
    if (!r) return [];
    const app = r.status === 'Active' || r.status === 'On Leave';
    return [app ? 'In-app' : '', r.mobile ? 'SMS' : '', r.email ? 'Email' : ''].filter(Boolean);
  }

  // ---- Derived state --------------------------------------------------------------

  /** Whole days since the parcel arrived (until collected / returned). */
  ageDays(p: Parcel): number {
    const end = p.collectedAt ?? p.returnedAt;
    return Math.max(0, Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(p.receivedAt).getTime()) / DAY));
  }

  isOverdue(p: Parcel): boolean {
    return p.status === 'Awaiting Pickup' && this.ageDays(p) > OVERDUE_DAYS;
  }

  /** Latest notice decides: Failed / Read (once its read time has passed) / Sent; none = Not Sent. */
  notificationStatus(p: Parcel): NotificationStatus {
    const last = p.notices[p.notices.length - 1];
    if (!last) return 'Not Sent';
    if (last.status === 'Failed') return 'Failed';
    return last.readAt && new Date(last.readAt).getTime() <= Date.now() ? 'Read' : 'Sent';
  }

  /** Why a reminder can't go out now (empty = it can). */
  reminderBlocker(p: Parcel): string {
    if (p.status !== 'Awaiting Pickup') return 'Only parcels awaiting pickup can be reminded.';
    const last = p.notices[p.notices.length - 1];
    if (last?.status === 'Sent' && Date.now() - new Date(last.at).getTime() < REMINDER_GAP_HOURS * 3_600_000) {
      return `Notified less than ${REMINDER_GAP_HOURS} hours ago.`;
    }
    return '';
  }

  // ---- Actions --------------------------------------------------------------------

  log(input: ParcelInput): Parcel {
    if (!this.currentResidents.some((r) => r.residentId === input.residentId)) throw new Error('Select a current resident.');
    if (!input.courier.trim()) throw new Error('Courier / sender is required.');
    const now = localIso();
    const by = this.userName;
    let parcel: Parcel = {
      id: this.nextId(),
      hostelId: HOSTEL_ID,
      residentId: input.residentId,
      courier: input.courier.trim(),
      tracking: input.tracking?.trim() || undefined,
      storage: input.storage?.trim() || undefined,
      receivedBy: by,
      receivedAt: now,
      status: 'Awaiting Pickup',
      notices: [],
      reminderCount: 0,
      history: [ev(now, by, 'Parcel logged', 'inventory_2', input.notify ? undefined : 'Notification turned off')],
    };
    if (input.notify) parcel = this.withNotice(parcel, 'Arrival');
    this.commit([parcel, ...this.parcels]);
    return parcel;
  }

  /** Reminder (or a retry of a failed arrival notice). */
  remind(id: string): Parcel {
    const p = this.require(id);
    const blocker = this.reminderBlocker(p);
    if (blocker) throw new Error(blocker);
    const next = this.withNotice(p, p.notices.length ? 'Reminder' : 'Arrival');
    this.replace(next);
    return next;
  }

  /** Bulk reminders; parcels notified within the gap are skipped. */
  remindMany(ids: string[]): BulkReminderResult {
    const result: BulkReminderResult = { sent: 0, failed: 0, skipped: 0 };
    const updated = new Map<string, Parcel>();
    for (const id of ids) {
      const p = this.byId(id);
      if (!p || this.reminderBlocker(p)) {
        result.skipped++;
        continue;
      }
      const next = this.withNotice(p, p.notices.length ? 'Reminder' : 'Arrival');
      updated.set(id, next);
      if (next.notices[next.notices.length - 1].status === 'Sent') result.sent++;
      else result.failed++;
    }
    if (updated.size) this.commit(this.parcels.map((p) => updated.get(p.id) ?? p));
    return result;
  }

  /** Pickup confirmation. Someone other than the resident needs a relation and a reason. */
  collect(id: string, collector: ParcelCollector): Parcel {
    const p = this.require(id);
    if (p.status !== 'Awaiting Pickup') throw new Error('This parcel is no longer awaiting pickup.');
    const r = this.resident(p.residentId);
    const c: ParcelCollector = collector.self
      ? { self: true, name: r ? `${r.firstName} ${r.lastName}` : p.residentId }
      : { self: false, name: collector.name.trim(), relation: collector.relation?.trim(), idReference: collector.idReference?.trim() || undefined, reason: collector.reason?.trim() };
    if (!c.self && (!c.name || !c.relation || !c.reason)) throw new Error('Name, relation and reason are required when someone else collects.');
    const now = localIso();
    const action = c.self ? 'Collected by the resident' : `Collected by ${c.name} (${c.relation})`;
    return this.replace({ ...p, status: 'Collected', collectedAt: now, handedOverBy: this.userName, collector: c, history: [...p.history, ev(now, this.userName, action, 'task_alt', c.reason)] });
  }

  returnToSender(id: string, details: { reason: string; returnedTo: string }): Parcel {
    const p = this.require(id);
    if (p.status !== 'Awaiting Pickup') throw new Error('This parcel is no longer awaiting pickup.');
    if (!details.reason.trim() || !details.returnedTo.trim()) throw new Error('Reason and the person it was handed to are required.');
    const now = localIso();
    return this.replace({
      ...p,
      status: 'Returned',
      returnedAt: now,
      returnedBy: this.userName,
      returnReason: details.reason.trim(),
      returnedTo: details.returnedTo.trim(),
      history: [...p.history, ev(now, this.userName, `Returned to sender · handed to ${details.returnedTo.trim()}`, 'assignment_return', details.reason.trim())],
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Mock send: fails when the resident has no channel to reach them; otherwise "Sent", and an
   * active resident reads it some minutes later (residents on leave may not open it).
   */
  private withNotice(p: Parcel, kind: ParcelNotice['kind']): Parcel {
    const now = localIso();
    const channels = this.channelsFor(p.residentId);
    const r = this.resident(p.residentId);
    const key = `${p.id}${p.notices.length}`;
    const notice: ParcelNotice = channels.length
      ? {
          at: now,
          kind,
          status: 'Sent',
          channels: channels.join(', '),
          readAt: r?.status === 'Active' || rand(key) < 0.4 ? localIso(new Date(Date.now() + (5 + rand(key + 'r') * 115) * 60_000)) : undefined,
        }
      : { at: now, kind, status: 'Failed', channels: '—', note: 'No contact details on the resident profile' };
    const label = kind === 'Arrival' ? 'Arrival notification' : 'Reminder';
    const failed = notice.status === 'Failed';
    return {
      ...p,
      notices: [...p.notices, notice],
      reminderCount: kind === 'Reminder' ? p.reminderCount + 1 : p.reminderCount,
      lastReminderAt: kind === 'Reminder' ? now : p.lastReminderAt,
      history: [...p.history, ev(now, kind === 'Arrival' ? 'System' : this.userName, `${label} ${failed ? 'failed' : 'sent'}`, failed ? 'error' : kind === 'Arrival' ? 'notifications' : 'notifications_active', notice.note)],
    };
  }

  private replace(next: Parcel): Parcel {
    this.commit(this.parcels.map((p) => (p.id === next.id ? next : p)));
    return next;
  }

  private require(id: string): Parcel {
    const p = this.byId(id);
    if (!p) throw new Error('Parcel not found.');
    return p;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.parcels.reduce((m, p) => Math.max(m, Number(p.id.slice(3)) || 0), 0);
    return `PCL${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Parcel[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): Parcel[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Parcel[];
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
