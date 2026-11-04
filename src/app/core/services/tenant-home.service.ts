import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, startWith, timer } from 'rxjs';
import { TenantContextService } from './tenant-context.service';
import { TenantNotification, TenantNotificationService } from './tenant-notification.service';
import { TenantComplaintsService } from './tenant-complaints.service';
import { TenantAnnouncementsService } from './tenant-announcements.service';
import { TenantEventsService } from './tenant-events.service';
import { TenantRoomTransferService } from './tenant-room-transfer.service';
import { FeesService } from './fees.service';
import { ComplaintsService } from './complaints.service';
import { LeaveOutpassService } from './leave-outpass.service';
import { LaundryService } from '../../features/laundry/laundry.service';
import { VisitorsService } from '../../features/visitors/visitors.service';
import { ParcelsService } from '../../features/parcels/parcels.service';
import { localDateIso } from '../../shared/utils/local-date';

export type AttentionTone = 'danger' | 'warn' | 'info';

/** Something the Tenant should act on now, most urgent first. */
export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  icon: string;
  title: string;
  detail: string;
  actionLabel: string;
  route: string;
}

/** Something happening soon: a booking, leave, visitor, event or a fee due date. */
export interface UpcomingItem {
  id: string;
  /** Local date-time, yyyy-mm-ddTHH:mm:ss (date-only items use 00:00:00). */
  at: string;
  icon: string;
  title: string;
  detail: string;
  route: string;
}

export interface TenantHomeView {
  found: boolean;
  firstName: string;
  room?: { number: string; bed: string; where: string };
  fees: { outstanding: number; overdueCount: number; overdueAmount: number; nextDue?: { date: string; amount: number }; latestPayment: string };
  complaints: { active: number; latest: string };
  unreadNotifications: number;
  attention: AttentionItem[];
  upcoming: UpcomingItem[];
  recent: TenantNotification[];
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;

/**
 * Builds the Tenant home: what needs attention now and what is coming up, from the signed-in Tenant's
 * own records only. A module that is off for the hostel contributes nothing.
 */
@Injectable({ providedIn: 'root' })
export class TenantHomeService {
  private readonly tenant = inject(TenantContextService);
  private readonly notifications = inject(TenantNotificationService);
  private readonly fees = inject(FeesService);
  private readonly ownerComplaints = inject(ComplaintsService);
  private readonly complaints = inject(TenantComplaintsService);
  private readonly announcements = inject(TenantAnnouncementsService);
  private readonly events = inject(TenantEventsService);
  private readonly transfers = inject(TenantRoomTransferService);
  private readonly leave = inject(LeaveOutpassService);
  private readonly laundry = inject(LaundryService);
  private readonly visitors = inject(VisitorsService);
  private readonly parcels = inject(ParcelsService);

  /** Recomputed when the main records change, and once a minute so "due soon" and the agenda stay current. */
  readonly view$: Observable<TenantHomeView> = combineLatest([
    this.tenant.resident$,
    this.notifications.mine$,
    this.fees.charges$,
    this.fees.payments$,
    this.ownerComplaints.complaints$,
    this.announcements.unreadCount$,
    timer(60_000, 60_000).pipe(startWith(0)),
  ]).pipe(map(() => this.compute()));

  compute(): TenantHomeView {
    const id = this.tenant.residentId;
    const resident = this.tenant.resident;
    const empty: TenantHomeView = {
      found: false,
      firstName: 'there',
      fees: { outstanding: 0, overdueCount: 0, overdueAmount: 0, latestPayment: 'none yet' },
      complaints: { active: 0, latest: '' },
      unreadNotifications: 0,
      attention: [],
      upcoming: [],
      recent: [],
    };
    if (!id || !resident) return empty;

    const on = (key: string) => this.tenant.enabledModules.some((m) => m.key === key);
    const today = localDateIso();
    const now = new Date();
    const horizon = new Date(now.getTime() + WINDOW_DAYS * DAY_MS);
    const attention: AttentionItem[] = [];
    const upcoming: UpcomingItem[] = [];

    // ---- Fees
    const charges = this.fees.charges.filter((c) => c.residentId === id && this.fees.chargeStatus(c, today) !== 'Cancelled');
    const open = charges.filter((c) => this.fees.balance(c) > 0);
    const overdue = open.filter((c) => this.fees.chargeStatus(c, today) === 'Overdue');
    const overdueAmount = overdue.reduce((s, c) => s + this.fees.balance(c), 0);
    const outstanding = open.reduce((s, c) => s + this.fees.balance(c), 0);
    const nextOpen = open.filter((c) => c.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const lastPayment = this.fees.payments.filter((p) => p.residentId === id).sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];

    if (on('fees')) {
      if (overdue.length) {
        attention.push({
          id: 'fees-overdue',
          tone: 'danger',
          icon: 'error_outline',
          title: `${overdue.length === 1 ? '1 invoice is' : `${overdue.length} invoices are`} overdue`,
          detail: 'Pay now to avoid late fees.',
          actionLabel: 'Pay now',
          route: '/my/fees',
        });
      }
      if (nextOpen) {
        const days = Math.round((Date.parse(nextOpen.dueDate) - Date.parse(today)) / DAY_MS);
        if (days <= 7) {
          attention.push({
            id: 'fees-soon',
            tone: 'warn',
            icon: 'event_upcoming',
            title: days === 0 ? 'A payment is due today' : `A payment is due in ${days} day${days === 1 ? '' : 's'}`,
            detail: `${nextOpen.description} · due ${this.day(nextOpen.dueDate)}`,
            actionLabel: 'Pay now',
            route: '/my/fees',
          });
        }
        upcoming.push({ id: `due-${nextOpen.id}`, at: `${nextOpen.dueDate}T00:00:00`, icon: 'payments', title: 'Payment due', detail: nextOpen.description, route: '/my/fees' });
      }
    }

    // ---- Parcels
    for (const p of this.parcels.tenantParcels().filter((x) => x.status === 'Awaiting Pickup').slice(0, 2)) {
      attention.push({
        id: `parcel-${p.id}`,
        tone: p.overdue ? 'warn' : 'info',
        icon: 'inventory_2',
        title: `A parcel from ${p.courier} is waiting for you`,
        detail: `Collect it from ${p.pickupLocation || 'the reception'}.`,
        actionLabel: 'View parcel',
        route: '/my/parcels',
      });
    }

    // ---- Complaints
    const mine = on('complaints') ? this.complaints.mine : [];
    const active = mine.filter((c) => c.status === 'Open' || c.status === 'In Progress' || c.status === 'Reopened');
    const toConfirm = mine.filter((x) => x.canConfirm);
    if (toConfirm.length) {
      attention.push({
        id: 'complaints-confirm',
        tone: 'info',
        icon: 'task_alt',
        title: toConfirm.length === 1 ? `"${toConfirm[0].title}" was marked resolved` : `${toConfirm.length} complaints were marked resolved`,
        detail: 'Confirm it is fixed, or reopen it.',
        actionLabel: 'Review',
        route: '/my/complaints',
      });
    }
    const latestComplaint = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    // ---- Notices
    const unreadNotices = on('announcements') ? this.announcements.unreadCount : 0;
    if (unreadNotices > 0) {
      attention.push({
        id: 'notices',
        tone: 'info',
        icon: 'campaign',
        title: `${unreadNotices} new notice${unreadNotices === 1 ? '' : 's'} from the hostel`,
        detail: 'Read what the hostel has published for you.',
        actionLabel: 'Read',
        route: '/my/announcements',
      });
    }

    // ---- Room transfer decisions waiting on the Tenant's side
    const openTransfer = this.transfers.mine.find((t) => t.status === 'Submitted' || t.status === 'Under Review');
    if (openTransfer) {
      upcoming.push({ id: `rt-${openTransfer.id}`, at: `${openTransfer.requestedDate}T00:00:00`, icon: 'swap_horiz', title: 'Room transfer requested', detail: `${openTransfer.status} · for ${this.day(openTransfer.requestedDate)}`, route: '/my/room-transfer' });
    }

    // ---- Upcoming: laundry, leave, visitors, events
    if (on('laundry')) {
      for (const b of this.laundry.tenantBookings()) {
        if ((b.status !== 'Requested' && b.status !== 'Confirmed') || b.date < today) continue;
        const at = `${b.date}T${b.start.length === 5 ? `${b.start}:00` : b.start}`;
        if (new Date(at) < now || new Date(at) > horizon) continue;
        upcoming.push({ id: `ld-${b.id}`, at, icon: 'local_laundry_service', title: 'Laundry booking', detail: `${b.status} · ${this.day(b.date)} at ${b.start.slice(0, 5)}`, route: '/my/laundry' });
      }
    }
    if (on('leave')) {
      for (const l of this.leave.tenantRequests()) {
        if (l.status !== 'Approved' && l.status !== 'Pending') continue;
        if (new Date(l.returnAt) < now || new Date(l.departAt) > horizon) continue;
        upcoming.push({ id: `lv-${l.id}`, at: l.departAt, icon: 'exit_to_app', title: `${l.type} ${l.status === 'Approved' ? 'approved' : 'awaiting approval'}`, detail: `${this.day(l.departAt.slice(0, 10))} to ${this.day(l.returnAt.slice(0, 10))}`, route: '/my/leave' });
      }
    }
    if (on('visitors')) {
      for (const v of this.visitors.tenantVisitors()) {
        if (v.status !== 'Expected' || v.approval === 'Rejected') continue;
        if (new Date(v.expectedAt) < now || new Date(v.expectedAt) > horizon) continue;
        upcoming.push({ id: `vs-${v.id}`, at: v.expectedAt, icon: 'badge', title: `Visitor: ${v.name}`, detail: `${v.approval === 'Pending' ? 'Awaiting approval' : v.approval === 'Approved' ? 'Approved' : 'Registered'} · ${this.day(v.expectedAt.slice(0, 10))} at ${v.expectedAt.slice(11, 16)}`, route: '/my/visitors' });
      }
    }
    for (const e of this.events.tenantEvents().upcoming) {
      if (e.myRsvp?.choice !== 'Going' || new Date(e.startAt) > horizon) continue;
      upcoming.push({ id: `ev-${e.id}`, at: e.startAt, icon: 'event', title: e.name, detail: `You are going · ${this.day(e.startAt.slice(0, 10))} at ${e.startAt.slice(11, 16)}`, route: '/my/events' });
    }
    upcoming.sort((a, b) => a.at.localeCompare(b.at));

    const order: Record<AttentionTone, number> = { danger: 0, warn: 1, info: 2 };
    attention.sort((a, b) => order[a.tone] - order[b.tone]);

    const allocation = this.tenant.allocation;
    const recent = this.notifications.mine.slice(0, 4);
    return {
      found: true,
      firstName: resident.firstName,
      room: allocation
        ? { number: allocation.room.roomNumber, bed: allocation.bed.bedNumber, where: `${allocation.room.building} · ${allocation.room.floor}` }
        : undefined,
      fees: {
        outstanding,
        overdueCount: overdue.length,
        overdueAmount,
        nextDue: nextOpen ? { date: nextOpen.dueDate, amount: this.fees.balance(nextOpen) } : undefined,
        latestPayment: lastPayment ? `${lastPayment.status} · ${this.day(lastPayment.paidAt.slice(0, 10))}` : 'none yet',
      },
      complaints: { active: active.length, latest: latestComplaint ? `${latestComplaint.title} · ${latestComplaint.status}` : 'No complaints raised' },
      unreadNotifications: this.notifications.mine.filter((n) => !n.read).length,
      attention,
      upcoming: upcoming.slice(0, 6),
      recent,
    };
  }

  /** "Wed, 4 Nov" for a yyyy-mm-dd date. */
  private day(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}
