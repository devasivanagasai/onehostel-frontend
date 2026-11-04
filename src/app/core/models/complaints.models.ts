// Complaints & Maintenance (Section 4.5).

export const COMPLAINT_CATEGORIES = ['Plumbing', 'Electrical', 'Cleaning', 'Wi-Fi', 'Furniture', 'Other'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** Material icon per category. */
export const CATEGORY_ICONS: Record<ComplaintCategory, string> = {
  Plumbing: 'plumbing',
  Electrical: 'bolt',
  Cleaning: 'cleaning_services',
  'Wi-Fi': 'wifi',
  Furniture: 'chair',
  Other: 'report_problem',
};

export const COMPLAINT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const COMPLAINT_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed', 'Reopened'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Status → shared status-badge tone. */
export const STATUS_TONES: Record<ComplaintStatus, string> = {
  Open: 'warning',
  'In Progress': 'info',
  Reopened: 'danger',
  Resolved: 'success',
  Closed: 'neutral',
};

/** Policy: a resolved complaint can be reopened within this many days. Closed complaints are final. */
export const REOPEN_WINDOW_DAYS = 7;

/** Attachment limits (photos and documents). */
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 4;

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

/** Configured maintenance staff (hostel settings). */
export const STAFF: StaffMember[] = [
  { id: 'STF01', name: 'Ravi Kumar', role: 'Plumber' },
  { id: 'STF02', name: 'Suresh Babu', role: 'Electrician' },
  { id: 'STF03', name: 'Lakshmi Devi', role: 'Housekeeping' },
  { id: 'STF04', name: 'Arjun Rao', role: 'IT / Wi-Fi' },
  { id: 'STF05', name: 'Mahesh Gowda', role: 'Carpenter' },
  { id: 'STF06', name: 'Prakash Reddy', role: 'Warden' },
];

/** The staff role that usually handles each category — used to suggest an assignee. */
export const CATEGORY_DEFAULT_STAFF: Record<ComplaintCategory, string> = {
  Plumbing: 'STF01',
  Electrical: 'STF02',
  Cleaning: 'STF03',
  'Wi-Fi': 'STF04',
  Furniture: 'STF05',
  Other: 'STF06',
};

export interface ComplaintAttachment {
  id: string;
  name: string;
  type: string;
  /** Data URL (mock build) or remote URL. */
  url: string;
}

export type ComplaintEventType = 'created' | 'assigned' | 'status' | 'note' | 'resolved' | 'notified' | 'priority';

/** One entry of the complaint's history (newest first). Assignment / status / resolution events are timestamped. */
export interface ComplaintEvent {
  at: string;
  type: ComplaintEventType;
  by: string;
  text: string;
  attachments?: ComplaintAttachment[];
}

export interface Complaint {
  /** e.g. CMP000001 */
  id: string;
  residentId: string;
  residentName: string;
  /** Room / bed at the time of the complaint, e.g. "Room 101 · Bed B1". */
  location?: string;
  category: ComplaintCategory;
  title: string;
  description: string;
  attachments: ComplaintAttachment[];
  priority: ComplaintPriority;
  /** Staff id; undefined = Unassigned. */
  assignedTo?: string;
  /** ISO date-time. */
  createdAt: string;
  /** ISO date; optional target resolution. */
  targetDate?: string;
  status: ComplaintStatus;
  /** Where it came from. */
  source: 'Resident App' | 'Admin';
  resolvedAt?: string;
  resolutionNote?: string;
  closedAt?: string;
  reopenCount: number;
  updatedAt: string;
  history: ComplaintEvent[];
}

export const staffById = (id?: string): StaffMember | undefined => STAFF.find((s) => s.id === id);

export const staffLabel = (id?: string): string => {
  const s = staffById(id);
  return s ? `${s.name} (${s.role})` : 'Unassigned';
};

export const isActive = (c: Pick<Complaint, 'status'>): boolean =>
  c.status === 'Open' || c.status === 'In Progress' || c.status === 'Reopened';
