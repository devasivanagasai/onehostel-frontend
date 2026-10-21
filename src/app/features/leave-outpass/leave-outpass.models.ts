// Leave & Outpass Management (Section 5.4).

export const LEAVE_TYPES = ['Leave', 'Outpass'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Physical movement of an approved request; kept apart from the approval decision. */
export const MOVEMENT_STATES = ['Not yet left', 'Out', 'Overdue return', 'Returned'] as const;
export type MovementState = (typeof MOVEMENT_STATES)[number];

/** Approval status → shared status-badge tone. */
export const APPROVAL_TONES: Record<ApprovalStatus, string> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
};

export const MOVEMENT_TONES: Record<MovementState, string> = {
  'Not yet left': 'neutral',
  Out: 'info',
  'Overdue return': 'danger',
  Returned: 'success',
};

/** Where the emergency contact on a request came from. */
export type ContactSource = 'Emergency' | 'Guardian' | 'Other';

export interface LeaveContact {
  source: ContactSource;
  name: string;
  mobile: string;
  relationship?: string;
  /** Required when the contact is not one already on the resident's profile. */
  reason?: string;
}

export interface LeaveNotification {
  at: string;
  to: 'Resident' | 'Guardian';
  name: string;
  channel: string;
  message: string;
  /** Skipped = not sent because a rule blocked it (see note). */
  status: 'Sent' | 'Skipped';
  note?: string;
}

export interface LeaveRequest {
  /** Unique, system-generated, e.g. LVR000001. */
  id: string;
  hostelId: string;
  residentId: string;
  type: LeaveType;
  reason: string;
  /** Local date-times (yyyy-mm-ddTHH:mm:ss). */
  departAt: string;
  returnAt: string;
  destination?: string;
  contact: LeaveContact;
  status: ApprovalStatus;
  /** Who raised it: the resident (app) or staff on their behalf. */
  submittedBy: string;
  submittedVia: 'Resident App' | 'Front Desk';
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Physical movement, recorded by security / staff. */
  exitAt?: string;
  exitBy?: string;
  returnedAt?: string;
  returnBy?: string;
  notifications: LeaveNotification[];
}

export type LeaveInput = Pick<LeaveRequest, 'residentId' | 'type' | 'reason' | 'departAt' | 'returnAt' | 'destination' | 'contact'>;

/** Hostel rules for requests, kept locally. */
export interface LeavePolicy {
  destinationRequired: Record<LeaveType, boolean>;
  /** Security records actual exit / return. */
  movementTracking: boolean;
  /** Guardian is told about decisions (only when on record and consented). */
  notifyGuardian: boolean;
  /** Longest outpass allowed, in hours. */
  outpassMaxHours: number;
}

export const DEFAULT_POLICY: LeavePolicy = {
  destinationRequired: { Leave: true, Outpass: false },
  movementTracking: true,
  notifyGuardian: true,
  outpassMaxHours: 12,
};

export const REASON_MAX = 300;

// ---- Local date helpers (hostel-local, never UTC) -----------------------------

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss). */
export const localIso = (d = new Date()): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

/** Local calendar date (yyyy-mm-dd), built from local parts. */
export const localDate = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const time = (iso: string): number => new Date(iso).getTime();

/** Start / end of a local calendar day as timestamps. */
export const dayStart = (date: string): number => new Date(`${date}T00:00:00`).getTime();
export const dayEnd = (date: string): number => new Date(`${date}T23:59:59`).getTime();

/** "2d 4h", "5h 30m". */
export function durationLabel(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((time(toIso) - time(fromIso)) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  return m && h < 10 ? (h ? `${h}h ${m}m` : `${m}m`) : `${h}h`;
}
