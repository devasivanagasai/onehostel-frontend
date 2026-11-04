// Visitor Management (Section 5.2).

export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Not Required'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const VISIT_STATUSES = ['Expected', 'Checked In', 'Checked Out', 'Cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Status → badge tone (global .status-badge in tables, local pills in dialogs). */
export const APPROVAL_TONES: Record<ApprovalStatus, string> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  'Not Required': 'neutral',
};

export const VISIT_TONES: Record<VisitStatus, string> = {
  Expected: 'info',
  'Checked In': 'success',
  'Checked Out': 'neutral',
  Cancelled: 'danger',
};

export const ID_TYPES = ['Aadhaar Card', 'Driving Licence', 'Voter ID', 'Passport', 'PAN Card', 'Employee / College ID'] as const;
export type VisitorIdType = (typeof ID_TYPES)[number];

export const PURPOSES = ['Family visit', 'Friend visit', 'Parent / Guardian', 'Delivery / Drop-off', 'Official / Document work', 'Maintenance', 'Other'];

export type WalkInPolicy = 'allow' | 'approval' | 'blocked';

export const WALK_IN_OPTIONS: { value: WalkInPolicy; label: string; hint: string; icon: string }[] = [
  { value: 'allow', label: 'Allow', hint: 'Walk-ins are checked in straight away', icon: 'how_to_reg' },
  { value: 'approval', label: 'Allow with approval', hint: 'Walk-ins wait at the gate until approved', icon: 'pending_actions' },
  { value: 'blocked', label: 'Not allowed', hint: 'Only pre-registered visitors may enter', icon: 'block' },
];

/** Local rules that Hostel Settings doesn't cover. */
export interface VisitorRules {
  approvalRequired: boolean;
  walkInPolicy: WalkInPolicy;
  /** ID references are purged this many days after the visit closes. */
  idRetentionDays: number;
}

export const DEFAULT_RULES: VisitorRules = { approvalRequired: true, walkInPolicy: 'approval', idRetentionDays: 30 };

/** Visitor policy as read from Hostel Settings → Rules. */
export interface VisitorPolicy {
  visitorsAllowed: boolean;
  visitingFrom: string;
  visitingTo: string;
  maxVisitors: number;
  idRequired: boolean;
}

export interface VisitorEvent {
  at: string;
  by: string;
  action: string;
  icon: string;
  note?: string;
}

export interface Visitor {
  /** Unique, system-generated, e.g. VIS000001. */
  id: string;
  hostelId: string;
  name: string;
  /** 10 digits without the +91 code. */
  mobile?: string;
  residentId: string;
  purpose: string;
  count: number;
  idType?: VisitorIdType;
  /** Restricted: shown masked, purged after the retention period. */
  idReference?: string;
  idPurgedAt?: string;
  /** Local date-time (yyyy-mm-ddTHH:mm:ss). */
  expectedAt: string;
  walkIn: boolean;
  /** Who raised it: the resident (app) or staff at the desk. */
  source: 'Resident' | 'Staff';
  approval: ApprovalStatus;
  approvalBy?: string;
  approvalAt?: string;
  approvalReason?: string;
  status: VisitStatus;
  checkInAt?: string;
  checkInBy?: string;
  checkOutAt?: string;
  checkOutBy?: string;
  /** Reason recorded when entry was allowed outside visiting hours. */
  overrideReason?: string;
  cancelReason?: string;
  createdBy: string;
  createdAt: string;
  history: VisitorEvent[];
}

export type VisitorInput = Pick<Visitor, 'name' | 'mobile' | 'residentId' | 'purpose' | 'count' | 'idType' | 'idReference' | 'expectedAt' | 'walkIn'> & {
  overrideReason?: string;
};

export const MOBILE_PATTERN = /^[6-9]\d{9}$/;

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
export const localIso = (d = new Date()): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

/** "XXXX-1234": only the last four characters are ever shown without a recorded reveal. */
export const maskId = (ref: string): string => `XXXX-${ref.replace(/\s+/g, '').slice(-4)}`;

/** "HH:mm" of a local ISO date-time. */
export const timeOf = (iso: string): string => iso.slice(11, 16);

/** Whether a local date-time falls inside the visiting window (HH:mm, inclusive). */
export const withinHours = (iso: string, from: string, to: string): boolean => {
  const t = timeOf(iso);
  return t >= from && t <= to;
};

/** "18:30" → "6:30 PM". */
export const clock = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
