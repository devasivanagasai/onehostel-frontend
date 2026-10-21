// Laundry & Washing Machine (Section 5.1).

export const SERVICE_TYPES = ['Self-service Machine', 'Laundry Service'] as const;
export type LaundryServiceType = (typeof SERVICE_TYPES)[number];

/** Admin-controlled state; "Booked" is derived from bookings (see LaundryService.availability). */
export type LaundryServiceState = 'Active' | 'Maintenance' | 'Inactive';
export type LaundryAvailability = 'Available' | 'Booked' | 'Maintenance' | 'Inactive';

export const PRICE_UNITS = ['per load', 'per item', 'per service'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const BOOKING_STATUSES = ['Requested', 'Confirmed', 'Completed', 'Cancelled', 'No-show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Bookings that still hold their slot. */
export const OPEN_STATUSES: BookingStatus[] = ['Requested', 'Confirmed'];

export const AVAILABILITY_TONES: Record<LaundryAvailability, string> = {
  Available: 'success',
  Booked: 'info',
  Maintenance: 'warning',
  Inactive: 'neutral',
};

export const BOOKING_TONES: Record<BookingStatus, string> = {
  Requested: 'warning',
  Confirmed: 'info',
  Completed: 'success',
  Cancelled: 'danger',
  'No-show': 'neutral',
};

export const WEEK_DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/** A washing machine / dryer residents book themselves, or a staffed laundry service (pickup slots). */
export interface LaundryUnit {
  /** e.g. LND001 */
  id: string;
  hostelId: string;
  type: LaundryServiceType;
  name: string;
  location: string;
  /** 0 = free. Required (> 0) for a laundry service. */
  price: number;
  priceUnit: PriceUnit;
  /** Cycle length (machine) or pickup window (service), in minutes. */
  slotMinutes: number;
  /** HH:mm */
  openTime: string;
  closeTime: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** Max bookings per resident per period (cancelled ones don't count). */
  limitCount: number;
  limitPeriod: 'day' | 'week';
  state: LaundryServiceState;
  maintenanceNote?: string;
  maintenanceSince?: string;
  createdAt: string;
  updatedAt: string;
}

export type LaundryUnitInput = Omit<LaundryUnit, 'id' | 'hostelId' | 'state' | 'maintenanceNote' | 'maintenanceSince' | 'createdAt' | 'updatedAt'>;

export interface LaundryBooking {
  /** e.g. LB000001 */
  id: string;
  unitId: string;
  residentId: string;
  residentName: string;
  /** yyyy-mm-dd */
  date: string;
  /** HH:mm */
  start: string;
  end: string;
  /** Items handed in (per-item pricing only). */
  items?: number;
  /** Price fixed at booking time. */
  amount: number;
  status: BookingStatus;
  notes?: string;
  cancelReason?: string;
  /** Set when the resident was told about a maintenance cancellation. */
  notifiedAt?: string;
  /** Resident charge created in Fees & Payments; set once, so a booking is never billed twice. */
  chargeId?: string;
  billedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Mock resident notification (there's no real sender yet). */
export interface LaundryNotice {
  id: string;
  residentId: string;
  residentName: string;
  bookingId: string;
  message: string;
  at: string;
}

export interface Slot {
  start: string;
  end: string;
  /** Why it can't be booked; empty when free. */
  blocked: '' | 'Booked' | 'Past' | 'Maintenance';
}

// ---- Helpers -------------------------------------------------------------------

export const localIso = (d = new Date()): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

export const todayStr = (): string => localIso().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localIso(d).slice(0, 10);
};

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** "07:30" → "7:30 AM". Wall-clock values, so no time-zone shifting. */
export const clock = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const dayOfWeek = (date: string): number => new Date(`${date}T00:00:00`).getDay();

export const daysLabel = (days: number[]): string => {
  if (days.length === 7) return 'Every day';
  if (days.length === 6 && !days.includes(0)) return 'Mon – Sat';
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Mon – Fri';
  return WEEK_DAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(', ');
};
