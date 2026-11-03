// Staff Management (FRD 6.1).
import { RoleTemplate } from './permissions.models';

export const STAFF_CATEGORIES = ['Security', 'Housekeeping', 'Maintenance', 'Mess', 'Warden', 'Other'] as const;
export type StaffCategory = (typeof STAFF_CATEGORIES)[number];

export const STAFF_STATUSES = ['Active', 'Inactive', 'On Leave'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_TONES: Record<StaffStatus, string> = { Active: 'success', Inactive: 'neutral', 'On Leave': 'warning' };

/** "None" = no system access template. */
export type StaffRole = RoleTemplate | 'None';

export const DUTY_OPTIONS = [
  'Gate duty', 'Visitor log', 'Night patrol', 'Room cleaning', 'Common areas', 'Laundry handling',
  'Plumbing', 'Electrical', 'General repairs', 'Cooking', 'Serving meals', 'Kitchen hygiene',
  'Front desk', 'Attendance', 'Resident queries', 'Fee collection', 'Record keeping',
] as const;

export const TASK_STATUSES = ['Open', 'In Progress', 'Done', 'Cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_TONES: Record<TaskStatus, string> = { Open: 'info', 'In Progress': 'warning', Done: 'success', Cancelled: 'neutral' };
export const PRIORITY_TONES: Record<TaskPriority, string> = { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'danger' };

/** Forward-only: a finished or cancelled task stays that way. */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Open: ['In Progress', 'Done', 'Cancelled'],
  'In Progress': ['Done', 'Cancelled'],
  Done: [],
  Cancelled: [],
};

export interface StaffShift {
  name: string;
  /** HH:mm */
  start: string;
  end: string;
}

export interface StaffEvent {
  at: string;
  by: string;
  action: string;
  note?: string;
}

export interface Staff {
  /** Sequential, e.g. STF000001. */
  id: string;
  hostelId: string;
  name: string;
  mobile: string;
  email?: string;
  category: StaffCategory;
  duties: string[];
  shift?: StaffShift;
  /** yyyy-mm-dd */
  employmentStart: string;
  employmentEnd?: string;
  status: StaffStatus;
  loginAccess: boolean;
  roleTemplate: StaffRole;
  history: StaffEvent[];
}

export interface StaffInput {
  name: string;
  mobile: string;
  email?: string;
  category: StaffCategory;
  duties: string[];
  shift?: { name?: string; start?: string; end?: string };
  employmentStart: string;
  employmentEnd?: string;
  status?: StaffStatus;
  loginAccess: boolean;
  roleTemplate: StaffRole;
}

export interface Task {
  /** e.g. TSK000001. */
  id: string;
  hostelId: string;
  title: string;
  description?: string;
  /** yyyy-mm-dd */
  dueDate: string;
  priority: TaskPriority;
  assigneeId: string;
  status: TaskStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  history: StaffEvent[];
}

export interface TaskInput {
  title: string;
  description?: string;
  dueDate: string;
  priority: TaskPriority;
  assigneeId: string;
}

export interface TaskStats {
  open: number;
  inProgress: number;
  done: number;
  overdue: number;
}

export type StaffErrors = Partial<Record<'name' | 'mobile' | 'email' | 'category' | 'duties' | 'shift' | 'employmentStart' | 'employmentEnd' | 'roleTemplate', string>>;
export type TaskErrors = Partial<Record<'title' | 'dueDate' | 'assigneeId', string>>;

export const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
