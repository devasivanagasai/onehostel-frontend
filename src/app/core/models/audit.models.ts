export type AuditModule =
  | 'Auth'
  | 'Hostel'
  | 'Hostel Owner'
  | 'Tenant'
  | 'Subscription Plan'
  | 'Subscription & Payment'
  | 'Fees & Payments'
  | 'Complaints'
  | 'Communication Template'
  | 'System Defaults';

/** Every tracked platform event, and the Module / Action it is shown under. */
export const AUDIT_EVENTS = {
  Login: { module: 'Auth', action: 'Login' },
  Logout: { module: 'Auth', action: 'Logout' },
  'Reset Password': { module: 'Auth', action: 'Reset Password' },
  'Change Password': { module: 'Auth', action: 'Change Password' },
  'Update Profile': { module: 'Auth', action: 'Update Profile' },
  'Create Hostel': { module: 'Hostel', action: 'Create' },
  'Update Hostel': { module: 'Hostel', action: 'Update' },
  'Activate Hostel': { module: 'Hostel', action: 'Activate' },
  'Deactivate Hostel': { module: 'Hostel', action: 'Deactivate' },
  'Create Admin': { module: 'Hostel Owner', action: 'Create' },
  'Update Admin': { module: 'Hostel Owner', action: 'Update' },
  'Activate Admin': { module: 'Hostel Owner', action: 'Activate' },
  'Deactivate Admin': { module: 'Hostel Owner', action: 'Deactivate' },
  'Lock Admin': { module: 'Hostel Owner', action: 'Lock' },
  'Unlock Admin': { module: 'Hostel Owner', action: 'Unlock' },
  'Activate Resident': { module: 'Tenant', action: 'Activate' },
  'Deactivate Resident': { module: 'Tenant', action: 'Deactivate' },
  'Block Resident': { module: 'Tenant', action: 'Block' },
  'Unblock Resident': { module: 'Tenant', action: 'Unblock' },
  'Create Plan': { module: 'Subscription Plan', action: 'Create' },
  'Update Plan': { module: 'Subscription Plan', action: 'Update' },
  'Activate Plan': { module: 'Subscription Plan', action: 'Activate' },
  'Deactivate Plan': { module: 'Subscription Plan', action: 'Deactivate' },
  'Record Payment': { module: 'Subscription & Payment', action: 'Record Payment' },
  'Create Template': { module: 'Communication Template', action: 'Create' },
  'Update Template': { module: 'Communication Template', action: 'Update' },
  'Change Settings': { module: 'System Defaults', action: 'Update' },
  'Create Resident': { module: 'Tenant', action: 'Create' },
  'Update Resident': { module: 'Tenant', action: 'Update' },
  'Invite Resident': { module: 'Tenant', action: 'Send Invite' },
  'Allocate Resident': { module: 'Tenant', action: 'Allocate Bed' },
  'Transfer Resident': { module: 'Tenant', action: 'Transfer Bed' },
  'Check Out Resident': { module: 'Tenant', action: 'Check Out' },
  'Create Fee': { module: 'Fees & Payments', action: 'Create Fee' },
  'Update Fee': { module: 'Fees & Payments', action: 'Update Fee' },
  'Generate Charges': { module: 'Fees & Payments', action: 'Generate Charges' },
  'Create Charge': { module: 'Fees & Payments', action: 'Create Charge' },
  'Cancel Charge': { module: 'Fees & Payments', action: 'Cancel Charge' },
  'Collect Payment': { module: 'Fees & Payments', action: 'Record Payment' },
  'Confirm Payment': { module: 'Fees & Payments', action: 'Confirm Payment' },
  'Reverse Payment': { module: 'Fees & Payments', action: 'Reverse' },
  'Refund Payment': { module: 'Fees & Payments', action: 'Refund' },
  'Send Reminder': { module: 'Fees & Payments', action: 'Send Reminder' },
  'Create Complaint': { module: 'Complaints', action: 'Create' },
  'Assign Complaint': { module: 'Complaints', action: 'Assign' },
  'Update Complaint': { module: 'Complaints', action: 'Update Status' },
  'Resolve Complaint': { module: 'Complaints', action: 'Resolve' },
  'Close Complaint': { module: 'Complaints', action: 'Close' },
  'Reopen Complaint': { module: 'Complaints', action: 'Reopen' },
  'Create Room': { module: 'Hostel', action: 'Create' },
  'Update Room': { module: 'Hostel', action: 'Update' },
  'Delete Room': { module: 'Hostel', action: 'Delete' },
  'Update Bed': { module: 'Hostel', action: 'Update' },
} as const satisfies Record<string, { module: AuditModule; action: string }>;

export type AuditEvent = keyof typeof AUDIT_EVENTS;

export const AUDIT_EVENT_NAMES = Object.keys(AUDIT_EVENTS) as AuditEvent[];

export const AUDIT_MODULES: AuditModule[] = [
  'Auth',
  'Hostel',
  'Hostel Owner',
  'Tenant',
  'Subscription Plan',
  'Subscription & Payment',
  'Fees & Payments',
  'Complaints',
  'Communication Template',
  'System Defaults',
];

export type AuditStatus = 'Success' | 'Failed';

/** One field's before/after value on a sensitive change. */
export interface AuditChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export interface AuditLog {
  logId: string;
  /** ISO date-time. */
  timestamp: string;
  user: string;
  event: AuditEvent;
  /** The record acted on — hostel name, plan name, username, etc. */
  entity: string;
  ipAddress: string;
  status: AuditStatus;
  /** Why it failed, or extra context. */
  details?: string;
  /** Old → new values, recorded for updates and status changes. */
  changes?: AuditChange[];
}

export function auditModule(log: AuditLog): AuditModule {
  return AUDIT_EVENTS[log.event].module;
}

export function auditAction(log: AuditLog): string {
  return AUDIT_EVENTS[log.event].action;
}

/**
 * How an event name is shown on screen. The stored keys ("Lock Admin", "Block Resident") stay
 * unchanged so entries saved earlier still work; users see the current role names.
 */
export function auditEventLabel(event: string): string {
  return event.replace(/\bAdmin$/, 'Hostel Owner').replace(/\bResident$/, 'Tenant');
}

/**
 * Field-by-field diff for audit entries. Only keys listed in `labels` are
 * compared, so secrets (passwords, tokens) are never captured by accident.
 */
export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): AuditChange[] {
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (v instanceof Date) return v.toISOString().split('T')[0];
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  return Object.entries(labels)
    .filter(([key]) => show(before[key]) !== show(after[key]))
    .map(([key, field]) => ({ field, oldValue: show(before[key]), newValue: show(after[key]) }));
}
