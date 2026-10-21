// Attendance & Check-in / Check-out (Section 5.5).

import { HostelResident } from '../residents/residents.models';
import { LeaveRequest } from '../leave-outpass/leave-outpass.models';

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'On Leave', 'Not Expected', 'Unknown'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Statuses staff record. Not Expected / Unknown are worked out, never stored. */
export const RECORDED_STATUSES = ['Present', 'Absent', 'On Leave'] as const;
export type RecordedStatus = (typeof RECORDED_STATUSES)[number];

export const ATTENDANCE_METHODS = ['Admin', 'Security', 'QR'] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

/** Methods staff can pick by hand on this screen; QR comes from the gate scanner. */
export const MANUAL_METHODS: AttendanceMethod[] = ['Admin', 'Security'];

export const METHOD_LABELS: Record<AttendanceMethod, string> = {
  Admin: 'Admin entry',
  Security: 'Security desk',
  QR: 'QR scan',
};

export const METHOD_ICONS: Record<AttendanceMethod, string> = {
  Admin: 'admin_panel_settings',
  Security: 'local_police',
  QR: 'qr_code_scanner',
};

export type MethodSettings = Record<AttendanceMethod, boolean>;

export const DEFAULT_METHODS: MethodSettings = { Admin: true, Security: true, QR: true };

/** One in → out stay. The last one may still be open (checked in, not out). */
export interface AttendanceSession {
  /** Local date-times (yyyy-mm-ddTHH:mm:ss). */
  in: string;
  inMethod: AttendanceMethod;
  out?: string;
  outMethod?: AttendanceMethod;
}

/** One entry of a record's audit trail (oldest first). */
export interface AttendanceChange {
  at: string;
  by: string;
  method: AttendanceMethod;
  action: 'Marked' | 'Late entry' | 'Checked in' | 'Checked out' | 'Corrected';
  details: string;
  reason?: string;
}

export interface AttendanceRecord {
  /** Unique, system-generated, e.g. ATT000001. */
  id: string;
  hostelId: string;
  residentId: string;
  /** Hostel-local date (yyyy-mm-dd). One record per resident per date. */
  date: string;
  status: RecordedStatus;
  sessions: AttendanceSession[];
  remarks?: string;
  /** Last writer and how. */
  method: AttendanceMethod;
  recordedBy: string;
  recordedAt: string;
  history: AttendanceChange[];
}

/** Changes from the entry dialog / quick buttons. */
export interface AttendanceChangeInput {
  status: RecordedStatus;
  sessions: AttendanceSession[];
  remarks?: string;
}

/** One line of the daily list. */
export interface AttendanceRow {
  resident: HostelResident;
  name: string;
  location: string;
  building: string;
  /** False for residents who had not joined (or had left) on the date. */
  expected: boolean;
  status: AttendanceStatus;
  record?: AttendanceRecord;
  /** Approved leave covering the date — shown, never treated as proof of exit. */
  leave?: LeaveRequest;
  /** Leave movement says the resident was out the whole day. */
  leaveOut: boolean;
  /** Marked Present while leave movement says Out. */
  conflict: string;
}

export const STATUS_TONES: Record<AttendanceStatus, string> = {
  Present: 'success',
  Absent: 'danger',
  'On Leave': 'warning',
  'Not Expected': 'neutral',
  Unknown: 'neutral',
};

export interface SessionError {
  in?: string;
  out?: string;
}
