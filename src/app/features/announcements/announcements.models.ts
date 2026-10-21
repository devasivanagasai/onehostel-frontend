// Announcements & Communication (Section 4.6).

import { RoomType } from '../rooms-management/rooms.models';

export const ANNOUNCEMENT_STATUSES = ['Draft', 'Scheduled', 'Published', 'Expired', 'Cancelled'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** Status → shared status-badge tone. */
export const ANNOUNCEMENT_STATUS_TONES: Record<AnnouncementStatus, string> = {
  Draft: 'neutral',
  Scheduled: 'info',
  Published: 'success',
  Expired: 'warning',
  Cancelled: 'danger',
};

export const CHANNELS = ['In-app', 'Push', 'Email', 'SMS'] as const;
export type AnnouncementChannel = (typeof CHANNELS)[number];

export const CHANNEL_ICONS: Record<AnnouncementChannel, string> = {
  'In-app': 'chat',
  Push: 'notifications',
  Email: 'mail',
  SMS: 'sms',
};

/** Colour key per channel, used for the channel icons in the list and details. */
export const CHANNEL_TONES: Record<AnnouncementChannel, string> = {
  'In-app': 'teal',
  Push: 'blue',
  Email: 'purple',
  SMS: 'amber',
};

export type AudienceType = 'All' | 'Rooms' | 'RoomTypes' | 'Residents';

export const AUDIENCE_OPTIONS: { value: AudienceType; label: string; icon: string }[] = [
  { value: 'All', label: 'All residents', icon: 'groups' },
  { value: 'Rooms', label: 'Selected rooms', icon: 'meeting_room' },
  { value: 'RoomTypes', label: 'Room types', icon: 'category' },
  { value: 'Residents', label: 'Selected residents', icon: 'person_search' },
];

export interface AnnouncementAudience {
  type: AudienceType;
  roomIds: string[];
  roomTypes: RoomType[];
  residentIds: string[];
}

export const TITLE_MAX = 100;
export const MESSAGE_MAX = 1000;

/** Attachment limits: one PDF or image, up to 5 MB. */
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const ATTACHMENT_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Only the file's metadata is kept in this UI-only build. */
export interface AnnouncementAttachment {
  name: string;
  size: number;
  type: string;
}

export interface Announcement {
  /** Unique, system-generated, e.g. ANN000001. */
  id: string;
  hostelId: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  channels: AnnouncementChannel[];
  /** Local date-time (yyyy-mm-ddTHH:mm:ss). Unset on drafts that haven't picked a time. */
  publishAt?: string;
  /** Local date (yyyy-mm-dd); the announcement expires at the end of that day. */
  expiryDate?: string;
  attachment?: AnnouncementAttachment;
  /** Stored status. 'Scheduled' → 'Published' → 'Expired' are worked out on read (see effectiveStatus). */
  status: Exclude<AnnouncementStatus, 'Expired'>;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
  cancelledBy?: string;
  cancelledAt?: string;
}

/** Compose dialog payload. System fields are filled by the service. */
export type AnnouncementInput = Pick<Announcement, 'title' | 'message' | 'audience' | 'channels' | 'publishAt' | 'expiryDate' | 'attachment'>;

/** Delivery / read figures for one channel. `read` is null where the channel can't report it (SMS). */
export interface ChannelDelivery {
  channel: AnnouncementChannel;
  targeted: number;
  delivered: number;
  read: number | null;
  note?: string;
}

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
export const localIso = (d = new Date()): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

/** End of the expiry day, as a timestamp. */
export const expiryTime = (date: string): number => new Date(`${date}T23:59:59`).getTime();

/** Status as of `now`: scheduled messages go live at their publish time and expire after the expiry date. */
export function effectiveStatus(a: Announcement, now = Date.now()): AnnouncementStatus {
  if (a.status === 'Draft' || a.status === 'Cancelled') return a.status;
  const live = a.status === 'Published' || (!!a.publishAt && new Date(a.publishAt).getTime() <= now);
  if (!live) return 'Scheduled';
  return a.expiryDate && expiryTime(a.expiryDate) < now ? 'Expired' : 'Published';
}

/** Has gone out to residents (delivery figures exist). */
export const wasSent = (s: AnnouncementStatus): boolean => s === 'Published' || s === 'Expired';

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
