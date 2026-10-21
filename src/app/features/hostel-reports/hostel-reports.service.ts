import { Injectable, inject } from '@angular/core';
import { combineLatest, map } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { ResidentsService } from '../residents/residents.service';
import { RESIDENT_STATUSES, RESIDENT_TYPES, ResidentStatus, formatMobile, residentFullName } from '../residents/residents.models';
import { RoomsService } from '../rooms-management/rooms.service';
import { Room, RoomStatus } from '../rooms-management/rooms.models';
import { FeesService } from '../fees-payments/fees.service';
import { ChargeStatus, OFFLINE_METHODS, PAYMENT_STATUSES, PaymentStatus } from '../fees-payments/fees.models';
import { ComplaintsService } from '../complaints/complaints.service';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  ComplaintPriority,
  STAFF,
  STATUS_TONES as COMPLAINT_TONES,
  isActive,
  staffById,
} from '../complaints/complaints.models';
import {
  DateRange,
  HostelReportKey,
  OWNER_HOSTEL,
  PERIOD_KEY,
  PERIOD_OPTIONS,
  ReportFilterDef,
  ReportResult,
  formatDuration,
  inRange,
  isoDay,
  round2,
} from './hostel-reports.models';

const RESIDENT_TONES: Record<ResidentStatus, string> = {
  Active: 'success',
  Invited: 'info',
  'On Leave': 'warning',
  'Checked Out': 'neutral',
  Suspended: 'danger',
};

const ROOM_TONES: Record<RoomStatus, string> = { Available: 'success', Full: 'info', Maintenance: 'warning', Inactive: 'neutral' };

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  Successful: 'success',
  Pending: 'warning',
  Failed: 'danger',
  Reversed: 'neutral',
  Refunded: 'info',
};

const PRIORITY_TONES: Record<ComplaintPriority, string> = { Urgent: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' };

/** Room status filter value that hides inactive rooms (the default). */
const ACTIVE_ROOMS = 'active';
/** Resident room filter value for residents without a bed. */
const NO_BED = 'none';

const DAY_MS = 86400000;
const all = (label: string) => ({ value: 'All', label });
const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** yyyy-MM-dd → whole days from `a` to `b`. */
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * Builds the five owner reports from the live (localStorage-backed) module services.
 * Every total, KPI and footer is computed from the same filtered rows the table shows,
 * so the numbers always reconcile with the listed records.
 */
@Injectable({ providedIn: 'root' })
export class HostelReportsService {
  private readonly fmt = inject(AppFormatService);
  private readonly residents = inject(ResidentsService);
  private readonly rooms = inject(RoomsService);
  private readonly fees = inject(FeesService);
  private readonly complaints = inject(ComplaintsService);

  /** Emits whenever any source record changes, so an open report stays current. */
  readonly changes$ = combineLatest([
    this.residents.residents$,
    this.rooms.rooms$,
    this.fees.charges$,
    this.fees.payments$,
    this.complaints.complaints$,
  ]).pipe(map(() => undefined));

  /** Rooms of the owner's hostel (rooms are the only records that carry a hostelId). */
  private get hostelRooms(): Room[] {
    return this.rooms.rooms.filter((r) => r.hostelId === OWNER_HOSTEL.id);
  }

  /** Select filters per report. Option lists that depend on data are rebuilt on each call. */
  filtersFor(key: HostelReportKey): ReportFilterDef[] {
    const period = (label: string): ReportFilterDef => ({ key: PERIOD_KEY, label, options: PERIOD_OPTIONS });
    switch (key) {
      case 'residents': {
        const rooms = [...this.hostelRooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
        return [
          { key: 'status', label: 'Status', options: [all('All Status'), ...opts(RESIDENT_STATUSES)] },
          { key: 'type', label: 'Type', options: [all('All Types'), ...opts(RESIDENT_TYPES)] },
          period('Joined'),
          {
            key: 'room',
            label: 'Room',
            options: [all('All Rooms'), { value: NO_BED, label: 'No bed allocated' }, ...rooms.map((r) => ({ value: r.id, label: `Room ${r.roomNumber} · ${r.building}` }))],
          },
        ];
      }
      case 'occupancy': {
        const uniq = (values: string[]) => [...new Set(values)].sort();
        return [
          { key: 'building', label: 'Building', options: [all('All Buildings'), ...opts(uniq(this.hostelRooms.map((r) => r.building)))] },
          { key: 'floor', label: 'Floor', options: [all('All Floors'), ...opts(uniq(this.hostelRooms.map((r) => r.floor)))] },
          {
            key: 'roomStatus',
            label: 'Rooms',
            options: [
              { value: ACTIVE_ROOMS, label: 'Active rooms' },
              all('All rooms (incl. inactive)'),
              ...opts(['Available', 'Full', 'Maintenance', 'Inactive']),
            ],
          },
        ];
      }
      case 'collection':
        return [
          period('Paid'),
          { key: 'method', label: 'Method', options: [all('All Methods'), ...opts([...OFFLINE_METHODS, 'Online'])] },
          { key: 'status', label: 'Status', options: [all('All Status'), ...opts(PAYMENT_STATUSES)] },
        ];
      case 'dues':
        return [
          {
            key: 'status',
            label: 'Status',
            options: [all('All Status'), ...opts(['Overdue', 'Not yet due', 'Partially paid'])],
          },
          {
            key: 'aging',
            label: 'Overdue',
            options: [all('Any age'), ...opts(['1–30 days', '31–60 days', '61–90 days', '90+ days'])],
          },
        ];
      case 'complaints':
        return [
          { key: 'status', label: 'Status', options: [all('All Status'), { value: 'Unresolved', label: 'Unresolved (open)' }, ...opts(COMPLAINT_STATUSES)] },
          { key: 'category', label: 'Category', options: [all('All Categories'), ...opts(COMPLAINT_CATEGORIES)] },
          { key: 'priority', label: 'Priority', options: [all('All Priorities'), ...opts(COMPLAINT_PRIORITIES)] },
          {
            key: 'assignee',
            label: 'Assigned to',
            options: [all('Anyone'), { value: 'Unassigned', label: 'Unassigned' }, ...STAFF.map((s) => ({ value: s.id, label: s.name }))],
          },
          period('Created'),
        ];
    }
  }

  build(key: HostelReportKey, f: Record<string, string>, search: string, range: DateRange): ReportResult {
    const q = search.trim().toLowerCase();
    const has = (...values: (string | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q));
    switch (key) {
      case 'residents':
        return this.residentRegister(f, has, range);
      case 'occupancy':
        return this.occupancy(f, has);
      case 'collection':
        return this.collection(f, has, range);
      case 'dues':
        return this.dues(f, has);
      case 'complaints':
        return this.complaintsReport(f, has, range);
    }
  }

  // ---- Resident Register --------------------------------------------------------

  private residentRegister(f: Record<string, string>, has: (...v: (string | undefined)[]) => boolean, range: DateRange): ReportResult {
    const rows = this.residents.residents
      // Deactivated (soft-deleted) residents are not part of the register.
      .filter((r) => !r.deactivatedAt)
      .map((r) => {
        const alloc = this.residents.allocationFor(r.residentId);
        return {
          id: r.residentId,
          name: residentFullName(r),
          mobile: formatMobile(r.mobileCode, r.mobile),
          type: r.residentType,
          roomId: alloc?.room.id,
          room: alloc ? `Room ${alloc.room.roomNumber}` : '',
          bed: alloc ? `Bed ${alloc.bed.bedNumber}` : '',
          building: alloc?.room.building ?? '',
          joiningDate: r.joiningDate,
          status: r.status,
        };
      })
      .filter(
        (r) =>
          (f['status'] === 'All' || r.status === f['status']) &&
          (f['type'] === 'All' || r.type === f['type']) &&
          (f['room'] === 'All' || (f['room'] === NO_BED ? !r.roomId : r.roomId === f['room'])) &&
          inRange(r.joiningDate, range) &&
          has(r.id, r.name, r.mobile, r.mobile.replace(/\s/g, '')),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    type Row = (typeof rows)[number];
    const count = (s: ResidentStatus) => rows.filter((r) => r.status === s).length;
    const withBed = rows.filter((r) => r.roomId).length;

    return {
      rows,
      columns: [
        { key: 'resident', header: 'Resident', text: (r: Row) => r.name, sub: (r: Row) => r.id, strong: true },
        { key: 'mobile', header: 'Mobile', text: (r: Row) => r.mobile, sub: (r: Row) => r.type },
        { key: 'room', header: 'Room / Bed', text: (r: Row) => (r.roomId ? `${r.room} · ${r.bed}` : 'Not allocated'), sub: (r: Row) => r.building },
        { key: 'joined', header: 'Joining Date', text: (r: Row) => this.fmt.date(r.joiningDate) },
        { key: 'status', header: 'Status', text: (r: Row) => r.status, badge: (r: Row) => RESIDENT_TONES[r.status] },
      ],
      footer: { resident: `Total: ${plural(rows.length, 'resident')}`, room: `${withBed} with a bed · ${rows.length - withBed} without` },
      kpis: [
        { label: 'Residents', value: rows.length, sub: 'Matching the filters', icon: 'groups', tone: 'teal' },
        { label: 'Active', value: count('Active'), sub: `${count('On Leave')} on leave`, icon: 'how_to_reg', tone: 'green' },
        { label: 'Invited', value: count('Invited'), sub: `${count('Suspended')} suspended`, icon: 'mail', tone: 'blue' },
        { label: 'Checked Out', value: count('Checked Out'), icon: 'logout', tone: 'orange' },
      ],
      exportColumns: [
        { header: 'Resident ID', value: (r: Row) => r.id },
        { header: 'Name', value: (r: Row) => r.name },
        { header: 'Mobile', value: (r: Row) => r.mobile },
        { header: 'Type', value: (r: Row) => r.type },
        { header: 'Building', value: (r: Row) => r.building },
        { header: 'Room', value: (r: Row) => r.room },
        { header: 'Bed', value: (r: Row) => r.bed },
        { header: 'Joining Date', value: (r: Row) => this.fmt.date(r.joiningDate) },
        { header: 'Status', value: (r: Row) => r.status },
      ],
      exportTotals: [`Total: ${plural(rows.length, 'resident')}`, '', '', '', '', `${withBed} with a bed`, '', '', ''],
    };
  }

  // ---- Room & Bed Occupancy -----------------------------------------------------

  private occupancy(f: Record<string, string>, has: (...v: (string | undefined)[]) => boolean): ReportResult {
    const rows = this.hostelRooms
      .filter(
        (r) =>
          (f['building'] === 'All' || r.building === f['building']) &&
          (f['floor'] === 'All' || r.floor === f['floor']) &&
          (f['roomStatus'] === 'All' || (f['roomStatus'] === ACTIVE_ROOMS ? r.status !== 'Inactive' : r.status === f['roomStatus'])) &&
          has(r.roomNumber, `room ${r.roomNumber}`),
      )
      .map((r) => {
        // Same rule as the Rooms screen: Reserved beds count as occupied.
        const capacity = r.beds.length;
        const occupied = r.beds.filter((b) => b.status === 'Occupied' || b.status === 'Reserved').length;
        const reserved = r.beds.filter((b) => b.status === 'Reserved').length;
        // An inactive room has no bookable beds, so its free beds are counted as unavailable.
        const available = r.status === 'Inactive' ? 0 : r.beds.filter((b) => b.status === 'Available').length;
        return {
          building: r.building,
          floor: r.floor,
          room: r.roomNumber,
          type: r.roomType,
          status: r.status,
          capacity,
          occupied,
          reserved,
          available,
          unavailable: capacity - occupied - available,
          pct: capacity ? (occupied / capacity) * 100 : 0,
        };
      })
      .sort((a, b) => a.building.localeCompare(b.building) || a.floor.localeCompare(b.floor) || a.room.localeCompare(b.room, undefined, { numeric: true }));

    type Row = (typeof rows)[number];
    const sum = (k: 'capacity' | 'occupied' | 'available' | 'unavailable') => rows.reduce((s, r) => s + r[k], 0);
    const [capacity, occupied, available, unavailable] = [sum('capacity'), sum('occupied'), sum('available'), sum('unavailable')];
    // Overall % is weighted by beds (total occupied ÷ total capacity), not an average of room percentages.
    const pct = capacity ? (occupied / capacity) * 100 : 0;
    const pctText = (n: number) => `${n.toFixed(1)}%`;

    return {
      rows,
      columns: [
        { key: 'building', header: 'Building / Floor', text: (r: Row) => r.building, sub: (r: Row) => r.floor },
        { key: 'room', header: 'Room', text: (r: Row) => `Room ${r.room}`, sub: (r: Row) => r.type, strong: true },
        { key: 'status', header: 'Room Status', text: (r: Row) => r.status, badge: (r: Row) => ROOM_TONES[r.status] },
        { key: 'capacity', header: 'Capacity', text: (r: Row) => r.capacity, numeric: true },
        { key: 'occupied', header: 'Occupied', text: (r: Row) => r.occupied, sub: (r: Row) => (r.reserved ? `incl. ${r.reserved} reserved` : ''), numeric: true },
        { key: 'available', header: 'Available', text: (r: Row) => r.available, numeric: true },
        { key: 'unavailable', header: 'Unavailable', text: (r: Row) => r.unavailable, sub: (r: Row) => (r.unavailable ? (r.status === 'Inactive' ? 'Room inactive' : 'Maintenance') : ''), numeric: true },
        { key: 'pct', header: 'Occupancy', text: (r: Row) => pctText(r.pct), numeric: true, strong: true },
      ],
      footer: {
        building: `Total: ${plural(rows.length, 'room')}`,
        capacity: String(capacity),
        occupied: String(occupied),
        available: String(available),
        unavailable: String(unavailable),
        pct: pctText(pct),
      },
      kpis: [
        { label: 'Rooms', value: rows.length, sub: `${capacity} beds in total`, icon: 'meeting_room', tone: 'teal' },
        { label: 'Occupied Beds', value: occupied, sub: 'Includes reserved beds', icon: 'hotel', tone: 'indigo' },
        { label: 'Available Beds', value: available, sub: unavailable ? `${unavailable} unavailable` : 'Ready to allocate', icon: 'event_available', tone: 'green' },
        { label: 'Occupancy', value: pctText(pct), sub: `${occupied} of ${capacity} beds`, icon: 'donut_large', tone: 'blue' },
      ],
      exportColumns: [
        { header: 'Building', value: (r: Row) => r.building },
        { header: 'Floor', value: (r: Row) => r.floor },
        { header: 'Room', value: (r: Row) => r.room },
        { header: 'Room Type', value: (r: Row) => r.type },
        { header: 'Room Status', value: (r: Row) => r.status },
        { header: 'Capacity', value: (r: Row) => r.capacity, numeric: true },
        { header: 'Occupied', value: (r: Row) => r.occupied, numeric: true },
        { header: 'Available', value: (r: Row) => r.available, numeric: true },
        { header: 'Unavailable', value: (r: Row) => r.unavailable, numeric: true },
        { header: 'Occupancy %', value: (r: Row) => pctText(r.pct), numeric: true },
      ],
      exportTotals: [`Total: ${plural(rows.length, 'room')}`, '', '', '', '', capacity, occupied, available, unavailable, pctText(pct)],
    };
  }

  // ---- Fees Collection ----------------------------------------------------------

  private collection(f: Record<string, string>, has: (...v: (string | undefined)[]) => boolean, range: DateRange): ReportResult {
    const rows = this.fees.payments
      .filter(
        (p) =>
          (f['method'] === 'All' || p.method === f['method']) &&
          (f['status'] === 'All' || p.status === f['status']) &&
          inRange(isoDay(new Date(p.paidAt)), range) &&
          has(p.id, p.receiptId, p.residentName, p.residentId, p.collectedBy, p.transactionRef),
      )
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    type Row = (typeof rows)[number];
    const total = (s?: PaymentStatus) => round2(rows.filter((p) => !s || p.status === s).reduce((t, p) => t + p.amount, 0));
    const countOf = (s: PaymentStatus) => rows.filter((p) => p.status === s).length;
    // Only Successful payments are money collected; the other statuses are listed but not added in.
    const collected = total('Successful');
    const reversed = round2(total('Reversed') + total('Refunded'));

    return {
      rows,
      columns: [
        { key: 'date', header: 'Date', text: (p: Row) => this.fmt.date(p.paidAt), sub: (p: Row) => this.fmt.date(p.paidAt, 'time') },
        { key: 'resident', header: 'Resident', text: (p: Row) => p.residentName, sub: (p: Row) => p.chargeDescription, strong: true },
        { key: 'receipt', header: 'Receipt', text: (p: Row) => p.receiptId ?? '—', sub: (p: Row) => p.id },
        { key: 'method', header: 'Method', text: (p: Row) => p.method, sub: (p: Row) => p.transactionRef ?? '' },
        { key: 'amount', header: 'Amount', text: (p: Row) => this.fmt.money(p.amount), numeric: true, strong: true },
        { key: 'collector', header: 'Collected By', text: (p: Row) => p.collectedBy },
        { key: 'status', header: 'Status', text: (p: Row) => p.status, badge: (p: Row) => PAYMENT_TONES[p.status] },
      ],
      footer: {
        date: `Total: ${plural(rows.length, 'payment')}`,
        receipt: `${plural(countOf('Successful'), 'receipt')}`,
        amount: `${this.fmt.money(collected)} collected`,
        collector: rows.length > countOf('Successful') ? 'Successful payments only' : '',
      },
      kpis: [
        { label: 'Collected', value: this.fmt.money(collected), sub: `${plural(countOf('Successful'), 'successful payment')}`, icon: 'account_balance_wallet', tone: 'green' },
        { label: 'Pending', value: this.fmt.money(total('Pending')), sub: `${plural(countOf('Pending'), 'payment')} awaiting confirmation`, icon: 'hourglass_top', tone: 'orange' },
        { label: 'Reversed / Refunded', value: this.fmt.money(reversed), sub: `${countOf('Reversed') + countOf('Refunded')} payment(s)`, icon: 'undo', tone: 'indigo' },
        { label: 'Failed', value: countOf('Failed'), sub: this.fmt.money(total('Failed')), icon: 'error_outline', tone: 'blue' },
      ],
      exportColumns: [
        { header: 'Date', value: (p: Row) => this.fmt.date(p.paidAt, 'datetime') },
        { header: 'Resident ID', value: (p: Row) => p.residentId },
        { header: 'Resident', value: (p: Row) => p.residentName },
        { header: 'Charge', value: (p: Row) => p.chargeDescription },
        { header: 'Receipt', value: (p: Row) => p.receiptId ?? '' },
        { header: 'Payment ID', value: (p: Row) => p.id },
        { header: 'Method', value: (p: Row) => p.method },
        { header: 'Reference', value: (p: Row) => p.transactionRef ?? '' },
        { header: 'Amount', value: (p: Row) => p.amount, money: true },
        { header: 'Collected By', value: (p: Row) => p.collectedBy },
        { header: 'Status', value: (p: Row) => p.status },
      ],
      exportTotals: [`Total collected (${plural(countOf('Successful'), 'successful payment')})`, '', '', '', '', '', '', '', collected, '', ''],
    };
  }

  // ---- Outstanding Dues ---------------------------------------------------------

  private dues(f: Record<string, string>, has: (...v: (string | undefined)[]) => boolean): ReportResult {
    const today = isoDay();
    const aging: Record<string, [number, number]> = {
      '1–30 days': [1, 30],
      '31–60 days': [31, 60],
      '61–90 days': [61, 90],
      '90+ days': [91, Infinity],
    };

    const rows = this.fees.charges
      .map((c) => {
        const paid = this.fees.paidFor(c.id);
        const status: ChargeStatus = this.fees.chargeStatus(c);
        return {
          id: c.id,
          residentId: c.residentId,
          residentName: c.residentName,
          charge: c.description,
          dueDate: c.dueDate,
          original: c.total,
          paid,
          // Same balance the Fees screen uses (cancelled = 0, never negative).
          outstanding: this.fees.balance(c),
          daysOverdue: Math.max(0, daysBetween(c.dueDate, today)),
          status,
        };
      })
      // Only charges with money still owed; paid and cancelled charges are not dues.
      .filter((r) => r.outstanding > 0)
      .filter((r) => {
        const [min, max] = aging[f['aging']] ?? [0, Infinity];
        const statusOk =
          f['status'] === 'All' ||
          (f['status'] === 'Overdue' && r.daysOverdue > 0) ||
          (f['status'] === 'Not yet due' && r.daysOverdue === 0) ||
          (f['status'] === 'Partially paid' && r.paid > 0);
        return statusOk && r.daysOverdue >= min && r.daysOverdue <= max && has(r.id, r.residentId, r.residentName, r.charge);
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));

    type Row = (typeof rows)[number];
    const original = round2(rows.reduce((s, r) => s + r.original, 0));
    const paid = round2(rows.reduce((s, r) => s + r.paid, 0));
    const outstanding = round2(rows.reduce((s, r) => s + r.outstanding, 0));
    const overdue = rows.filter((r) => r.daysOverdue > 0);
    const overdueAmount = round2(overdue.reduce((s, r) => s + r.outstanding, 0));
    const residentsOwing = new Set(rows.map((r) => r.residentId)).size;

    return {
      rows,
      columns: [
        { key: 'resident', header: 'Resident', text: (r: Row) => r.residentName, sub: (r: Row) => r.residentId, strong: true },
        { key: 'charge', header: 'Charge', text: (r: Row) => r.charge, sub: (r: Row) => r.id },
        { key: 'due', header: 'Due Date', text: (r: Row) => this.fmt.date(r.dueDate) },
        { key: 'original', header: 'Original', text: (r: Row) => this.fmt.money(r.original), numeric: true },
        { key: 'paid', header: 'Paid', text: (r: Row) => this.fmt.money(r.paid), numeric: true },
        { key: 'outstanding', header: 'Outstanding', text: (r: Row) => this.fmt.money(r.outstanding), numeric: true, strong: true },
        {
          key: 'overdue',
          header: 'Days Overdue',
          text: (r: Row) => (r.daysOverdue ? plural(r.daysOverdue, 'day') : 'Not yet due'),
          badge: (r: Row) => (r.daysOverdue > 30 ? 'danger' : r.daysOverdue > 0 ? 'warning' : 'info'),
        },
      ],
      footer: {
        resident: `Total: ${plural(rows.length, 'charge')}`,
        charge: plural(residentsOwing, 'resident'),
        original: this.fmt.money(original),
        paid: this.fmt.money(paid),
        outstanding: this.fmt.money(outstanding),
      },
      kpis: [
        { label: 'Outstanding', value: this.fmt.money(outstanding), sub: `${this.fmt.money(original)} billed − ${this.fmt.money(paid)} paid`, icon: 'account_balance', tone: 'orange' },
        { label: 'Overdue', value: this.fmt.money(overdueAmount), sub: plural(overdue.length, 'charge') + ' past due', icon: 'warning_amber', tone: 'indigo' },
        { label: 'Not Yet Due', value: this.fmt.money(round2(outstanding - overdueAmount)), sub: plural(rows.length - overdue.length, 'charge'), icon: 'schedule', tone: 'blue' },
        { label: 'Residents Owing', value: residentsOwing, sub: plural(rows.length, 'open charge'), icon: 'person_search', tone: 'teal' },
      ],
      exportColumns: [
        { header: 'Resident ID', value: (r: Row) => r.residentId },
        { header: 'Resident', value: (r: Row) => r.residentName },
        { header: 'Charge ID', value: (r: Row) => r.id },
        { header: 'Charge', value: (r: Row) => r.charge },
        { header: 'Due Date', value: (r: Row) => this.fmt.date(r.dueDate) },
        { header: 'Original Amount', value: (r: Row) => r.original, money: true },
        { header: 'Paid', value: (r: Row) => r.paid, money: true },
        { header: 'Outstanding', value: (r: Row) => r.outstanding, money: true },
        { header: 'Days Overdue', value: (r: Row) => r.daysOverdue, numeric: true },
      ],
      exportTotals: [`Total: ${plural(rows.length, 'charge')}`, '', '', '', '', original, paid, outstanding, ''],
    };
  }

  // ---- Complaints ---------------------------------------------------------------

  private complaintsReport(f: Record<string, string>, has: (...v: (string | undefined)[]) => boolean, range: DateRange): ReportResult {
    const rows = this.complaints.complaints
      .filter(
        (c) =>
          (f['status'] === 'All' || (f['status'] === 'Unresolved' ? isActive(c) : c.status === f['status'])) &&
          (f['category'] === 'All' || c.category === f['category']) &&
          (f['priority'] === 'All' || c.priority === f['priority']) &&
          (f['assignee'] === 'All' || (f['assignee'] === 'Unassigned' ? !c.assignedTo : c.assignedTo === f['assignee'])) &&
          inRange(isoDay(new Date(c.createdAt)), range) &&
          has(c.id, c.title, c.residentName, c.residentId),
      )
      .map((c) => {
        // Resolution time runs from creation to resolution (or closure); open complaints have none.
        const done = c.status === 'Resolved' || c.status === 'Closed';
        const end = done ? (c.resolvedAt ?? c.closedAt) : undefined;
        const staff = staffById(c.assignedTo);
        return {
          ...c,
          assignee: staff?.name ?? 'Unassigned',
          assigneeRole: staff?.role ?? '',
          resolutionMs: end ? Math.max(0, Date.parse(end) - Date.parse(c.createdAt)) : undefined,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    type Row = (typeof rows)[number];
    const resolved = rows.filter((r) => r.resolutionMs !== undefined);
    const avgMs = resolved.length ? resolved.reduce((s, r) => s + r.resolutionMs!, 0) / resolved.length : undefined;
    const avg = avgMs === undefined ? '—' : formatDuration(avgMs);
    const open = rows.filter((r) => isActive(r)).length;
    const urgent = rows.filter((r) => isActive(r) && (r.priority === 'Urgent' || r.priority === 'High')).length;
    const resolution = (r: Row) => (r.resolutionMs === undefined ? '—' : formatDuration(r.resolutionMs));

    return {
      rows,
      columns: [
        { key: 'complaint', header: 'Complaint', text: (r: Row) => r.id, sub: (r: Row) => r.title, strong: true },
        { key: 'category', header: 'Category', text: (r: Row) => r.category, sub: (r: Row) => r.residentName },
        { key: 'priority', header: 'Priority', text: (r: Row) => r.priority, badge: (r: Row) => PRIORITY_TONES[r.priority] },
        { key: 'assignee', header: 'Assigned To', text: (r: Row) => r.assignee, sub: (r: Row) => r.assigneeRole },
        { key: 'created', header: 'Created', text: (r: Row) => this.fmt.date(r.createdAt), sub: (r: Row) => this.fmt.date(r.createdAt, 'time') },
        { key: 'status', header: 'Status', text: (r: Row) => r.status, badge: (r: Row) => COMPLAINT_TONES[r.status] },
        { key: 'resolution', header: 'Resolution Time', text: resolution, numeric: true },
      ],
      footer: {
        complaint: `Total: ${plural(rows.length, 'complaint')}`,
        status: `${resolved.length} resolved · ${open} open`,
        resolution: resolved.length ? `Avg ${avg}` : '—',
      },
      kpis: [
        { label: 'Complaints', value: rows.length, sub: 'Matching the filters', icon: 'support_agent', tone: 'teal' },
        { label: 'Open', value: open, sub: `${urgent} high / urgent`, icon: 'pending', tone: 'orange' },
        { label: 'Resolved / Closed', value: resolved.length, sub: 'Of the listed complaints', icon: 'task_alt', tone: 'green' },
        { label: 'Avg Resolution', value: avg, sub: resolved.length ? `Over ${plural(resolved.length, 'resolved complaint')}` : 'No resolved complaints', icon: 'timer', tone: 'blue' },
      ],
      exportColumns: [
        { header: 'Complaint ID', value: (r: Row) => r.id },
        { header: 'Title', value: (r: Row) => r.title },
        { header: 'Resident', value: (r: Row) => r.residentName },
        { header: 'Category', value: (r: Row) => r.category },
        { header: 'Priority', value: (r: Row) => r.priority },
        { header: 'Assigned To', value: (r: Row) => (r.assigneeRole ? `${r.assignee} (${r.assigneeRole})` : r.assignee) },
        { header: 'Created', value: (r: Row) => this.fmt.date(r.createdAt, 'datetime') },
        { header: 'Status', value: (r: Row) => r.status },
        { header: 'Resolution Time', value: resolution },
      ],
      exportTotals: [`Total: ${plural(rows.length, 'complaint')}`, '', '', '', '', '', '', `${resolved.length} resolved · ${open} open`, resolved.length ? `Avg ${avg}` : '—'],
    };
  }
}
