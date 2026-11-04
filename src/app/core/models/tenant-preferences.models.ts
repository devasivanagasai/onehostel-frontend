import type { TenantNotificationCategory } from '../services/tenant-notification.service';

export const LANGUAGES = ['English', 'Hindi', 'Telugu'] as const;
export type TenantLanguage = (typeof LANGUAGES)[number];

export const THEMES = ['System', 'Light', 'Dark'] as const;
export type TenantTheme = (typeof THEMES)[number];

export const TEXT_SIZES = ['Normal', 'Large', 'Extra large'] as const;
export type TenantTextSize = (typeof TEXT_SIZES)[number];

/** Root font-size percentage per text size. */
export const TEXT_SCALE: Record<TenantTextSize, number> = { Normal: 100, Large: 112.5, 'Extra large': 125 };

export type PrefChannel = 'inApp' | 'push' | 'email' | 'sms';
export const PREF_CHANNELS: { key: PrefChannel; label: string }[] = [
  { key: 'inApp', label: 'In-app' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

/** Cannot be switched off: they carry account, money, request and room information the Tenant must receive. */
export const ESSENTIAL_CATEGORIES: TenantNotificationCategory[] = ['Account', 'Invoice', 'Payment', 'Complaint', 'Room', 'Transfer'];

export const NOTIFICATION_CATEGORIES: { key: TenantNotificationCategory; label: string }[] = [
  { key: 'Account', label: 'Account' },
  { key: 'Invoice', label: 'Invoices' },
  { key: 'Payment', label: 'Payments' },
  { key: 'Complaint', label: 'Complaints' },
  { key: 'Room', label: 'Room' },
  { key: 'Transfer', label: 'Room transfer' },
  { key: 'Announcement', label: 'Announcements' },
  { key: 'Booking', label: 'Bookings' },
  { key: 'Event', label: 'Events' },
  { key: 'Survey', label: 'Surveys' },
  { key: 'Support', label: 'Help & support' },
  { key: 'Profile', label: 'Profile & documents' },
  { key: 'Visitor', label: 'Visitors' },
  { key: 'Leave', label: 'Leave & outpass' },
  { key: 'Parcel', label: 'Parcels' },
];

export type NotificationPrefsMap = Record<TenantNotificationCategory, Record<PrefChannel, boolean>>;

export interface TenantPreferences {
  language: TenantLanguage;
  theme: TenantTheme;
  textSize: TenantTextSize;
  biometric: boolean;
  notifications: NotificationPrefsMap;
  updatedAt: string;
}

export const PRIVACY_NOTICE =
  'ONEHOSTEL uses your details only to run your stay: room allocation, fees, safety and communication. Your hostel office can see your profile and records. ' +
  'Guardians you have linked see only the information you allow. We do not sell your data. You can ask your hostel office to correct or export your information.';

export const DATA_COLLECTED = [
  'Profile: name, contact details, address and emergency contact',
  'Stay: room and bed, joining and check-out dates',
  'Fees: invoices, payments and receipts',
  'Requests: complaints, leave, visitors, room transfers and feedback',
  'Documents you uploaded (file name, type and size only in this demo)',
  'Preferences saved on this device',
];
