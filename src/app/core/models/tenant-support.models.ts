// Tenant Help & Support tickets (FRD 5.9) and the attachment rules Tenant forms share.

export const SUPPORT_TOPICS = ['Login', 'Payment', 'Room', 'Facilities', 'Complaints', 'Other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_STATUSES = ['Submitted', 'In Progress', 'Waiting for Resident', 'Resolved', 'Closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Status text shown to the Tenant ("Resident" is "Tenant" in the UI). */
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  Submitted: 'Submitted',
  'In Progress': 'In Progress',
  'Waiting for Resident': 'Waiting for You',
  Resolved: 'Resolved',
  Closed: 'Closed',
};

export const SUPPORT_STATUS_TONES: Record<SupportStatus, string> = {
  Submitted: 'info',
  'In Progress': 'warning',
  'Waiting for Resident': 'danger',
  Resolved: 'success',
  Closed: 'neutral',
};

export const SUBJECT_MIN = 5;
export const SUBJECT_MAX = 100;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

/** Attachment rules: JPG / PNG / PDF, up to 5 MB each, at most 3 per entry. Only name, type and size are kept. */
export const TENANT_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const TENANT_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
export const TENANT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TENANT_ATTACHMENT_MAX_COUNT = 3;

export interface TenantAttachmentMeta {
  name: string;
  type: string;
  size: number;
}

export const formatFileSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Checks one attachment's metadata; returns an error message or ''. */
export function attachmentError(a: TenantAttachmentMeta): string {
  if (!a.name?.trim()) return 'Attachment has no name.';
  if (!TENANT_ATTACHMENT_TYPES.includes(a.type)) return `${a.name}: use a JPG, PNG or PDF file.`;
  if (!(a.size > 0)) return `${a.name}: the file is empty.`;
  if (a.size > TENANT_ATTACHMENT_MAX_BYTES) return `${a.name}: larger than 5 MB.`;
  return '';
}

/** Checks a whole list (count + each file). Throws with a clear message. */
export function assertAttachments(list: TenantAttachmentMeta[]): void {
  if (list.length > TENANT_ATTACHMENT_MAX_COUNT) throw new Error(`Attach at most ${TENANT_ATTACHMENT_MAX_COUNT} files.`);
  for (const a of list) {
    const e = attachmentError(a);
    if (e) throw new Error(e);
  }
}

/** Picks files from an <input type=file>: accepted metadata plus a message for anything rejected. */
export function pickAttachments(files: FileList | null, already: TenantAttachmentMeta[]): { added: TenantAttachmentMeta[]; error: string } {
  const errors: string[] = [];
  const added: TenantAttachmentMeta[] = [];
  for (const f of Array.from(files ?? [])) {
    if (already.length + added.length >= TENANT_ATTACHMENT_MAX_COUNT) {
      errors.push(`Up to ${TENANT_ATTACHMENT_MAX_COUNT} files.`);
      break;
    }
    const meta = { name: f.name, type: f.type, size: f.size };
    const e = attachmentError(meta);
    if (e) errors.push(e);
    else added.push(meta);
  }
  return { added, error: errors.join(' ') };
}

export interface SupportMessage {
  id: string;
  at: string;
  /** Who wrote it. Past messages are never edited. */
  author: 'Tenant' | 'Hostel';
  /** Display name: "You" for the Tenant, "Hostel office" for staff. */
  by: string;
  text: string;
  attachments: TenantAttachmentMeta[];
}

export interface SupportTicket {
  /** SUP000001 */
  id: string;
  residentId: string;
  topic: SupportTopic;
  subject: string;
  description: string;
  attachments: TenantAttachmentMeta[];
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  /** Oldest first. */
  messages: SupportMessage[];
}

export interface NewSupportTicketInput {
  topic: SupportTopic;
  subject: string;
  description: string;
  attachments: TenantAttachmentMeta[];
}
