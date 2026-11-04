// Disciplinary Records (Section 6.5). Strictly restricted: nothing here may appear in general lists or notices.

import { AuditChange } from './audit.models';

/** Configured incident categories. */
export const INCIDENT_CATEGORIES = [
  'Noise/Misconduct',
  'Property Damage',
  'Substance Policy',
  'Curfew Violation',
  'Harassment/Bullying',
  'Safety Violation',
  'Other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/** Forward-only review workflow. */
export const REVIEW_STATUSES = ['Reported', 'Under Review', 'Action Recorded', 'Closed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_TONES: Record<ReviewStatus, string> = {
  Reported: 'warning',
  'Under Review': 'info',
  'Action Recorded': 'info',
  Closed: 'neutral',
};

export const ACCESS_CLASSIFICATIONS = ['Restricted', 'Confidential'] as const;
export type AccessClassification = (typeof ACCESS_CLASSIFICATIONS)[number];

/** Field limits. */
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 2000;
export const NOTE_MIN = 10;
export const ACTION_MAX = 1000;

/** Evidence policy: file names + size/type only are kept, never the file bytes. */
export const EVIDENCE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf'] as const;
export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const EVIDENCE_MAX_COUNT = 5;
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/** Shown on the screen: how long records are kept. */
export const RETENTION_NOTE =
  'Retention: disciplinary records are kept for 3 years after the resident checks out, then reviewed for secure deletion. Access is limited to the Hostel Owner and every view is audited.';

export interface EvidenceFile {
  name: string;
  /** Bytes. */
  size: number;
  type: string;
}

export type IncidentEventType = 'created' | 'status' | 'edited' | 'corrected' | 'viewed';

/** Append-only timeline entry. */
export interface IncidentEvent {
  /** Local date-time (yyyy-mm-ddTHH:mm:ss). */
  at: string;
  by: string;
  type: IncidentEventType;
  text: string;
  /** Before / after for edits and corrections (changes to long text show only that it changed). */
  changes?: AuditChange[];
}

export interface Incident {
  /** INC000001 */
  id: string;
  residentId: string;
  /** Name when the incident was recorded (kept if the resident is later removed). */
  residentName: string;
  /** Local date-time (yyyy-mm-ddTHH:mm). */
  occurredAt: string;
  category: IncidentCategory;
  description: string;
  reportedBy: string;
  evidence: EvidenceFile[];
  actionTaken?: string;
  status: ReviewStatus;
  classification: AccessClassification;
  closingNote?: string;
  createdAt: string;
  updatedAt: string;
  history: IncidentEvent[];
}

export type IncidentInput = Pick<Incident, 'residentId' | 'occurredAt' | 'category' | 'description' | 'classification'> &
  Partial<Pick<Incident, 'evidence' | 'actionTaken'>>;

/** Editable fields (status moves only through advance()). */
export type IncidentPatch = Partial<IncidentInput & Pick<Incident, 'closingNote'>>;

export const FIELD_LABELS: Record<string, string> = {
  residentId: 'Resident ID',
  occurredAt: 'Incident date/time',
  category: 'Category',
  description: 'Description',
  classification: 'Access classification',
  actionTaken: 'Action taken',
  closingNote: 'Closing note',
  evidence: 'Evidence files',
};

/** Fields whose text is never copied into the audit trail. */
export const LONG_TEXT_FIELDS = new Set(['description', 'actionTaken', 'closingNote']);

/** Checks files against the evidence policy; returns one message per problem (empty = OK). */
export function evidenceErrors(incoming: EvidenceFile[], existingCount = 0): string[] {
  const errors: string[] = [];
  if (existingCount + incoming.length > EVIDENCE_MAX_COUNT) {
    errors.push(`At most ${EVIDENCE_MAX_COUNT} evidence files are allowed (${existingCount} already attached).`);
  }
  for (const f of incoming) {
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
    if (!(EVIDENCE_EXTENSIONS as readonly string[]).includes(ext) || (f.type && !EVIDENCE_TYPES.includes(f.type))) {
      errors.push(`"${f.name}" is not allowed — only JPG, PNG or PDF files can be attached.`);
    } else if (f.size > EVIDENCE_MAX_BYTES) {
      errors.push(`"${f.name}" is larger than ${EVIDENCE_MAX_BYTES / 1024 / 1024} MB.`);
    } else if (f.size <= 0) {
      errors.push(`"${f.name}" is empty.`);
    }
  }
  return errors;
}

export const fileSizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Local wall-clock date-time to the minute: yyyy-mm-ddTHH:mm (hostel-local, not UTC). */
export function localMinute(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const INCIDENT_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
