/** Sections of the Hostel Settings page (left nav). */
export type HostelSettingsSection = 'profile' | 'rules' | 'facilities' | 'notifications' | 'subscription' | 'security';

export interface HostelProfile {
  hostelName: string;
  /** Data URL of the uploaded logo; empty = initials placeholder. */
  logoDataUrl: string;
  logoFileName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
}

export interface HostelRules {
  checkInTime: string;
  checkOutTime: string;
  gateClosingTime: string;
  visitorsAllowed: boolean;
  visitingFrom: string;
  visitingTo: string;
  maxVisitors: number;
  visitorIdRequired: boolean;
  houseRules: string[];
}

export type NotificationChannel = 'inApp' | 'push' | 'email' | 'sms';
export type NotificationEvent =
  | 'newComplaint'
  | 'paymentReceived'
  | 'feeDueReminder'
  | 'newResident'
  | 'residentCheckOut'
  | 'announcementPublished';

export type NotificationPrefs = Record<NotificationEvent, Record<NotificationChannel, boolean>>;

/** Everything the Hostel Owner edits on this page (one form, one Save). */
export interface HostelSettingsValue {
  profile: HostelProfile;
  rules: HostelRules;
  facilities: string[];
  notifications: NotificationPrefs;
}

/**
 * What the signed-in Hostel Owner may change. Identity (the hostel name) is editable,
 * but a change only takes effect after SuperAdmin approval.
 */
export interface HostelSettingsPermissions {
  canEditIdentity: boolean;
  identityChangeNeedsApproval: boolean;
  canEditContact: boolean;
  canEditFacilities: boolean;
}

export interface NameChangeRequest {
  requestedName: string;
  requestedAt: string;
}

export interface UpgradeRequest {
  desiredPlan: string;
  note: string;
  requestedAt: string;
}

export type LimitKey = 'rooms' | 'beds' | 'residents' | 'staffUsers';

/** The hostel's subscription — assigned by SuperAdmin, read-only here. */
export interface HostelSubscription {
  planId: string;
  planName: string;
  billingCycle: 'Monthly' | 'Quarterly' | 'Yearly';
  /** Display only — pricing is managed by the platform. */
  price: string;
  status: 'Active' | 'Expired' | 'Suspended';
  startDate: string;
  expiryDate: string;
  limits: Record<LimitKey, number>;
  /** Staff sign-ins in use (no staff module yet, so tracked here). */
  staffUsersUsed: number;
  /** Feature ids from Subscription Plans → enabled for this hostel. */
  modules: Record<string, boolean>;
  /** Notification channels included in the plan. */
  channels: Record<NotificationChannel, boolean>;
}

export interface HostelSettingsState {
  hostelId: string;
  /** Inherited from SuperAdmin onboarding. */
  hostelType: string;
  value: HostelSettingsValue;
  pendingNameChange: NameChangeRequest | null;
  upgradeRequest: UpgradeRequest | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

export interface FacilityOption {
  name: string;
  icon: string;
  /** Subscription module the facility depends on; absent = always available. */
  module?: string;
}

/** Hostel-wide facilities (icons match the room amenities checklist where they overlap). */
export const HOSTEL_FACILITIES: FacilityOption[] = [
  { name: 'Wi-Fi', icon: 'wifi' },
  { name: 'Power Backup', icon: 'power' },
  { name: 'Geyser / Hot Water', icon: 'water_drop' },
  { name: 'RO Drinking Water', icon: 'local_drink' },
  { name: 'Daily Housekeeping', icon: 'cleaning_services' },
  { name: 'CCTV Security', icon: 'videocam' },
  { name: 'Parking', icon: 'local_parking' },
  { name: 'Lift', icon: 'elevator' },
  { name: 'Common TV Room', icon: 'tv' },
  { name: 'Study Room', icon: 'menu_book' },
  { name: 'Gym', icon: 'fitness_center' },
  { name: 'Mess / Dining', icon: 'restaurant', module: 'mess' },
  { name: 'Laundry Service', icon: 'checkroom', module: 'laundry' },
  { name: 'Washing Machine', icon: 'local_laundry_service', module: 'washingMachine' },
];

export const NOTIFICATION_CHANNELS: { key: NotificationChannel; label: string; icon: string }[] = [
  { key: 'inApp', label: 'In-app', icon: 'notifications' },
  { key: 'push', label: 'Push', icon: 'phone_iphone' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'sms', label: 'SMS', icon: 'sms' },
];

export const NOTIFICATION_EVENTS: { key: NotificationEvent; label: string; description: string }[] = [
  { key: 'newComplaint', label: 'New complaint', description: 'A tenant raises a complaint' },
  { key: 'paymentReceived', label: 'Payment received', description: 'A fee payment is recorded' },
  { key: 'feeDueReminder', label: 'Fee due reminder', description: 'Fees falling due in the next few days' },
  { key: 'newResident', label: 'New tenant', description: 'A tenant is added or accepts an invite' },
  { key: 'residentCheckOut', label: 'Tenant check-out', description: 'A tenant checks out of a bed' },
  { key: 'announcementPublished', label: 'Announcement published', description: 'An announcement goes live' },
];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan',
  'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_HOUSE_RULES = 20;
export const HOUSE_RULE_MAX_LENGTH = 200;

/** Plans a hostel can ask to move to (names / limits match Subscription Plans; prices are display only). */
export const UPGRADE_PLANS = [
  { planId: 'PLN-1003', planName: 'Premium', price: '₹19,999 / yr', residentLimit: 500 },
  { planId: 'CUSTOM', planName: 'Custom / Enterprise', price: 'Quoted by billing', residentLimit: 0 },
];

/** Why a facility can't be offered on the current plan, or null when it can. */
export function facilityBlockedReason(name: string, subscription: HostelSubscription): string | null {
  const module = HOSTEL_FACILITIES.find((f) => f.name === name)?.module;
  return module && !subscription.modules[module] ? 'Not in your plan' : null;
}
