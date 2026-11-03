import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { RoomsService } from './rooms.service';
import { localDateIso } from '../../shared/utils/local-date';
import { Bed, Room } from '../models/rooms.models';
import {
  HostelResident,
  ResidentActivity,
  ResidentInput,
  ResidentStatus,
  formatMobile,
  residentFullName,
} from '../models/residents.models';

const STORAGE_KEY = 'onehostel_residents_v1';

export interface ResidentAllocation {
  room: Room;
  bed: Bed;
}

export interface ResidentStats {
  total: number;
  active: number;
  invited: number;
  onLeave: number;
  unallocated: number;
  outstanding: number;
}

const avatar = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=120&q=80`;

const act = (at: string, action: string, icon: string, details?: string): ResidentActivity => ({ at, action, icon, details });

/** Seed data. RES000001–RES000007 match the beds seeded in RoomsService. */
const SEED_RESIDENTS: HostelResident[] = [
  {
    residentId: 'RES000001', firstName: 'Rahul', lastName: 'Sharma', gender: 'Male', dateOfBirth: '2005-03-14',
    mobileCode: '+91', mobile: '9887766554', email: 'rahul.sharma@gmail.com', photoUrl: avatar('photo-1535713875002-d1d0cf377fde'),
    permanentAddress: '12 MG Road, Jaipur, Rajasthan', emergencyContactName: 'Suresh Sharma', emergencyContactMobile: '9887700011',
    residentType: 'College Student', collegeOrCompany: 'Engineering Institute', joiningDate: '2026-08-01', expectedCheckoutDate: '2027-05-31',
    status: 'Active', outstandingBalance: 0,
    documents: [{ id: 'DOC-1', type: 'Aadhaar Card', fileName: 'aadhaar_rahul.pdf', status: 'Verified', uploadedAt: '2026-07-28' }],
    createdAt: '2026-07-28T10:00:00', updatedAt: '2026-08-01T09:30:00',
    activity: [
      act('2026-08-01T09:30:00', 'Bed allocated', 'bed', 'Room 101 · Bed B1'),
      act('2026-07-29T18:10:00', 'Account activated', 'verified_user'),
      act('2026-07-28T10:00:00', 'Resident created', 'person_add'),
    ],
  },
  {
    residentId: 'RES000002', firstName: 'Aman', lastName: 'Verma', gender: 'Male',
    mobileCode: '+91', mobile: '9123456780', email: 'aman.verma@outlook.com', photoUrl: avatar('photo-1570295999919-56ceb5ecca61'),
    emergencyContactName: 'Kiran Verma', emergencyContactMobile: '9123400022',
    residentType: 'Working Professional', collegeOrCompany: 'Tech Corp', joiningDate: '2026-08-15',
    status: 'Active', outstandingBalance: 3500, documents: [],
    createdAt: '2026-08-12T11:00:00', updatedAt: '2026-08-15T10:00:00',
    activity: [
      act('2026-08-15T10:00:00', 'Bed allocated', 'bed', 'Room 101 · Bed B2'),
      act('2026-08-13T08:45:00', 'Account activated', 'verified_user'),
      act('2026-08-12T11:00:00', 'Resident created', 'person_add'),
    ],
  },
  {
    residentId: 'RES000003', firstName: 'Vivek', lastName: 'Singh', gender: 'Male',
    mobileCode: '+91', mobile: '9776655443', email: 'vivek.singh@gmail.com', photoUrl: avatar('photo-1507003211169-0a1dd7228f2d'),
    residentType: 'College Student', collegeOrCompany: 'Commerce College', joiningDate: '2026-07-10',
    status: 'Active', outstandingBalance: 0, documents: [],
    createdAt: '2026-07-08T09:00:00', updatedAt: '2026-07-10T09:00:00',
    activity: [act('2026-07-10T09:00:00', 'Bed allocated', 'bed', 'Room 201 · Bed B1'), act('2026-07-08T09:00:00', 'Resident created', 'person_add')],
  },
  {
    residentId: 'RES000004', firstName: 'Rohit', lastName: 'Patel', gender: 'Male',
    mobileCode: '+91', mobile: '9882233445', email: 'rohit.patel@gmail.com', photoUrl: avatar('photo-1500648767791-00dcc994a43e'),
    residentType: 'Regular', joiningDate: '2026-07-12',
    status: 'On Leave', outstandingBalance: 7000, documents: [],
    notes: 'Away for family function until 25 Oct.',
    createdAt: '2026-07-10T12:00:00', updatedAt: '2026-10-10T08:00:00',
    activity: [
      act('2026-10-10T08:00:00', 'Status changed', 'edit_note', 'Active → On Leave'),
      act('2026-07-12T10:00:00', 'Bed allocated', 'bed', 'Room 201 · Bed B2'),
      act('2026-07-10T12:00:00', 'Resident created', 'person_add'),
    ],
  },
  {
    residentId: 'RES000005', firstName: 'Sahil', lastName: 'Khan', gender: 'Male',
    mobileCode: '+91', mobile: '9771122334', email: 'sahil.khan@gmail.com', photoUrl: avatar('photo-1492562080023-ab3db95bfbce'),
    residentType: 'College Student', collegeOrCompany: 'Medical College', joiningDate: '2026-07-15',
    status: 'Active', outstandingBalance: 0, documents: [],
    createdAt: '2026-07-14T12:00:00', updatedAt: '2026-07-15T10:00:00',
    activity: [act('2026-07-15T10:00:00', 'Bed allocated', 'bed', 'Room 201 · Bed B3'), act('2026-07-14T12:00:00', 'Resident created', 'person_add')],
  },
  {
    residentId: 'RES000006', firstName: 'Sagar', lastName: 'Gupta', gender: 'Male',
    mobileCode: '+91', mobile: '9811223344', email: 'sagar.gupta@gmail.com', photoUrl: avatar('photo-1522075469751-3a6694fb2f61'),
    residentType: 'Working Professional', collegeOrCompany: 'FinServe Pvt Ltd', joiningDate: '2026-09-20',
    status: 'Active', outstandingBalance: 1200, documents: [],
    createdAt: '2026-09-18T12:00:00', updatedAt: '2026-09-20T10:00:00',
    activity: [act('2026-09-20T10:00:00', 'Bed allocated', 'bed', 'Room 203 · Bed B1'), act('2026-09-18T12:00:00', 'Resident created', 'person_add')],
  },
  {
    residentId: 'RES000007', firstName: 'Mohit', lastName: 'Yadav', gender: 'Male',
    mobileCode: '+91', mobile: '9899122334', email: 'mohit.yadav@gmail.com', photoUrl: avatar('photo-1519085360753-af0119f7cbe7'),
    residentType: 'College Student', collegeOrCompany: 'Engineering Institute', joiningDate: '2026-09-22',
    status: 'Active', outstandingBalance: 0, documents: [],
    createdAt: '2026-09-21T12:00:00', updatedAt: '2026-09-22T10:00:00',
    activity: [act('2026-09-22T10:00:00', 'Bed allocated', 'bed', 'Room 203 · Bed B2'), act('2026-09-21T12:00:00', 'Resident created', 'person_add')],
  },
  {
    residentId: 'RES000008', firstName: 'Sneha', lastName: 'Patel', gender: 'Female',
    mobileCode: '+91', mobile: '9988776655', email: 'sneha.patel@gmail.com',
    residentType: 'College Student', collegeOrCompany: 'Medical College', joiningDate: '2026-10-20',
    status: 'Invited', outstandingBalance: 0, documents: [], inviteSentAt: '2026-10-14T11:05:00',
    createdAt: '2026-10-14T11:00:00', updatedAt: '2026-10-14T11:05:00',
    activity: [
      act('2026-10-14T11:05:00', 'Activation invite sent', 'send', 'SMS & Email'),
      act('2026-10-14T11:00:00', 'Resident created', 'person_add'),
    ],
  },
  {
    residentId: 'RES000009', firstName: 'Kunal', lastName: 'Deshmukh', gender: 'Male',
    mobileCode: '+91', mobile: '9822334455', email: 'kunal.d@gmail.com',
    residentType: 'Regular', joiningDate: '2026-10-18',
    status: 'Invited', outstandingBalance: 0, documents: [],
    createdAt: '2026-10-15T15:20:00', updatedAt: '2026-10-15T15:20:00',
    activity: [act('2026-10-15T15:20:00', 'Resident created', 'person_add')],
  },
  {
    residentId: 'RES000010', firstName: 'Ananya', lastName: 'Iyer', gender: 'Female',
    mobileCode: '+91', mobile: '9845012345', email: 'ananya.iyer@gmail.com',
    residentType: 'College Student', collegeOrCompany: 'Law University', joiningDate: '2026-01-10', checkOutDate: '2026-06-30',
    status: 'Checked Out', outstandingBalance: 0, documents: [],
    createdAt: '2026-01-08T10:00:00', updatedAt: '2026-06-30T17:00:00',
    activity: [
      act('2026-06-30T17:00:00', 'Checked out', 'logout', 'Room 202 · Bed B1 released'),
      act('2026-01-10T10:00:00', 'Bed allocated', 'bed', 'Room 202 · Bed B1'),
      act('2026-01-08T10:00:00', 'Resident created', 'person_add'),
    ],
  },
  {
    residentId: 'RES000011', firstName: 'Deepak', lastName: 'Joshi', gender: 'Male',
    mobileCode: '+91', mobile: '9123488990', email: 'deepak.joshi@gmail.com',
    residentType: 'Regular', joiningDate: '2026-04-01',
    status: 'Suspended', outstandingBalance: 14000, documents: [],
    notes: 'Fee unpaid for 2 months.',
    createdAt: '2026-03-28T10:00:00', updatedAt: '2026-09-05T11:00:00',
    activity: [
      act('2026-09-05T11:00:00', 'Status changed', 'edit_note', 'Active → Suspended'),
      act('2026-03-28T10:00:00', 'Resident created', 'person_add'),
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class ResidentsService {
  private readonly rooms = inject(RoomsService);
  private readonly auditLog = inject(AuditLogService);

  private readonly residentsSubject = new BehaviorSubject<HostelResident[]>(this.load());
  readonly residents$: Observable<HostelResident[]> = this.residentsSubject.asObservable();

  /** Emits whenever residents or bed allocations change. */
  readonly stats$: Observable<ResidentStats> = combineLatest([this.residents$, this.rooms.rooms$]).pipe(
    map(([residents]) => {
      const current = residents.filter((r) => !r.deactivatedAt);
      return {
        total: current.filter((r) => r.status !== 'Checked Out').length,
        active: current.filter((r) => r.status === 'Active').length,
        invited: current.filter((r) => r.status === 'Invited').length,
        onLeave: current.filter((r) => r.status === 'On Leave').length,
        unallocated: current.filter((r) => this.needsBed(r)).length,
        outstanding: current.reduce((sum, r) => sum + (r.outstandingBalance || 0), 0),
      };
    }),
  );

  get residents(): HostelResident[] {
    return this.residentsSubject.value;
  }

  byId(residentId: string): HostelResident | undefined {
    return this.residents.find((r) => r.residentId === residentId);
  }

  /** Current active bed allocation, read from the room/bed records. */
  allocationFor(residentId: string): ResidentAllocation | undefined {
    for (const room of this.rooms.rooms) {
      const bed = room.beds.find((b) => b.residentId === residentId && b.status === 'Occupied');
      if (bed) return { room, bed };
    }
    return undefined;
  }

  /** Residents still expected to get a bed: current, not checked out, and no active allocation. */
  needsBed(r: HostelResident): boolean {
    return !r.deactivatedAt && this.canHoldBed(r.status) && !this.allocationFor(r.residentId);
  }

  canHoldBed(status: ResidentStatus): boolean {
    return status === 'Invited' || status === 'Active' || status === 'On Leave';
  }

  /**
   * Rooms with at least one bed this resident may take: room not under Maintenance/Inactive,
   * bed Available, and the room's gender and college restrictions allow the resident.
   */
  eligibleRooms(r: Pick<HostelResident, 'gender' | 'collegeOrCompany'>): Room[] {
    return this.rooms.rooms.filter(
      (room) =>
        room.status !== 'Maintenance' &&
        room.status !== 'Inactive' &&
        (room.genderRestriction === 'Any' || room.genderRestriction === r.gender) &&
        (!room.collegeRestriction || room.collegeRestriction === 'Any' || room.collegeRestriction === r.collegeOrCompany) &&
        room.beds.some((b) => b.status === 'Available'),
    );
  }

  /** Mobile / email already used by another current (not deactivated) resident. */
  findDuplicate(field: 'mobile' | 'email', value: string, exceptId?: string): HostelResident | undefined {
    const v = value.trim().toLowerCase();
    if (!v) return undefined;
    return this.residents.find(
      (r) => r.residentId !== exceptId && !r.deactivatedAt && (r[field] ?? '').toLowerCase() === v,
    );
  }

  create(input: ResidentInput): HostelResident {
    this.assertUnique(input);
    const now = this.nowIso();
    const resident: HostelResident = {
      ...this.clean(input),
      residentId: this.nextId(),
      status: 'Invited',
      outstandingBalance: 0,
      createdAt: now,
      updatedAt: now,
      activity: [act(now, 'Resident created', 'person_add', 'Status: Invited / Pending Activation')],
    };
    this.commit([resident, ...this.residents]);
    this.auditLog.record('Create Resident', this.auditEntity(resident));
    return resident;
  }

  update(residentId: string, input: ResidentInput): HostelResident {
    const existing = this.require(residentId);
    this.assertUnique(input, residentId);

    // Drop every field the form owns first, so a cleared optional field (email, photo, guardian…) is removed, not kept.
    const base: Record<string, unknown> = { ...existing };
    for (const key of Object.keys(input)) delete base[key];
    const next = { ...base, ...this.clean(input), updatedAt: this.nowIso() } as HostelResident;
    const changed = this.changedFields(existing, next);
    if (existing.status !== next.status) {
      next.activity = [act(next.updatedAt, 'Status changed', 'edit_note', `${existing.status} → ${next.status}`), ...next.activity];
    }
    if (changed.length) {
      next.activity = [act(next.updatedAt, 'Profile updated', 'edit', changed.join(', ')), ...next.activity];
    }
    this.replace(next);
    this.auditLog.record('Update Resident', this.auditEntity(next), { details: changed.join(', ') || undefined });
    return next;
  }

  sendInvite(residentId: string): void {
    const r = this.require(residentId);
    if (r.status !== 'Invited') throw new Error(`${residentFullName(r)} has already activated their account.`);
    const now = this.nowIso();
    const channels = r.email ? 'SMS & Email' : 'SMS';
    this.replace({
      ...r,
      inviteSentAt: now,
      updatedAt: now,
      activity: [act(now, 'Activation invite sent', 'send', channels), ...r.activity],
    });
    this.auditLog.record('Invite Resident', this.auditEntity(r), { details: `Activation link sent via ${channels}.` });
  }

  allocate(residentId: string, roomId: string, bedId: string, date: string, notes?: string, monthlyRent?: number): void {
    const r = this.require(residentId);
    if (date < r.joiningDate) throw new Error(`Allocation date cannot be before the joining date (${r.joiningDate}).`);
    if (r.deactivatedAt || !this.canHoldBed(r.status)) {
      throw new Error(`${residentFullName(r)} is ${r.deactivatedAt ? 'deactivated' : r.status} and cannot be allocated a bed.`);
    }
    const current = this.allocationFor(residentId);
    if (current) {
      throw new Error(`${residentFullName(r)} already holds Room ${current.room.roomNumber} · Bed ${current.bed.bedNumber}. Use Transfer instead.`);
    }

    this.rooms.allocateBed(
      roomId,
      bedId,
      {
        residentId,
        name: residentFullName(r),
        contact: formatMobile(r.mobileCode, r.mobile),
        gender: r.gender === 'Other' ? undefined : r.gender,
        collegeOrCompany: r.collegeOrCompany,
      },
      date,
      notes,
      monthlyRent,
    );
    const where = this.describe(this.allocationFor(residentId));
    this.log(r, 'Bed allocated', 'bed', where);
    this.auditLog.record('Allocate Resident', this.auditEntity(r), { details: `${where} from ${date}.` });
  }

  transfer(residentId: string, targetRoomId: string, targetBedId: string, date: string, reason?: string): void {
    const r = this.require(residentId);
    const from = this.allocationFor(residentId);
    if (!from) throw new Error(`${residentFullName(r)} has no active bed to transfer from.`);

    if (date < r.joiningDate) throw new Error(`Transfer date cannot be before the joining date (${r.joiningDate}).`);

    const fromLabel = this.describe(from);
    this.rooms.transferResident(from.room.id, from.bed.id, targetRoomId, targetBedId, date, reason, {
      gender: r.gender === 'Other' ? undefined : r.gender,
      collegeOrCompany: r.collegeOrCompany,
    });
    const toLabel = this.describe(this.allocationFor(residentId));
    this.log(r, 'Bed transferred', 'swap_horiz', `${fromLabel} → ${toLabel}${reason ? ' · ' + reason : ''}`);
    this.auditLog.record('Transfer Resident', this.auditEntity(r), { details: `${fromLabel} → ${toLabel} effective ${date}.` });
  }

  /** Ends the allocation (if any) and keeps the resident record for history. */
  checkOut(residentId: string, date: string, remarks?: string): void {
    const r = this.require(residentId);
    if (r.status === 'Checked Out') throw new Error(`${residentFullName(r)} is already checked out.`);
    if (date < r.joiningDate) throw new Error('Check-out date cannot be before the joining date.');
    if (date > localDateIso()) throw new Error('Check-out date cannot be in the future.');

    const alloc = this.allocationFor(residentId);
    if (alloc) this.rooms.checkOutResident(alloc.room.id, alloc.bed.id, date, remarks);

    const now = this.nowIso();
    const details = [alloc ? `${this.describe(alloc)} released` : 'No bed held', remarks].filter(Boolean).join(' · ');
    this.replace({
      ...this.require(residentId),
      status: 'Checked Out',
      checkOutDate: date,
      updatedAt: now,
      activity: [act(now, 'Checked out', 'logout', details), ...r.activity],
    });
    this.auditLog.record('Check Out Resident', this.auditEntity(r), { details: `Checked out on ${date}. ${details}` });
  }

  /** Soft deactivation: hides the resident from active lists but keeps their history. */
  deactivate(residentId: string): void {
    const r = this.require(residentId);
    if (this.allocationFor(residentId)) {
      throw new Error(`Check ${residentFullName(r)} out of their bed before deactivating.`);
    }
    const now = this.nowIso();
    this.replace({ ...r, deactivatedAt: now, updatedAt: now, activity: [act(now, 'Deactivated', 'person_off'), ...r.activity] });
    this.auditLog.record('Deactivate Resident', this.auditEntity(r));
  }

  reactivate(residentId: string): void {
    const r = this.require(residentId);
    if (this.findDuplicate('mobile', r.mobile, residentId) || (r.email && this.findDuplicate('email', r.email, residentId))) {
      throw new Error('Another current resident now uses this mobile or email.');
    }
    const now = this.nowIso();
    this.replace({ ...r, deactivatedAt: undefined, updatedAt: now, activity: [act(now, 'Reactivated', 'person'), ...r.activity] });
    this.auditLog.record('Activate Resident', this.auditEntity(r));
  }

  /** Outstanding balances come from the fees ledger (FeesService); only changed values are written. */
  syncBalances(balances: Record<string, number>): void {
    let changed = false;
    const list = this.residents.map((r) => {
      const next = balances[r.residentId] ?? 0;
      if (next === r.outstandingBalance) return r;
      changed = true;
      return { ...r, outstandingBalance: next };
    });
    if (changed) this.commit(list);
  }

  /** Lets the Rooms screen record bed actions in the resident's history. */
  log(r: HostelResident, action: string, icon: string, details?: string): void {
    const latest = this.byId(r.residentId) ?? r;
    const now = this.nowIso();
    this.replace({ ...latest, updatedAt: now, activity: [act(now, action, icon, details), ...latest.activity] });
  }

  describe(alloc: ResidentAllocation | undefined): string {
    return alloc ? `Room ${alloc.room.roomNumber} · Bed ${alloc.bed.bedNumber}` : '—';
  }

  // ---------------------------------------------------------------------------

  private assertUnique(input: ResidentInput, exceptId?: string): void {
    const byMobile = this.findDuplicate('mobile', input.mobile, exceptId);
    if (byMobile) throw new Error(`Mobile number is already registered to ${residentFullName(byMobile)} (${byMobile.residentId}).`);
    const byEmail = input.email ? this.findDuplicate('email', input.email, exceptId) : undefined;
    if (byEmail) throw new Error(`Email is already registered to ${residentFullName(byEmail)} (${byEmail.residentId}).`);
  }

  /** Trims strings and drops empty optional fields. */
  private clean(input: ResidentInput): ResidentInput {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === '' || v === null || v === undefined) continue;
      out[k] = typeof v === 'string' ? v.trim() : v;
    }
    return out as ResidentInput;
  }

  private changedFields(a: HostelResident, b: HostelResident): string[] {
    const labels: Partial<Record<keyof HostelResident, string>> = {
      firstName: 'First name', lastName: 'Last name', dateOfBirth: 'Date of birth', gender: 'Gender',
      mobile: 'Mobile', email: 'Email', photoUrl: 'Photo', permanentAddress: 'Address',
      emergencyContactName: 'Emergency contact', emergencyContactMobile: 'Emergency mobile', guardian: 'Guardian',
      residentType: 'Resident type', collegeOrCompany: 'College / company', joiningDate: 'Joining date',
      expectedCheckoutDate: 'Expected checkout', documents: 'Documents', notes: 'Notes',
    };
    return (Object.keys(labels) as (keyof HostelResident)[])
      .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map((k) => labels[k]!);
  }

  private nextId(): string {
    const max = this.residents.reduce((m, r) => Math.max(m, Number(r.residentId.replace(/\D/g, '')) || 0), 0);
    return `RES${String(max + 1).padStart(6, '0')}`;
  }

  private require(residentId: string): HostelResident {
    const r = this.byId(residentId);
    if (!r) throw new Error('Resident not found.');
    return r;
  }

  private replace(next: HostelResident): void {
    this.commit(this.residents.map((r) => (r.residentId === next.residentId ? next : r)));
  }

  private commit(list: HostelResident[]): void {
    this.residentsSubject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // storage quota (large photos)
    }
  }

  private load(): HostelResident[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored) as HostelResident[];
    } catch {
      // fallback to seed
    }
    return SEED_RESIDENTS;
  }

  private auditEntity(r: HostelResident): string {
    return `${residentFullName(r)} (${r.residentId})`;
  }

  /** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
  private nowIso(): string {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  }
}
