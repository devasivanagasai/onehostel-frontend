import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { FeesService } from '../fees-payments/fees.service';
import { RoomsService } from '../rooms-management/rooms.service';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident, residentFullName } from '../residents/residents.models';
import {
  LaundryAvailability,
  LaundryBooking,
  LaundryNotice,
  LaundryUnit,
  LaundryUnitInput,
  OPEN_STATUSES,
  Slot,
  addDays,
  clock,
  dayOfWeek,
  fromMinutes,
  localIso,
  toMinutes,
  todayStr,
} from './laundry.models';

// Audit: AUDIT_EVENTS has no laundry events, so nothing is recorded there. Charges posted to
// Fees & Payments are audited by FeesService itself ("Create Charge").

const STORAGE_KEY = 'onehostel_laundry_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

/** Days after billing that a laundry charge is due. */
const CHARGE_DUE_DAYS = 7;

interface LaundryState {
  units: LaundryUnit[];
  bookings: LaundryBooking[];
  notices: LaundryNotice[];
}

export interface LaundryStats {
  available: number;
  bookable: number;
  today: number;
  requested: number;
  maintenance: number;
  billedThisMonth: number;
  toBill: number;
}

export interface BookingInput {
  unitId: string;
  residentId: string;
  date: string;
  start: string;
  items?: number;
  notes?: string;
}

/** Booking reference written into the charge description; used to find an existing charge. */
export const chargeRef = (bookingId: string): string => `(${bookingId})`;

@Injectable({ providedIn: 'root' })
export class LaundryService {
  private readonly residents = inject(ResidentsService);
  private readonly rooms = inject(RoomsService);
  private readonly fees = inject(FeesService);
  private readonly auth = inject(AuthService);

  private readonly state = new BehaviorSubject<LaundryState>(this.load());

  readonly stats$: Observable<LaundryStats> = this.state.pipe(
    map((s) => {
      const today = todayStr();
      const month = today.slice(0, 7);
      const live = s.units.filter((u) => u.state !== 'Inactive');
      return {
        available: live.filter((u) => this.availability(u) === 'Available').length,
        bookable: live.length,
        today: s.bookings.filter((b) => b.date === today && b.status !== 'Cancelled').length,
        requested: s.bookings.filter((b) => b.status === 'Requested').length,
        maintenance: s.units.filter((u) => u.state === 'Maintenance').length,
        billedThisMonth: s.bookings.filter((b) => b.chargeId && b.billedAt?.startsWith(month)).reduce((sum, b) => sum + b.amount, 0),
        toBill: s.bookings.filter((b) => this.needsBilling(b)).length,
      };
    }),
  );

  get units(): LaundryUnit[] {
    return this.state.value.units;
  }

  get bookings(): LaundryBooking[] {
    return this.state.value.bookings;
  }

  get notices(): LaundryNotice[] {
    return this.state.value.notices;
  }

  unit(id: string): LaundryUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** Residents who can book: current (Active / On Leave), not deactivated. */
  get currentResidents(): HostelResident[] {
    return this.residents.residents.filter((r) => !r.deactivatedAt && (r.status === 'Active' || r.status === 'On Leave'));
  }

  roomOf(residentId: string): string {
    const alloc = this.residents.allocationFor(residentId);
    return alloc ? this.residents.describe(alloc) : 'No bed';
  }

  /** "Block A · Ground Floor" style suggestions for the location field, from the hostel's rooms. */
  get locationSuggestions(): string[] {
    const floors = this.rooms.rooms.filter((r) => r.hostelId === HOSTEL_ID).map((r) => `${r.building} · ${r.floor}`);
    return [...new Set([...floors, ...this.units.map((u) => u.location)])].sort();
  }

  /** Maintenance / Inactive as set; otherwise Booked while an open booking is running right now. */
  availability(u: LaundryUnit): LaundryAvailability {
    if (u.state !== 'Active') return u.state;
    const now = localIso();
    const busy = this.bookings.some(
      (b) => b.unitId === u.id && OPEN_STATUSES.includes(b.status) && `${b.date}T${b.start}` <= now && now < `${b.date}T${b.end}`,
    );
    return busy ? 'Booked' : 'Available';
  }

  /** Paid, completed and not yet charged. */
  needsBilling(b: LaundryBooking): boolean {
    return b.status === 'Completed' && b.amount > 0 && !b.chargeId;
  }

  // ---- Slots ------------------------------------------------------------------

  /** Every slot of the day within operating hours; empty on a closed day. */
  slots(unitId: string, date: string): Slot[] {
    const u = this.unit(unitId);
    if (!u || !u.days.includes(dayOfWeek(date))) return [];
    const now = localIso();
    const taken = this.bookings.filter((b) => b.unitId === unitId && b.date === date && b.status !== 'Cancelled');
    const out: Slot[] = [];
    for (let t = toMinutes(u.openTime); t + u.slotMinutes <= toMinutes(u.closeTime); t += u.slotMinutes) {
      const start = fromMinutes(t);
      const end = fromMinutes(t + u.slotMinutes);
      let blocked: Slot['blocked'] = '';
      if (u.state !== 'Active') blocked = 'Maintenance';
      else if (`${date}T${start}` < now.slice(0, 16)) blocked = 'Past';
      else if (taken.some((b) => b.start < end && start < b.end)) blocked = 'Booked';
      out.push({ start, end, blocked });
    }
    return out;
  }

  /** Bookings the resident already holds for this machine in the limit period (day or Mon–Sun week). */
  usedQuota(u: LaundryUnit, residentId: string, date: string): number {
    const [from, to] = u.limitPeriod === 'day' ? [date, date] : this.weekOf(date);
    return this.bookings.filter(
      (b) => b.unitId === u.id && b.residentId === residentId && b.status !== 'Cancelled' && b.date >= from && b.date <= to,
    ).length;
  }

  amountFor(u: LaundryUnit, items?: number): number {
    return u.priceUnit === 'per item' ? u.price * (items ?? 0) : u.price;
  }

  priceLabel(u: LaundryUnit): string {
    return u.price > 0 ? `${u.price} ${u.priceUnit}` : 'Free';
  }

  // ---- Bookings -----------------------------------------------------------------

  /** Owner books on a resident's behalf — confirmed straight away. Enforces hours, slots, limit and no overlap. */
  book(input: BookingInput): LaundryBooking {
    const u = this.unit(input.unitId);
    if (!u) throw new Error('Select a machine or service.');
    if (u.state !== 'Active') throw new Error(`${u.name} is ${u.state === 'Maintenance' ? 'under maintenance' : 'inactive'} and can't be booked.`);
    const r = this.currentResidents.find((x) => x.residentId === input.residentId);
    if (!r) throw new Error('Select a current resident.');
    if (u.priceUnit === 'per item' && !(Number(input.items) >= 1)) throw new Error('Enter the number of items.');
    const slot = this.slots(u.id, input.date).find((s) => s.start === input.start);
    if (!slot) throw new Error(`${u.name} has no ${clock(input.start)} slot on that day.`);
    if (slot.blocked === 'Past') throw new Error('That slot has already started.');
    if (slot.blocked) throw new Error('That slot overlaps another booking. Pick a free slot.');
    if (this.usedQuota(u, r.residentId, input.date) >= u.limitCount) {
      throw new Error(`${residentFullName(r)} already has ${u.limitCount} booking(s) for ${u.name} this ${u.limitPeriod}.`);
    }
    const now = localIso();
    const booking: LaundryBooking = {
      id: this.nextBookingId(),
      unitId: u.id,
      residentId: r.residentId,
      residentName: residentFullName(r),
      date: input.date,
      start: slot.start,
      end: slot.end,
      items: u.priceUnit === 'per item' ? Number(input.items) : undefined,
      amount: this.amountFor(u, input.items),
      status: 'Confirmed',
      notes: input.notes?.trim() || undefined,
      createdBy: this.userName,
      createdAt: now,
      updatedAt: now,
    };
    this.commit({ bookings: [booking, ...this.bookings] });
    return booking;
  }

  confirm(id: string): void {
    const b = this.requireBooking(id);
    if (b.status !== 'Requested') throw new Error('Only requested bookings can be confirmed.');
    if (this.unit(b.unitId)?.state !== 'Active') throw new Error('The machine is not available.');
    this.patchBooking(id, { status: 'Confirmed' });
  }

  /** Completes the booking; a paid booking is billed once (see postCharge). Returns the charge ID if one was created. */
  complete(id: string): string | undefined {
    const b = this.requireBooking(id);
    if (b.status !== 'Confirmed') throw new Error('Only confirmed bookings can be completed.');
    if (!this.started(b)) throw new Error("The slot hasn't started yet.");
    this.patchBooking(id, { status: 'Completed' });
    return b.amount > 0 ? this.postCharge(id) : undefined;
  }

  noShow(id: string): void {
    const b = this.requireBooking(id);
    if (b.status !== 'Confirmed') throw new Error('Only confirmed bookings can be marked as no-show.');
    if (!this.started(b)) throw new Error("The slot hasn't started yet.");
    this.patchBooking(id, { status: 'No-show' });
  }

  cancel(id: string, reason = 'Cancelled by admin'): void {
    const b = this.requireBooking(id);
    if (!OPEN_STATUSES.includes(b.status)) throw new Error('Only requested or confirmed bookings can be cancelled.');
    this.patchBooking(id, { status: 'Cancelled', cancelReason: reason });
  }

  /**
   * Billing rule: a completed booking with a price creates exactly one one-time charge in Fees & Payments,
   * described "Laundry – <name> (<booking id>)". The charge ID is stored on the booking; if the booking was
   * already billed — or a live charge with this reference exists — nothing new is created.
   */
  postCharge(id: string): string {
    const b = this.requireBooking(id);
    if (b.status !== 'Completed') throw new Error('Only completed bookings are billed.');
    if (!(b.amount > 0)) throw new Error('This booking has no charge.');
    if (b.chargeId) return b.chargeId;
    const existing = this.fees.charges.find((c) => c.residentId === b.residentId && !c.cancelledAt && c.description.includes(chargeRef(b.id)));
    let chargeId = existing?.id;
    if (!chargeId) {
      const u = this.unit(b.unitId);
      const [charge] = this.fees.createOneTimeCharge({
        residentIds: [b.residentId],
        description: `Laundry – ${u?.name ?? b.unitId} ${chargeRef(b.id)}`,
        amount: b.amount,
        taxRate: 0,
        dueDate: addDays(todayStr(), CHARGE_DUE_DAYS),
      });
      chargeId = charge.id;
    }
    this.patchBooking(id, { chargeId, billedAt: localIso() });
    return chargeId;
  }

  started(b: LaundryBooking): boolean {
    return `${b.date}T${b.start}` <= localIso();
  }

  // ---- Machines / services --------------------------------------------------------

  saveUnit(input: LaundryUnitInput, id?: string): LaundryUnit {
    this.validateUnit(input, id);
    const now = localIso();
    const clean = { ...input, name: input.name.trim(), location: input.location.trim(), days: [...input.days].sort() };
    if (id) {
      const next = { ...this.requireUnit(id), ...clean, updatedAt: now };
      this.commit({ units: this.units.map((u) => (u.id === id ? next : u)) });
      return next;
    }
    const created: LaundryUnit = { id: this.nextUnitId(), hostelId: HOSTEL_ID, ...clean, state: 'Active', createdAt: now, updatedAt: now };
    this.commit({ units: [...this.units, created] });
    return created;
  }

  /** Open bookings from now on — the ones a maintenance / deactivation would cancel. */
  futureBookings(unitId: string): LaundryBooking[] {
    const now = localIso().slice(0, 16);
    return this.bookings
      .filter((b) => b.unitId === unitId && OPEN_STATUSES.includes(b.status) && `${b.date}T${b.start}` >= now)
      .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  }

  /**
   * Maintenance / Inactive blocks every future slot: open future bookings are cancelled and each
   * affected resident gets a (mock) notification. Returns the cancelled bookings.
   */
  setState(unitId: string, state: LaundryUnit['state'], note?: string): LaundryBooking[] {
    const u = this.requireUnit(unitId);
    const now = localIso();
    const affected = state === 'Active' ? [] : this.futureBookings(unitId);
    const reason = state === 'Maintenance' ? `${u.name} under maintenance` : `${u.name} taken out of service`;
    const ids = new Set(affected.map((b) => b.id));
    const notices: LaundryNotice[] = affected.map((b, i) => ({
      id: `LN${Date.now()}${i}`,
      residentId: b.residentId,
      residentName: b.residentName,
      bookingId: b.id,
      message: `Your ${u.name} booking on ${b.date} at ${clock(b.start)} was cancelled: ${reason}${note ? ` (${note})` : ''}. Please book another slot.`,
      at: now,
    }));
    this.commit({
      units: this.units.map((x) =>
        x.id === unitId
          ? { ...x, state, maintenanceNote: state === 'Maintenance' ? note?.trim() || undefined : undefined, maintenanceSince: state === 'Maintenance' ? now : undefined, updatedAt: now }
          : x,
      ),
      bookings: this.bookings.map((b) => (ids.has(b.id) ? { ...b, status: 'Cancelled', cancelReason: reason, notifiedAt: now, updatedAt: now } : b)),
      notices: [...notices, ...this.notices],
    });
    return affected;
  }

  // ---------------------------------------------------------------------------

  private validateUnit(input: LaundryUnitInput, id?: string): void {
    if (!input.name.trim()) throw new Error('Name is required.');
    const dup = this.units.find((u) => u.id !== id && u.name.trim().toLowerCase() === input.name.trim().toLowerCase());
    if (dup) throw new Error(`"${dup.name}" already exists (${dup.id}).`);
    if (!input.location.trim()) throw new Error('Location is required.');
    if (input.type === 'Laundry Service' && !(input.price > 0)) throw new Error('A laundry service needs a price.');
    if (input.price < 0) throw new Error("Price can't be negative.");
    if (!(input.slotMinutes > 0)) throw new Error('Slot duration must be a positive number of minutes.');
    if (!input.days.length) throw new Error('Pick at least one operating day.');
    if (toMinutes(input.closeTime) - toMinutes(input.openTime) < input.slotMinutes) throw new Error('Operating hours must fit at least one slot.');
    if (!(input.limitCount >= 1)) throw new Error('Booking limit must be at least 1.');
  }

  private weekOf(date: string): [string, string] {
    const monday = addDays(date, -((dayOfWeek(date) + 6) % 7));
    return [monday, addDays(monday, 6)];
  }

  private patchBooking(id: string, patch: Partial<LaundryBooking>): void {
    const now = localIso();
    this.commit({ bookings: this.bookings.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: now } : b)) });
  }

  private requireBooking(id: string): LaundryBooking {
    const b = this.bookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found.');
    return b;
  }

  private requireUnit(id: string): LaundryUnit {
    const u = this.unit(id);
    if (!u) throw new Error('Machine / service not found.');
    return u;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextUnitId(): string {
    const max = this.units.reduce((m, u) => Math.max(m, Number(u.id.slice(3)) || 0), 0);
    return `LND${String(max + 1).padStart(3, '0')}`;
  }

  private nextBookingId(): string {
    const max = this.bookings.reduce((m, b) => Math.max(m, Number(b.id.slice(2)) || 0), 0);
    return `LB${String(max + 1).padStart(6, '0')}`;
  }

  private commit(patch: Partial<LaundryState>): void {
    const next = { ...this.state.value, ...patch };
    this.state.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): LaundryState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as LaundryState;
    } catch {
      // Fall through to the seed data.
    }
    const s = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
    return s;
  }
}

// ---- Seed data (relative to today) ---------------------------------------------------

function seed(): LaundryState {
  const today = todayStr();
  const day = (n: number) => addDays(today, n);
  /** First date from `from` (inclusive) that falls on one of `days`. */
  const nextOpen = (from: number, days: number[]) => {
    for (let i = from; i < from + 7; i++) if (days.includes(dayOfWeek(day(i)))) return day(i);
    return day(from);
  };
  const created = `${day(-30)}T10:00:00`;
  const unit = (u: Omit<LaundryUnit, 'hostelId' | 'createdAt' | 'updatedAt'>): LaundryUnit => ({ ...u, hostelId: HOSTEL_ID, createdAt: created, updatedAt: created });
  const all = [0, 1, 2, 3, 4, 5, 6];
  const serviceDays = [1, 3, 5, 6];

  const units: LaundryUnit[] = [
    unit({ id: 'LND001', type: 'Self-service Machine', name: 'Washing Machine 1', location: 'Block A · Ground Floor Laundry Room', price: 60, priceUnit: 'per load', slotMinutes: 60, openTime: '07:00', closeTime: '22:00', days: all, limitCount: 1, limitPeriod: 'day', state: 'Active' }),
    unit({ id: 'LND002', type: 'Self-service Machine', name: 'Washing Machine 2', location: 'Block A · Ground Floor Laundry Room', price: 60, priceUnit: 'per load', slotMinutes: 60, openTime: '07:00', closeTime: '22:00', days: all, limitCount: 1, limitPeriod: 'day', state: 'Maintenance', maintenanceNote: 'Drain pump replacement', maintenanceSince: `${day(-1)}T18:30:00` }),
    unit({ id: 'LND003', type: 'Self-service Machine', name: 'Dryer 1', location: 'Block B · 2nd Floor Utility Room', price: 40, priceUnit: 'per load', slotMinutes: 45, openTime: '08:00', closeTime: '21:00', days: all, limitCount: 1, limitPeriod: 'day', state: 'Active' }),
    unit({ id: 'LND004', type: 'Laundry Service', name: 'Wash & Iron Service', location: 'Reception · Block A', price: 25, priceUnit: 'per item', slotMinutes: 30, openTime: '08:00', closeTime: '12:00', days: serviceDays, limitCount: 1, limitPeriod: 'week', state: 'Active' }),
    unit({ id: 'LND005', type: 'Laundry Service', name: 'Dry Cleaning', location: 'Reception · Block A', price: 150, priceUnit: 'per item', slotMinutes: 30, openTime: '10:00', closeTime: '12:00', days: [6], limitCount: 1, limitPeriod: 'week', state: 'Inactive' }),
  ];

  let n = 0;
  const b = (p: Omit<LaundryBooking, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>, by = 'Resident App'): LaundryBooking => {
    const at = `${addDays(p.date, -1)}T20:00:00`;
    return { id: `LB${String(++n).padStart(6, '0')}`, ...p, createdBy: by, createdAt: at, updatedAt: at };
  };
  const svcPast = nextOpen(-7, serviceDays);
  const svcNext = nextOpen(1, serviceDays);

  const bookings: LaundryBooking[] = [
    b({ unitId: 'LND001', residentId: 'RES000001', residentName: 'Rahul Sharma', date: day(-3), start: '08:00', end: '09:00', amount: 60, status: 'Completed' }),
    b({ unitId: 'LND003', residentId: 'RES000003', residentName: 'Vivek Singh', date: day(-2), start: '17:45', end: '18:30', amount: 40, status: 'No-show' }),
    b({ unitId: 'LND004', residentId: 'RES000006', residentName: 'Sagar Gupta', date: svcPast, start: '09:00', end: '09:30', items: 8, amount: 200, status: 'Completed' }),
    b({ unitId: 'LND001', residentId: 'RES000005', residentName: 'Sahil Khan', date: day(-1), start: '19:00', end: '20:00', amount: 60, status: 'Confirmed' }),
    b({ unitId: 'LND001', residentId: 'RES000002', residentName: 'Aman Verma', date: today, start: '07:00', end: '08:00', amount: 60, status: 'Confirmed' }),
    b({ unitId: 'LND003', residentId: 'RES000007', residentName: 'Mohit Yadav', date: today, start: '20:00', end: '20:45', amount: 40, status: 'Requested' }),
    b({ unitId: 'LND001', residentId: 'RES000003', residentName: 'Vivek Singh', date: day(1), start: '18:00', end: '19:00', amount: 60, status: 'Requested' }),
    b({ unitId: 'LND002', residentId: 'RES000001', residentName: 'Rahul Sharma', date: day(1), start: '08:00', end: '09:00', amount: 60, status: 'Cancelled', cancelReason: 'Washing Machine 2 under maintenance', notifiedAt: `${day(-1)}T18:30:00` }),
    b({ unitId: 'LND002', residentId: 'RES000006', residentName: 'Sagar Gupta', date: day(2), start: '19:00', end: '20:00', amount: 60, status: 'Cancelled', cancelReason: 'Washing Machine 2 under maintenance', notifiedAt: `${day(-1)}T18:30:00` }),
    b({ unitId: 'LND004', residentId: 'RES000002', residentName: 'Aman Verma', date: svcNext, start: '08:30', end: '09:00', items: 12, amount: 300, status: 'Confirmed' }, 'Hostel Owner'),
    b({ unitId: 'LND003', residentId: 'RES000001', residentName: 'Rahul Sharma', date: day(2), start: '08:00', end: '08:45', amount: 40, status: 'Requested' }),
  ].reverse();

  const notices: LaundryNotice[] = bookings
    .filter((x) => x.notifiedAt)
    .map((x, i) => ({
      id: `LN-SEED-${i + 1}`,
      residentId: x.residentId,
      residentName: x.residentName,
      bookingId: x.id,
      message: `Your Washing Machine 2 booking on ${x.date} at ${clock(x.start)} was cancelled: Washing Machine 2 under maintenance (Drain pump replacement). Please book another slot.`,
      at: x.notifiedAt!,
    }));

  return { units, bookings, notices };
}
