// Mess & Food Management (Section 5.3).

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_ICONS: Record<MealType, string> = {
  Breakfast: 'free_breakfast',
  Lunch: 'lunch_dining',
  Snacks: 'bakery_dining',
  Dinner: 'dinner_dining',
};

/** Default serving window per meal (HH:mm). */
export const MEAL_TIMES: Record<MealType, [string, string]> = {
  Breakfast: ['07:30', '09:30'],
  Lunch: ['12:30', '14:30'],
  Snacks: ['17:00', '18:00'],
  Dinner: ['19:30', '21:30'],
};

/** Stored status. "Archived" is derived once the meal date has passed (see menuStatus). */
export type MenuStatus = 'Draft' | 'Published' | 'Archived';

export const MENU_STATUS_TONES: Record<MenuStatus, string> = {
  Draft: 'neutral',
  Published: 'success',
  Archived: 'info',
};

export interface MenuChange {
  at: string;
  by: string;
  summary: string;
  /** Residents notified (0 when notifications are off). */
  notified: number;
}

export interface MessMenu {
  /** e.g. MNU00001 */
  id: string;
  hostelId: string;
  /** yyyy-mm-dd */
  date: string;
  mealType: MealType;
  items: string[];
  /** HH:mm */
  start: string;
  end: string;
  notes?: string;
  status: 'Draft' | 'Published';
  publishedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Edits made after publishing, newest first. */
  changes: MenuChange[];
}

export type MenuInput = Pick<MessMenu, 'date' | 'mealType' | 'items' | 'start' | 'end' | 'notes'>;

export const MEAL_PLANS = ['Full Board', 'Breakfast & Dinner', 'Pay per Meal', 'No Mess'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

/** Meals each plan covers. */
export const PLAN_MEALS: Record<MealPlan, MealType[]> = {
  'Full Board': [...MEAL_TYPES],
  'Breakfast & Dinner': ['Breakfast', 'Dinner'],
  'Pay per Meal': [...MEAL_TYPES],
  'No Mess': [],
};

export const PLAN_HINTS: Record<MealPlan, string> = {
  'Full Board': 'All meals · monthly Mess fee',
  'Breakfast & Dinner': 'Two meals · monthly Mess fee',
  'Pay per Meal': 'Billed per meal attended',
  'No Mess': 'Not on the mess',
};

/** Resident's meal plan and (restricted) dietary note. */
export interface MealProfile {
  residentId: string;
  plan: MealPlan;
  dietaryNote?: string;
  noteUpdatedAt?: string;
}

export type AttendanceMark = 'Present' | 'Opted out';

/** Access to dietary notes is logged: every reveal and every change. */
export interface DietaryAccess {
  at: string;
  by: string;
  residentId: string;
  action: 'Viewed' | 'Updated';
}

/** Mock resident notification for publish / change events. */
export interface MessNotice {
  id: string;
  at: string;
  kind: 'Published' | 'Updated';
  summary: string;
  recipients: number;
}

/** One pay-per-meal charge per resident per month — the key that keeps generation idempotent. */
export interface MessBilling {
  /** yyyy-mm */
  period: string;
  residentId: string;
  residentName: string;
  meals: number;
  amount: number;
  chargeId: string;
  at: string;
}

export interface MessSettings {
  attendanceEnabled: boolean;
  notifyResidents: boolean;
  /** Per-meal rate for pay-per-meal residents. */
  rates: Record<MealType, number>;
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

/** Monday of the week containing `date`. */
export const weekStart = (date: string): string => {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return addDays(date, -((dow + 6) % 7));
};

export const weekDates = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** "07:30" → "7:30 AM" (wall-clock, no time-zone shift). */
export const clock = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10" → "October 2026" */
export const periodLabel = (period: string): string => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** yyyy-mm, `offset` months from the current month. */
export const monthOffset = (offset: number): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return localIso(d).slice(0, 7);
};
