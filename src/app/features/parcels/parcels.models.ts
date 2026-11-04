// Parcel Management (Section 5.6).

export const PICKUP_STATUSES = ['Awaiting Pickup', 'Collected', 'Returned'] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const NOTIFICATION_STATUSES = ['Not Sent', 'Sent', 'Failed', 'Read'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const PICKUP_TONES: Record<PickupStatus, string> = {
  'Awaiting Pickup': 'warning',
  Collected: 'success',
  Returned: 'neutral',
};

export const NOTIFICATION_TONES: Record<NotificationStatus, string> = {
  'Not Sent': 'neutral',
  Sent: 'info',
  Failed: 'danger',
  Read: 'success',
};

export const NOTIFICATION_ICONS: Record<NotificationStatus, string> = {
  'Not Sent': 'notifications_off',
  Sent: 'mark_email_unread',
  Failed: 'error',
  Read: 'mark_email_read',
};

/** Common couriers; anything else is typed in under "Other". */
export const COURIERS = ['Amazon', 'Flipkart', 'Blue Dart', 'Delhivery', 'DTDC', 'Ekart', 'India Post', 'Myntra', 'Xpressbees', 'Shadowfax'];

export const STORAGE_SUGGESTIONS = ['Reception shelf A', 'Reception shelf B', 'Parcel locker L-01', 'Parcel locker L-02', 'Parcel locker L-03', 'Security cabin'];

export const COLLECTOR_RELATIONS = ['Roommate', 'Friend', 'Family member', 'Colleague', 'Other'];

/** Uncollected longer than this is overdue. */
export const OVERDUE_DAYS = 3;

/** A parcel isn't reminded about again within this many hours. */
export const REMINDER_GAP_HOURS = 4;

export interface ParcelNotice {
  at: string;
  kind: 'Arrival' | 'Reminder';
  status: 'Sent' | 'Failed';
  /** e.g. "In-app, SMS, Email". */
  channels: string;
  /** When the resident opened it (mock); in the future = not read yet. */
  readAt?: string;
  note?: string;
}

export interface ParcelEvent {
  at: string;
  by: string;
  action: string;
  icon: string;
  note?: string;
}

/** Person the parcel was handed to (resident or someone they authorised). */
export interface ParcelCollector {
  self: boolean;
  name: string;
  relation?: string;
  idReference?: string;
  reason?: string;
}

export interface Parcel {
  /** Unique, system-generated, e.g. PCL000001. */
  id: string;
  hostelId: string;
  residentId: string;
  courier: string;
  tracking?: string;
  storage?: string;
  receivedBy: string;
  receivedAt: string;
  status: PickupStatus;
  notices: ParcelNotice[];
  reminderCount: number;
  lastReminderAt?: string;
  collectedAt?: string;
  /** Staff member who handed it over. */
  handedOverBy?: string;
  collector?: ParcelCollector;
  returnedAt?: string;
  returnedBy?: string;
  returnReason?: string;
  /** Courier agent / sender it went back to. */
  returnedTo?: string;
  history: ParcelEvent[];
}

export interface ParcelInput {
  residentId: string;
  courier: string;
  tracking?: string;
  storage?: string;
  notify: boolean;
}

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
export const localIso = (d = new Date()): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
