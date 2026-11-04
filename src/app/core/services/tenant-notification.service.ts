import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { TenantContextService } from './tenant-context.service';

const STORAGE_KEY = 'onehostel_tenant_notifications_v1';

export type TenantNotificationCategory =
  | 'Account'
  | 'Invoice'
  | 'Payment'
  | 'Complaint'
  | 'Announcement'
  | 'Room'
  | 'Profile'
  | 'Booking'
  | 'Visitor'
  | 'Leave'
  | 'Parcel'
  | 'Transfer'
  | 'Support'
  | 'Event'
  | 'Survey';

export interface TenantNotification {
  id: string;
  residentId: string;
  category: TenantNotificationCategory;
  title: string;
  body: string;
  /** Tenant page to open, e.g. "/my/fees". */
  route?: string;
  /** Local date-time, yyyy-mm-ddTHH:mm:ss. */
  createdAt: string;
  read: boolean;
}

export type NewTenantNotification = Pick<TenantNotification, 'category' | 'title' | 'body' | 'route'>;

const pad = (n: number): string => String(n).padStart(2, '0');
const nowLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * In-app notification centre for Tenants (FRD 5.8 / 10). Any service can `push` one for a resident;
 * the Tenant only ever reads their own. Text must not carry passwords, OTPs or needless personal detail.
 */
@Injectable({ providedIn: 'root' })
export class TenantNotificationService {
  private readonly tenant = inject(TenantContextService);
  private readonly subject = new BehaviorSubject<TenantNotification[]>(this.load());

  /** Every notification, all residents (internal; pages use `mine$`). */
  private get all(): TenantNotification[] {
    return this.subject.value;
  }

  /** The signed-in Tenant's notifications, newest first. */
  readonly mine$: Observable<TenantNotification[]> = this.subject.pipe(map((list) => this.ownList(list)));
  readonly unreadCount$: Observable<number> = this.mine$.pipe(map((list) => list.filter((n) => !n.read).length));

  get mine(): TenantNotification[] {
    return this.ownList(this.all);
  }

  /** Adds a notification for a resident. Text containing a password or one-time code is refused. */
  push(residentId: string, input: NewTenantNotification): TenantNotification {
    const text = `${input.title} ${input.body}`;
    if (/\b(otp|password|passcode|one[- ]time code)\b/i.test(text) || /\b\d{6}\b/.test(text)) {
      throw new Error('Notifications must not contain passwords or one-time codes.');
    }
    const n: TenantNotification = {
      id: `NTF${String(this.nextNumber()).padStart(6, '0')}`,
      residentId,
      category: input.category,
      title: input.title.trim(),
      body: input.body.trim(),
      route: input.route,
      createdAt: nowLocal(),
      read: false,
    };
    this.save([n, ...this.all]);
    return n;
  }

  markRead(id: string): void {
    const own = this.requireOwn(id);
    if (own.read) return;
    this.save(this.all.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  markAllRead(): void {
    const me = this.tenant.requireResidentId();
    if (!this.all.some((n) => n.residentId === me && !n.read)) return;
    this.save(this.all.map((n) => (n.residentId === me ? { ...n, read: true } : n)));
  }

  /** Removes one of the signed-in Tenant's own notifications from their centre. */
  remove(id: string): void {
    this.requireOwn(id);
    this.save(this.all.filter((n) => n.id !== id));
  }

  private requireOwn(id: string): TenantNotification {
    const me = this.tenant.requireResidentId();
    const n = this.all.find((x) => x.id === id);
    if (!n || n.residentId !== me) throw new Error('Notification not found.');
    return n;
  }

  private ownList(list: TenantNotification[]): TenantNotification[] {
    const me = this.tenant.residentId;
    return me ? list.filter((n) => n.residentId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : [];
  }

  private nextNumber(): number {
    return this.all.reduce((max, n) => Math.max(max, Number(n.id.slice(3)) || 0), 0) + 1;
  }

  private load(): TenantNotification[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as TenantNotification[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall back to the seed */
    }
    return seed();
  }

  private save(list: TenantNotification[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable; kept in memory */
    }
  }
}

function seed(): TenantNotification[] {
  const n = (i: number, residentId: string, category: TenantNotificationCategory, title: string, body: string, createdAt: string, route: string, read = false): TenantNotification => ({
    id: `NTF${String(i).padStart(6, '0')}`,
    residentId,
    category,
    title,
    body,
    route,
    createdAt,
    read,
  });
  return [
    n(1, 'RES000001', 'Account', 'Welcome to ONEHOSTEL', 'Your account is active. Your room and fee details are on your dashboard.', '2026-10-01T09:00:00', '/dashboard', true),
    n(2, 'RES000001', 'Invoice', 'New invoice raised', 'Your rent invoice for this month is ready. Open Fees & Payments to review it.', '2026-11-01T08:00:00', '/my/fees'),
    n(3, 'RES000001', 'Announcement', 'New notice from the hostel', 'A notice has been published for residents. Open Announcements to read it.', '2026-11-02T10:30:00', '/my/announcements'),
    n(4, 'RES000002', 'Invoice', 'New invoice raised', 'Your rent invoice for this month is ready.', '2026-11-01T08:00:00', '/my/fees'),
  ];
}
