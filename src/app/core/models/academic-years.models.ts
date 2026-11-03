// Academic Year Management for College Hostels (FRD 6.4). Mock data.

export const ACADEMIC_YEAR_STATUSES = ['Draft', 'Upcoming', 'Active', 'Completed', 'Archived'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

export const ACADEMIC_YEAR_TONES: Record<AcademicYearStatus, string> = {
  Draft: 'neutral',
  Upcoming: 'info',
  Active: 'success',
  Completed: 'warning',
  Archived: 'neutral',
};

/** Forward-only status moves. A Draft may also be archived (cancelled). */
export const NEXT_STATUSES: Record<AcademicYearStatus, AcademicYearStatus[]> = {
  Draft: ['Upcoming', 'Archived'],
  Upcoming: ['Active'],
  Active: ['Completed'],
  Completed: ['Archived'],
  Archived: [],
};

export interface AllocationWindow {
  /** YYYY-MM-DD. */
  start: string;
  end: string;
}

export interface AcademicYearEvent {
  at: string;
  by: string;
  action: string;
  note?: string;
}

export interface AcademicYear {
  /** AY000001. */
  id: string;
  hostelId: string;
  /** e.g. 2026–2027. */
  name: string;
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Free-text block; empty = the whole hostel. Years only clash within the same scope. */
  block: string;
  /** Course / department / year / group labels. */
  eligibility: string[];
  allocationWindow?: AllocationWindow;
  status: AcademicYearStatus;
  /** Residents assigned to this year. Assigning never changes their bed. */
  residentIds: string[];
  createdAt: string;
  updatedAt: string;
  history: AcademicYearEvent[];
}

export interface AcademicYearInput {
  name: string;
  startDate: string;
  endDate: string;
  block?: string;
  eligibility?: string[];
  allocationWindow?: AllocationWindow | null;
}

export const MIN_DURATION_DAYS = 30;
export const MAX_ELIGIBILITY_CHIPS = 10;
export const REASON_MAX = 200;

/** Same-scope key: block text trimmed and lower-cased; '' = whole hostel. */
export const scopeKey = (block: string | undefined): string => (block ?? '').trim().toLowerCase();

/** Compares names so 2026-2027 and 2026–2027 count as the same. */
export const normalizeYearName = (name: string): string => name.trim().replace(/[‐-―-]/g, '-').replace(/\s+/g, ' ').toLowerCase();

/** Whole days from a to b (YYYY-MM-DD, local). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}
