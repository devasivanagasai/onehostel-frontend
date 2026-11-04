import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ResidentsService } from './residents.service';
import { RoomsService } from './rooms.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { RoomType } from '../models/rooms.models';
import {
  ACTIVE_TRANSFER_STATUSES,
  RoomTransferRequest,
  TRANSFER_MAX_DAYS_AHEAD,
  TRANSFER_NOTE_MAX,
  TRANSFER_REASON_MAX,
  TRANSFER_REASON_MIN,
  TransferEligibility,
  TransferEvent,
  TransferInput,
  TransferStatus,
} from '../models/tenant-room-transfer.models';
import { localDateIso } from '../../shared/utils/local-date';

const STORAGE_KEY = 'onehostel_tenant_room_transfers_v1';
const ROOM_TYPES: RoomType[] = ['Single', 'Double', 'Triple', 'Four Sharing', 'Dormitory'];

const pad = (n: number): string => String(n).padStart(2, '0');
const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateIso(d);
};

function seed(): RoomTransferRequest[] {
  const ev = (at: string, by: TransferEvent['by'], action: string, note?: string): TransferEvent => ({ at, by, action, note });
  return [
    {
      id: 'RT000001', residentId: 'RES000001', fromLabel: 'Block A · Room 101 · Bed B1', preferredRoomType: 'Single', reason: 'The room is very noisy at night because it faces the main road.',
      requestedDate: '2026-09-20', status: 'Rejected', decisionRemark: 'No single room is free this term. You can request again next month.', decidedAt: '2026-09-12T15:00:00', createdAt: '2026-09-10T09:30:00',
      history: [ev('2026-09-10T09:30:00', 'Tenant', 'Request submitted'), ev('2026-09-11T10:00:00', 'Hostel office', 'Review started'), ev('2026-09-12T15:00:00', 'Hostel office', 'Rejected', 'No single room is free this term. You can request again next month.')],
    },
    {
      id: 'RT000002', residentId: 'RES000001', fromLabel: 'Block A · Room 101 · Bed B1', reason: 'I would like to move closer to my study group on another floor.',
      requestedDate: '2026-10-05', status: 'Cancelled', createdAt: '2026-10-01T11:00:00',
      history: [ev('2026-10-01T11:00:00', 'Tenant', 'Request submitted'), ev('2026-10-02T08:00:00', 'Tenant', 'Cancelled by you')],
    },
    {
      id: 'RT000003', residentId: 'RES000002', fromLabel: 'Block A · Room 102', reason: 'Medical reason, need a ground floor room.', requestedDate: '2026-11-20', status: 'Submitted', createdAt: '2026-11-02T10:00:00',
      history: [ev('2026-11-02T10:00:00', 'Tenant', 'Request submitted')],
    },
  ];
}

/**
 * Room transfer requests (FRD 7.4). The Tenant can only ask: the real allocation changes solely when
 * the owner runs `complete()`, which goes through ResidentsService.transfer / RoomsService.
 */
@Injectable({ providedIn: 'root' })
export class TenantRoomTransferService {
  private readonly tenant = inject(TenantContextService);
  private readonly staffAuth = inject(AuthService);
  private readonly residents = inject(ResidentsService);
  private readonly rooms = inject(RoomsService);
  private readonly notices = inject(TenantNotificationService);
  private readonly subject = new BehaviorSubject<RoomTransferRequest[]>(this.load());

  readonly roomTypes: RoomType[] = ROOM_TYPES;
  readonly limits = { reasonMin: TRANSFER_REASON_MIN, reasonMax: TRANSFER_REASON_MAX, noteMax: TRANSFER_NOTE_MAX, maxDaysAhead: TRANSFER_MAX_DAYS_AHEAD };

  /** MY requests, newest first. */
  readonly mine$: Observable<RoomTransferRequest[]> = this.subject.pipe(map(() => this.mine));
  /** My current room (read-only), refreshed when rooms or my record change. */
  readonly current$ = combineLatest([this.rooms.rooms$, this.tenant.resident$]).pipe(map(() => this.current));

  get mine(): RoomTransferRequest[] {
    const me = this.tenant.residentId;
    return me ? this.subject.value.filter((r) => r.residentId === me).map((r) => this.copy(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : [];
  }

  get active(): RoomTransferRequest | undefined {
    return this.mine.find((r) => ACTIVE_TRANSFER_STATUSES.includes(r.status));
  }

  /** Current room and bed, read from the room records. */
  get current(): { label: string; roomType: RoomType; since?: string } | undefined {
    const a = this.tenant.allocation;
    return a ? { label: this.labelOf(a.room.building, a.room.roomNumber, a.bed.bedNumber), roomType: a.room.roomType, since: a.bed.joinedDate } : undefined;
  }

  /** Can this Tenant raise a request right now? */
  eligibility(): TransferEligibility {
    const r = this.tenant.resident;
    if (!r) return { ok: false, reason: 'Your resident record was not found. Contact your hostel office.' };
    if (r.status === 'Checked Out') return { ok: false, reason: 'You have checked out, so a room transfer is not possible.' };
    if (r.status === 'Suspended') return { ok: false, reason: 'Your stay is suspended. Contact your hostel office.' };
    if (r.deactivatedAt) return { ok: false, reason: 'Your resident record is deactivated.' };
    if (!this.tenant.allocation) return { ok: false, reason: 'You do not have a bed yet. Ask the hostel office to allocate one first.' };
    const open = this.active;
    if (open) return { ok: false, reason: `You already have an open request (${open.id}, ${open.status}). Cancel it or wait for a decision.` };
    return { ok: true, reason: '' };
  }

  /** Per-field problems with the form (empty object = valid). */
  validate(input: TransferInput): Record<string, string> {
    const e: Record<string, string> = {};
    const reason = (input.reason ?? '').trim();
    if (reason.length < TRANSFER_REASON_MIN) e['reason'] = `Give a reason of at least ${TRANSFER_REASON_MIN} characters.`;
    else if (reason.length > TRANSFER_REASON_MAX) e['reason'] = `Keep the reason within ${TRANSFER_REASON_MAX} characters.`;
    const today = localDateIso();
    if (!input.requestedDate) e['requestedDate'] = 'Choose the date you want to move.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate) || Number.isNaN(new Date(`${input.requestedDate}T00:00:00`).getTime())) e['requestedDate'] = 'Enter a valid date.';
    else if (input.requestedDate < today) e['requestedDate'] = 'The date cannot be in the past.';
    else if (input.requestedDate > addDays(today, TRANSFER_MAX_DAYS_AHEAD)) e['requestedDate'] = `Choose a date within the next ${TRANSFER_MAX_DAYS_AHEAD} days.`;
    if (input.preferredRoomType && !ROOM_TYPES.includes(input.preferredRoomType)) e['preferredRoomType'] = 'Choose one of the listed room types.';
    if ((input.note ?? '').trim().length > TRANSFER_NOTE_MAX) e['note'] = `Keep the note within ${TRANSFER_NOTE_MAX} characters.`;
    return e;
  }

  submit(input: TransferInput): RoomTransferRequest {
    const me = this.tenant.requireResidentId();
    const gate = this.eligibility();
    if (!gate.ok) throw new Error(gate.reason);
    const errors = this.validate(input);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const now = nowIso();
    const req: RoomTransferRequest = {
      id: `RT${String(this.subject.value.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0) + 1).padStart(6, '0')}`,
      residentId: me,
      fromLabel: this.current?.label ?? '',
      preferredRoomType: input.preferredRoomType ? (input.preferredRoomType as RoomType) : undefined,
      reason: input.reason.trim(),
      requestedDate: input.requestedDate,
      note: input.note?.trim() || undefined,
      status: 'Submitted',
      createdAt: now,
      history: [{ at: now, by: 'Tenant', action: 'Request submitted' }],
    };
    this.save([req, ...this.subject.value]);
    this.notices.push(me, { category: 'Transfer', title: 'Room transfer request sent', body: `Request ${req.id} was sent to the hostel office.`, route: '/my/room-transfer' });
    return this.copy(req);
  }

  /** Cancel MY request while it is Submitted or Under Review. */
  cancel(id: string): RoomTransferRequest {
    const me = this.tenant.requireResidentId();
    const r = this.subject.value.find((x) => x.id === id);
    if (!r || r.residentId !== me) throw new Error('Request not found.');
    if (!ACTIVE_TRANSFER_STATUSES.includes(r.status)) throw new Error(`A ${r.status.toLowerCase()} request cannot be cancelled.`);
    return this.change(r, 'Cancelled', 'Tenant', 'Cancelled by you');
  }

  // ---- Owner side ---------------------------------------------------------------------

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.staffAuth.isHostelOwner || this.staffAuth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  startReview(id: string): RoomTransferRequest {
    this.requireStaff();
    const r = this.require(id);
    if (r.status !== 'Submitted') throw new Error('Only a submitted request can be moved to review.');
    const next = this.change(r, 'Under Review', 'Hostel office', 'Review started');
    this.notices.push(r.residentId, { category: 'Transfer', title: 'Transfer request under review', body: `Request ${r.id} is being reviewed.`, route: '/my/room-transfer' });
    return next;
  }

  decide(id: string, decision: 'Approved' | 'Rejected', remark?: string): RoomTransferRequest {
    this.requireStaff();
    const r = this.require(id);
    if (decision !== 'Approved' && decision !== 'Rejected') throw new Error('Choose Approved or Rejected.');
    if (!ACTIVE_TRANSFER_STATUSES.includes(r.status)) throw new Error('This request has already been decided.');
    const note = remark?.trim() ?? '';
    if (decision === 'Rejected' && !note) throw new Error('A remark is required when rejecting.');
    const next = this.change(r, decision, 'Hostel office', note || undefined, { decisionRemark: note || undefined, decidedAt: nowIso() });
    this.notices.push(r.residentId, {
      category: 'Transfer',
      title: `Transfer request ${decision.toLowerCase()}`,
      body: decision === 'Approved' ? `Request ${r.id} was approved. The office will confirm your new room.` : `Request ${r.id} was not approved. Open it to read the remark.`,
      route: '/my/room-transfer',
    });
    return next;
  }

  /** Beds the owner can move a Tenant into (read-only helper). */
  availableBeds(): { roomId: string; bedId: string; label: string; roomType: RoomType }[] {
    this.requireStaff();
    return this.rooms.rooms
      .filter((room) => room.status !== 'Maintenance' && room.status !== 'Inactive')
      .flatMap((room) => room.beds.filter((b) => b.status === 'Available').map((b) => ({ roomId: room.id, bedId: b.id, label: this.labelOf(room.building, room.roomNumber, b.bedNumber), roomType: room.roomType })));
  }

  /** Moves the Tenant through the real transfer path. The only place an allocation changes because of a request. */
  complete(id: string, roomId: string, bedId: string): RoomTransferRequest {
    this.requireStaff();
    const r = this.require(id);
    if (r.status !== 'Approved') throw new Error('Only an approved request can be completed.');
    this.residents.transfer(r.residentId, roomId, bedId, localDateIso(), `Tenant request ${r.id}`);
    const a = this.residents.allocationFor(r.residentId);
    const toLabel = a ? this.labelOf(a.room.building, a.room.roomNumber, a.bed.bedNumber) : undefined;
    const next = this.change(r, 'Completed', 'Hostel office', toLabel ? `Moved to ${toLabel}` : 'Move completed', { toLabel, completedAt: nowIso() });
    this.notices.push(r.residentId, { category: 'Transfer', title: 'Room transfer completed', body: toLabel ? `You have been moved to ${toLabel}.` : 'Your room transfer is complete.', route: '/my/hostel' });
    return next;
  }

  // ---- internals ----------------------------------------------------------------------

  private labelOf(building: string, room: string, bed: string): string {
    return `${building} · Room ${room} · Bed ${bed}`;
  }

  private require(id: string): RoomTransferRequest {
    const r = this.subject.value.find((x) => x.id === id);
    if (!r) throw new Error('Request not found.');
    return r;
  }

  private change(r: RoomTransferRequest, status: TransferStatus, by: TransferEvent['by'], note?: string, extra: Partial<RoomTransferRequest> = {}): RoomTransferRequest {
    const next: RoomTransferRequest = { ...r, ...extra, status, history: [...r.history, { at: nowIso(), by, action: status === 'Under Review' ? 'Review started' : status, note }] };
    this.save(this.subject.value.map((x) => (x.id === r.id ? next : x)));
    return this.copy(next);
  }

  private copy(r: RoomTransferRequest): RoomTransferRequest {
    return { ...r, history: r.history.map((h) => ({ ...h })) };
  }

  private save(list: RoomTransferRequest[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* kept in memory */
    }
  }

  private load(): RoomTransferRequest[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as RoomTransferRequest[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* use seed */
    }
    return seed();
  }
}
