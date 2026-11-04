import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';

export type NotificationTone = 'success' | 'info' | 'warning' | 'danger';

export interface AppNotification {
  id: number;
  icon: string;
  tone: NotificationTone;
  title: string;
  description: string;
  /** Local ISO date-time. */
  timestamp: string;
  unread: boolean;
  /** Where clicking the notification goes. */
  route?: string;
}

const MIN = 60_000;

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss) for "minutes ago". */
const minutesAgo = (m: number): string => {
  const d = new Date(Date.now() - m * MIN);
  return new Date(d.getTime() - d.getTimezoneOffset() * MIN).toISOString().slice(0, 19);
};

/** "Just now", "5 min ago", "2 hours ago", "Yesterday", "3 days ago". */
export function relativeTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / MIN));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

/**
 * Platform notifications for the Admin, shared by the header bell and the
 * dashboard's Recent Notifications card. UI-only build: in-memory mock data.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly subject = new BehaviorSubject<AppNotification[]>([
    {
      id: 1, icon: 'domain_add', tone: 'success', unread: true, timestamp: minutesAgo(5),
      title: 'New hostel onboarded',
      description: 'Grand Stay Hostel was onboarded and its hostel owner account was created.',
      route: '/hostel-onboarding',
    },
    {
      id: 2, icon: 'person_add', tone: 'info', unread: true, timestamp: minutesAgo(120),
      title: 'New hostel owner account created',
      description: 'A hostel owner was added for Royal Palms Luxury Hostel.',
      route: '/admins',
    },
    {
      id: 3, icon: 'pending_actions', tone: 'warning', unread: true, timestamp: minutesAgo(5 * 60),
      title: 'Subscription payment pending',
      description: 'A hostel subscription is waiting for payment.',
      route: '/subscription-payments',
    },
    {
      id: 4, icon: 'lock', tone: 'danger', unread: false, timestamp: minutesAgo(22 * 60),
      title: 'Hostel owner account locked',
      description: 'A hostel owner account was locked after repeated failed sign-ins.',
      route: '/admins',
    },
    {
      id: 5, icon: 'build_circle', tone: 'info', unread: false, timestamp: minutesAgo(26 * 60),
      title: 'Scheduled maintenance completed',
      description: 'Platform maintenance finished successfully. No action needed.',
    },
    {
      id: 6, icon: 'payments', tone: 'success', unread: false, timestamp: minutesAgo(3 * 24 * 60),
      title: 'Subscription payment received',
      description: 'A renewal payment was received and the invoice was generated.',
      route: '/subscription-payments',
    },
  ]);

  readonly notifications$ = this.subject.asObservable();
  private readonly auth = inject(AuthService);

  /** Notifications the signed-in user may act on: ones that lead to an Admin module are Admin-only. */
  private get visible(): AppNotification[] {
    return this.subject.value.filter((n) => !n.route || this.auth.canAccess(n.route));
  }

  /** Newest first. */
  get notifications(): AppNotification[] {
    return [...this.visible].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  get unreadCount(): number {
    return this.visible.filter((n) => n.unread).length;
  }

  markRead(id: number): void {
    this.subject.next(this.subject.value.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }

  markAllRead(): void {
    this.subject.next(this.subject.value.map((n) => ({ ...n, unread: false })));
  }
}
