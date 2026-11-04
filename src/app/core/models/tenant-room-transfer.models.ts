import { RoomType } from './rooms.models';

export const TRANSFER_STATUSES = ['Submitted', 'Under Review', 'Approved', 'Rejected', 'Cancelled', 'Completed'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** A request that is still waiting on the owner. Only one may exist at a time. */
export const ACTIVE_TRANSFER_STATUSES: TransferStatus[] = ['Submitted', 'Under Review'];

export const TRANSFER_REASON_MIN = 10;
export const TRANSFER_REASON_MAX = 500;
export const TRANSFER_NOTE_MAX = 300;
export const TRANSFER_MAX_DAYS_AHEAD = 90;

export interface TransferEvent {
  at: string;
  by: 'Tenant' | 'Hostel office' | 'System';
  action: string;
  note?: string;
}

export interface RoomTransferRequest {
  /** RT000001 */
  id: string;
  residentId: string;
  /** Room and bed at the time of the request, e.g. "Block A · Room 101 · Bed B1". */
  fromLabel: string;
  preferredRoomType?: RoomType;
  reason: string;
  /** yyyy-mm-dd */
  requestedDate: string;
  note?: string;
  status: TransferStatus;
  decisionRemark?: string;
  decidedAt?: string;
  /** Set when the owner completes the move. */
  toLabel?: string;
  completedAt?: string;
  createdAt: string;
  history: TransferEvent[];
}

export interface TransferInput {
  preferredRoomType?: RoomType | '';
  reason: string;
  requestedDate: string;
  note?: string;
}

export interface TransferEligibility {
  ok: boolean;
  /** Why the form is blocked (empty when ok). */
  reason: string;
}
