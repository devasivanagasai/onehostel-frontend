import { localDateIso } from '../../../shared/utils/local-date';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<string, Tone> = {
  Verified: 'success', Active: 'success', Approved: 'success', Completed: 'success', Successful: 'success', Returned: 'success', Matched: 'success', Open: 'success', Submitted: 'info',
  Collected: 'success', Acknowledged: 'success', Pending: 'warning', 'Pending Review': 'warning', 'Under Review': 'warning', Reported: 'info', Unverified: 'neutral', Closed: 'neutral',
  Cancelled: 'neutral', Withdrawn: 'neutral', Rejected: 'danger', Revoked: 'danger', Failed: 'danger', Expired: 'danger', Declined: 'danger', Overdue: 'danger',
  Resolved: 'success', 'In Progress': 'info', Reopened: 'danger', Confirmed: 'info', Requested: 'warning', 'No-show': 'neutral', Expected: 'info', 'Checked In': 'info', 'Checked Out': 'neutral',
  'Awaiting Pickup': 'warning', Out: 'info', 'Overdue return': 'danger', Reversed: 'neutral', Refunded: 'info', Current: 'success', Previous: 'neutral',
};

export const toneOf = (status: string): Tone => TONES[status] ?? 'neutral';

export const errMsg = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local wall-clock date-time, yyyy-mm-ddTHH:mm. */
export const nowLocalMinute = (d: Date = new Date()): string => `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${fmtDate(iso)}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

export const fmtMoney = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

export const fmtBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
