export const ITEM_KINDS = ['Lost', 'Found'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ['Reported', 'Under Review', 'Matched', 'Returned', 'Closed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Moves the owner may make. Returned and Closed are final. */
export const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  Reported: ['Under Review', 'Closed'],
  'Under Review': ['Matched', 'Returned', 'Closed'],
  Matched: ['Under Review', 'Returned', 'Closed'],
  Returned: [],
  Closed: [],
};

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

export interface ItemEvent {
  at: string;
  action: string;
  note?: string;
}

/** Stored report. The reporter's id is never shown to other Tenants. */
export interface CommunityItem {
  /** LF000001 */
  id: string;
  kind: ItemKind;
  residentId: string;
  /** Lost: required. Found: optional short name. */
  itemName: string;
  description: string;
  /** Lost: where it was lost. Found: where it was found. */
  location: string;
  /** Found only: where it can be collected. */
  handoverLocation?: string;
  /** Local date-time, yyyy-mm-ddTHH:mm */
  occurredAt: string;
  /** File name only. */
  photoName?: string;
  status: ItemStatus;
  moderationNote?: string;
  createdAt: string;
  history: ItemEvent[];
}

export type ClaimStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ItemClaim {
  id: string;
  itemId: string;
  residentId: string;
  explanation: string;
  status: ClaimStatus;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

/** What the Tenant sees for any item: others' items never carry names, contacts or the reporter id. */
export interface CommunityItemView {
  id: string;
  kind: ItemKind;
  mine: boolean;
  itemName: string;
  description: string;
  location: string;
  handoverLocation?: string;
  occurredAt: string;
  photoName?: string;
  status: ItemStatus;
  /** "You" for your own reports, otherwise "Reported by a tenant". */
  reportedBy: string;
  moderationNote?: string;
  canEdit: boolean;
  canWithdraw: boolean;
  canClaim: boolean;
  /** My claim on this item, if any. */
  myClaim?: ItemClaim;
  createdAt: string;
}

export interface ReportInput {
  kind: ItemKind;
  itemName: string;
  description: string;
  location: string;
  handoverLocation?: string;
  occurredAt: string;
  photo?: { name: string; mime: string; size: number } | null;
}

export const CLAIM_MIN = 15;
export const CLAIM_MAX = 500;
