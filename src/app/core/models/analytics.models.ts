// Advanced Analytics (Section 6.2). Every figure is computed from the live module records; nothing is stored.

import { ResidentStatus, ResidentType } from './residents.models';
import { RoomType } from './rooms.models';

export const ALL = 'All';

/** Filters shared by every section. 'All' means no restriction. */
export interface AnalyticsFilters {
  /** yyyy-mm-dd, hostel-local. */
  from: string;
  to: string;
  building: string;
  roomType: RoomType | typeof ALL;
  residentType: ResidentType | typeof ALL;
  residentStatus: ResidentStatus | typeof ALL;
}

export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 90;

/** KPI definitions shown on screen and written into exports. */
export const OCCUPANCY_DEFINITION =
  'Occupied beds are beds held by a resident at the snapshot time (month end 23:59, hostel-local; the last month uses the end of the selected range). Reserved beds are NOT counted as occupied. Total beds are all configured beds in the matching rooms, including beds under maintenance. Occupancy % = occupied / total beds.';

export const MOVEMENT_DEFINITION =
  'Joining = first bed allocation; Transfer = bed transfer; Leave = status changed to On Leave; Checkout = checked out; Re-admission = bed allocated again after an earlier checkout. Counted by the date of the resident activity entry.';

export const REVENUE_DEFINITION =
  'Charges raised = non-cancelled charges issued in the range. Collected = successful payments dated in the range only; reversed and refunded payments are shown separately and are not collected. Outstanding = unpaid balance of non-cancelled charges issued up to the end of the range, as of that date (late fees included). Aging buckets count days past the due date (0-30 includes charges not yet due).';

// ---- Results ----------------------------------------------------------------------

export interface OccupancyPoint {
  /** yyyy-mm */
  month: string;
  label: string;
  /** Date the snapshot was taken (month end, or the range end for the last month). */
  snapshotDate: string;
  totalBeds: number;
  occupiedBeds: number;
  /** 0-100, one decimal. */
  occupancyPct: number;
}

export interface OccupancyResult {
  points: OccupancyPoint[];
  /** Latest point, if any. */
  latest?: OccupancyPoint;
}

export type MovementKind = 'Joining' | 'Transfer' | 'Leave' | 'Checkout' | 'Re-admission';
export const MOVEMENT_KINDS: MovementKind[] = ['Joining', 'Transfer', 'Leave', 'Checkout', 'Re-admission'];

export interface MovementEvent {
  /** yyyy-mm-dd */
  date: string;
  residentId: string;
  residentName: string;
  kind: MovementKind;
  detail: string;
}

export interface MovementMonth {
  month: string;
  label: string;
  counts: Record<MovementKind, number>;
}

export interface MovementResult {
  totals: Record<MovementKind, number>;
  months: MovementMonth[];
  /** Newest first. */
  events: MovementEvent[];
  /** Approved Leave requests (Leave & Outpass) departing in the range; informational, not part of the totals. */
  approvedLeaveRequests: number;
}

export interface MethodRow {
  method: string;
  count: number;
  amount: number;
}

export interface AgingRow {
  bucket: '0-30' | '31-60' | '61-90' | '90+';
  count: number;
  amount: number;
}

export interface RevenueResult {
  chargesRaised: number;
  chargesCount: number;
  /** Non-cancelled charges' value is `chargesRaised`; waived ones are listed apart. */
  cancelledAmount: number;
  collected: number;
  paymentsCount: number;
  byMethod: MethodRow[];
  refunds: { count: number; amount: number };
  reversals: { count: number; amount: number };
  outstanding: number;
  outstandingCount: number;
  aging: AgingRow[];
  /** Date the outstanding balance is measured at. */
  asOf: string;
}

export interface ComplaintGroupRow {
  key: string;
  count: number;
  /** Hours; null when nothing in the group is resolved. */
  avgResolutionHours: number | null;
  /** Hours; null when no complaint in the group has a recorded first response. */
  avgFirstResponseHours: number | null;
  reopened: number;
}

export interface ComplaintResult {
  total: number;
  resolved: number;
  reopened: number;
  avgResolutionHours: number | null;
  /** False when no complaint has a first response, so the column is left out. */
  hasFirstResponse: boolean;
  avgFirstResponseHours: number | null;
  byCategory: ComplaintGroupRow[];
  byPriority: ComplaintGroupRow[];
  byAssignee: ComplaintGroupRow[];
}

export interface MachineUsageRow {
  unit: string;
  bookings: number;
  completed: number;
  cancelled: number;
  noShows: number;
  hoursUsed: number;
}

export interface PeakSlot {
  /** HH:00 */
  slot: string;
  bookings: number;
}

export interface ServiceResult {
  bookings: number;
  completed: number;
  cancelled: number;
  noShows: number;
  /** Requested or confirmed and still ahead. */
  open: number;
  byUnit: MachineUsageRow[];
  peakSlots: PeakSlot[];
}

export interface MealRow {
  meal: string;
  present: number;
  optedOut: number;
  /** present / (present + optedOut), 0-100; null when nothing was recorded. */
  participationPct: number | null;
}

export interface MessDay {
  date: string;
  present: number;
  optedOut: number;
}

export interface PlanRow {
  plan: string;
  residents: number;
}

export interface MessResult {
  byMeal: MealRow[];
  byDate: MessDay[];
  plans: PlanRow[];
  totalPresent: number;
  totalOptedOut: number;
  participationPct: number | null;
}

export interface AnalyticsReport {
  filters: AnalyticsFilters;
  occupancy: OccupancyResult;
  movement: MovementResult;
  revenue: RevenueResult;
  complaints: ComplaintResult;
  service: ServiceResult;
  mess: MessResult;
}

export type AnalyticsSection = 'occupancy' | 'movement' | 'revenue' | 'complaints' | 'service' | 'mess';

export const SECTION_LABELS: Record<AnalyticsSection, string> = {
  occupancy: 'Occupancy Trends',
  movement: 'Resident Movement',
  revenue: 'Revenue & Dues',
  complaints: 'Complaint Performance',
  service: 'Service Utilization',
  mess: 'Mess Utilization',
};

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
