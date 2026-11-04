// Advanced Permissions & Audit History (FRD 6.6).

/** Roles a staff member can be given a template for. The Owner always has everything. */
export const ROLE_TEMPLATES = ['Warden', 'Accountant', 'Security', 'Maintenance', 'Mess Manager'] as const;
export type RoleTemplate = (typeof ROLE_TEMPLATES)[number];

export type PermissionRole = RoleTemplate | 'Owner';
export const PERMISSION_ROLES: PermissionRole[] = ['Owner', ...ROLE_TEMPLATES];

export const PERMISSION_MODULES = [
  'residents', 'rooms', 'fees', 'complaints', 'announcements', 'reports', 'laundry', 'visitors',
  'mess', 'leave', 'attendance', 'parcels', 'staff', 'guardians', 'disciplinary', 'analytics',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const MODULE_LABELS: Record<PermissionModule, string> = {
  residents: 'Residents', rooms: 'Rooms & Beds', fees: 'Fees & Payments', complaints: 'Complaints',
  announcements: 'Announcements', reports: 'Reports', laundry: 'Laundry', visitors: 'Visitors',
  mess: 'Mess', leave: 'Leave & Outpass', attendance: 'Attendance', parcels: 'Parcels',
  staff: 'Staff', guardians: 'Guardians', disciplinary: 'Disciplinary', analytics: 'Analytics',
};

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'approve', 'export'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModuleAccess = Record<PermissionAction, boolean>;
export type PermissionMatrix = Record<RoleTemplate, Record<PermissionModule, ModuleAccess>>;

/** Modules a Maintenance role can never be granted (financial and sensitive records). */
export const MAINTENANCE_BLOCKED: PermissionModule[] = ['fees', 'disciplinary'];

export const OUTPASS_APPROVERS = ['Owner', 'Warden'] as const;
export type OutpassApprover = (typeof OUTPASS_APPROVERS)[number];

export interface ApprovalLimits {
  /** Largest refund (₹) that can be issued without the Owner. */
  refundMax: number;
  /** Largest fee adjustment / waiver (₹) a delegate may apply. */
  feeAdjustmentMax: number;
  attendanceCorrectionNeedsApproval: boolean;
  outpassApprover: OutpassApprover;
}

export const DEFAULT_LIMITS: ApprovalLimits = {
  refundMax: 5000,
  feeAdjustmentMax: 2000,
  attendanceCorrectionNeedsApproval: true,
  outpassApprover: 'Warden',
};

/** Per role export switch; the Owner is always allowed. */
export type ExportControls = Record<RoleTemplate, boolean>;

export const DEFAULT_EXPORT_CONTROLS: ExportControls = {
  Warden: true,
  Accountant: true,
  Security: false,
  Maintenance: false,
  'Mess Manager': false,
};

export interface ExportLogEntry {
  id: string;
  at: string;
  by: string;
  what: string;
}

export const LIMIT_LABELS: Record<keyof ApprovalLimits, string> = {
  refundMax: 'Refund maximum (₹)',
  feeAdjustmentMax: 'Fee adjustment maximum (₹)',
  attendanceCorrectionNeedsApproval: 'Attendance correction needs approval',
  outpassApprover: 'Outpass approver',
};
