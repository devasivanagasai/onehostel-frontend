import { Injectable, inject } from '@angular/core';
import {
  ALL,
  AgingRow,
  AnalyticsFilters,
  AnalyticsReport,
  AnalyticsSection,
  ComplaintGroupRow,
  ComplaintResult,
  MOVEMENT_KINDS,
  MachineUsageRow,
  MealRow,
  MessDay,
  MessResult,
  MethodRow,
  MovementEvent,
  MovementKind,
  MovementMonth,
  MovementResult,
  OccupancyPoint,
  OccupancyResult,
  PeakSlot,
  RevenueResult,
  SECTION_LABELS,
  ServiceResult,
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  round1,
  round2,
} from '../models/analytics.models';
import { COMPLAINT_PRIORITIES, Complaint, staffLabel } from '../models/complaints.models';
import { HostelResident, RESIDENT_STATUSES, RESIDENT_TYPES, residentFullName } from '../models/residents.models';
import { Room } from '../models/rooms.models';
import { MEAL_PLANS, MEAL_TYPES } from '../../features/mess/mess.models';
import { OWNER_HOSTEL, ReportExportColumn } from '../../features/hostel-reports/hostel-reports.models';
import { downloadReportCsv } from '../../features/hostel-reports/hostel-report-csv';
import { LaundryService } from '../../features/laundry/laundry.service';
import { MessService } from '../../features/mess/mess.service';
import { localDateIso } from '../../shared/utils/local-date';
import { AppFormatService } from './app-format.service';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { ComplaintsService } from './complaints.service';
import { FeesService } from './fees.service';
import { LeaveOutpassService } from './leave-outpass.service';
import { ReportExportService } from './report-export.service';
import { ResidentsService } from './residents.service';
import { RoomsService } from './rooms.service';

// All figures are read from the other modules' records (read-only). The report functions are pure with
// respect to those records and the filters, so they can be called from the console, e.g.
//   ng.getComponent(...).service.occupancyTrend(filters)

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A resident's stay in one bed. `to` is the check-out / transfer date (the bed is free from that date). */
interface Stay {
  residentId: string;
  bedId: string;
  roomId: string;
  from: string;
  to?: string;
}

export interface AnalyticsExport {
  title: string;
  /** Header block for the CSV (and the PDF summary). */
  meta: [string, string][];
  columns: ReportExportColumn[];
  rows: unknown[];
  /** One cell per column. */
  totals: (string | number)[];
}

// ---- Date helpers (hostel-local) --------------------------------------------------

const parseDate = (d: string): Date => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
/** Whole-day number independent of DST. */
const dayNo = (d: string): number => Math.floor(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY);
const addDays = (d: string, n: number): string => {
  const x = parseDate(d);
  x.setDate(x.getDate() + n);
  return localDateIso(x);
};
const monthEnd = (ym: string): string => localDateIso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
const monthLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const inRange = (date: string, f: AnalyticsFilters): boolean => date >= f.from && date <= f.to;
const hoursBetween = (a: string, b: string): number => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const avg = (xs: number[]): number | null => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly residents = inject(ResidentsService);
  private readonly rooms = inject(RoomsService);
  private readonly fees = inject(FeesService);
  private readonly complaints = inject(ComplaintsService);
  private readonly laundry = inject(LaundryService);
  private readonly mess = inject(MessService);
  private readonly leave = inject(LeaveOutpassService);
  private readonly auth = inject(AuthService);
  private readonly audit = inject(AuditLogService);
  private readonly exporter = inject(ReportExportService);
  private readonly fmt = inject(AppFormatService);

  readonly hostel = OWNER_HOSTEL;

  // ---- Filters ----------------------------------------------------------------------

  /** Last 90 days up to and including today. */
  defaultFilters(): AnalyticsFilters {
    const today = localDateIso();
    return { from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), to: today, building: ALL, roomType: ALL, residentType: ALL, residentStatus: ALL };
  }

  /** Problems with the date range (empty = valid). */
  filterErrors(f: AnalyticsFilters): string[] {
    if (!ISO_DATE.test(f.from ?? '') || !ISO_DATE.test(f.to ?? '')) return ['Enter both a start and an end date.'];
    if (f.to < f.from) return ['The end date cannot be before the start date.'];
    const days = dayNo(f.to) - dayNo(f.from) + 1;
    if (days > MAX_RANGE_DAYS) return [`The range can be at most ${MAX_RANGE_DAYS} days (${days} selected).`];
    return [];
  }

  get buildings(): string[] {
    return [...new Set(this.rooms.rooms.map((r) => r.building))].sort();
  }

  filterSummary(f: AnalyticsFilters): string {
    return [
      `Period: ${f.from} to ${f.to}`,
      `Building: ${f.building}`,
      `Room type: ${f.roomType}`,
      `Resident type: ${f.residentType}`,
      `Resident status: ${f.residentStatus}`,
    ].join('; ');
  }

  report(f: AnalyticsFilters): AnalyticsReport {
    return {
      filters: { ...f },
      occupancy: this.occupancyTrend(f),
      movement: this.movement(f),
      revenue: this.revenueAndDues(f),
      complaints: this.complaintPerformance(f),
      service: this.serviceUtilization(f),
      mess: this.messUtilization(f),
    };
  }

  // ---- Occupancy ----------------------------------------------------------------------

  /** Per month in range: total beds, beds occupied at the month-end snapshot, occupancy %. */
  occupancyTrend(f: AnalyticsFilters): OccupancyResult {
    this.assertValid(f);
    const stays = this.stays();
    const ok = this.residentPredicate(f, false);
    const rooms = this.rooms.rooms.filter((r) => this.roomMatches(r, f));
    const beds = rooms.flatMap((r) => r.beds.map((b) => b.id));
    const byBed = new Map<string, Stay[]>();
    for (const s of stays) byBed.set(s.bedId, [...(byBed.get(s.bedId) ?? []), s]);

    const points: OccupancyPoint[] = monthsIn(f.from, f.to).map((month) => {
      // Snapshot at month end 23:59; the last month stops at the end of the range.
      const snap = monthEnd(month) < f.to ? monthEnd(month) : f.to;
      const occupied = beds.filter((id) => (byBed.get(id) ?? []).some((s) => ok(s.residentId) && s.from <= snap && (!s.to || s.to > snap))).length;
      return {
        month,
        label: monthLabel(month),
        snapshotDate: snap,
        totalBeds: beds.length,
        occupiedBeds: occupied,
        occupancyPct: beds.length ? round1((occupied / beds.length) * 100) : 0,
      };
    });
    return { points, latest: points[points.length - 1] };
  }

  // ---- Resident movement ------------------------------------------------------------

  movement(f: AnalyticsFilters): MovementResult {
    this.assertValid(f);
    const ok = this.residentPredicate(f, true);
    const events: MovementEvent[] = [];

    for (const r of this.residents.residents) {
      if (!ok(r.residentId)) continue;
      const name = residentFullName(r);
      const push = (date: string, kind: MovementKind, detail: string) => {
        if (inRange(date, f)) events.push({ date, residentId: r.residentId, residentName: name, kind, detail });
      };
      const history = [...r.activity].sort((a, b) => a.at.localeCompare(b.at));
      let checkedOutBefore = false;
      let allocated = false;
      for (const a of history) {
        const date = a.at.slice(0, 10);
        if (a.action === 'Bed allocated') {
          allocated = true;
          push(date, checkedOutBefore ? 'Re-admission' : 'Joining', a.details ?? '');
        } else if (a.action === 'Bed transferred') push(date, 'Transfer', a.details ?? '');
        else if (a.action === 'Status changed' && /→\s*On Leave$/.test(a.details ?? '')) push(date, 'Leave', a.details ?? '');
        else if (a.action === 'Checked out') {
          push(date, 'Checkout', a.details ?? '');
          checkedOutBefore = true;
        }
      }
      // Residents that joined without a recorded bed allocation still count as joined on their joining date.
      if (!allocated && r.status !== 'Invited') push(r.joiningDate, 'Joining', 'Joined (no bed recorded)');
    }
    events.sort((a, b) => b.date.localeCompare(a.date) || a.residentId.localeCompare(b.residentId));

    const blank = (): Record<MovementKind, number> => ({ Joining: 0, Transfer: 0, Leave: 0, Checkout: 0, 'Re-admission': 0 });
    const totals = blank();
    const months: MovementMonth[] = monthsIn(f.from, f.to).map((m) => ({ month: m, label: monthLabel(m), counts: blank() }));
    for (const e of events) {
      totals[e.kind]++;
      months.find((m) => m.month === e.date.slice(0, 7))!.counts[e.kind]++;
    }

    const approvedLeaveRequests = this.leave.requests.filter(
      (q) => q.type === 'Leave' && q.status === 'Approved' && inRange(q.departAt.slice(0, 10), f) && ok(q.residentId),
    ).length;
    return { totals, months, events, approvedLeaveRequests };
  }

  // ---- Revenue & dues -----------------------------------------------------------------

  revenueAndDues(f: AnalyticsFilters): RevenueResult {
    this.assertValid(f);
    const ok = this.residentPredicate(f, true);
    const charges = this.fees.charges.filter((c) => ok(c.residentId));
    const payments = this.fees.payments.filter((p) => ok(p.residentId));

    const raised = charges.filter((c) => !c.cancelledAt && inRange(c.issueDate, f));
    const waived = charges.filter((c) => c.cancelledAt && inRange(c.issueDate, f));

    // Only successful payments are collected receipts.
    const collectedPayments = payments.filter((p) => p.status === 'Successful' && inRange(p.paidAt.slice(0, 10), f));
    const methods = new Map<string, MethodRow>();
    for (const p of collectedPayments) {
      const row = methods.get(p.method) ?? { method: p.method, count: 0, amount: 0 };
      row.count++;
      row.amount = round2(row.amount + p.amount);
      methods.set(p.method, row);
    }
    const byMethod = [...methods.values()].sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));

    // Reversal / refund is dated by its history entry (falls back to the payment date).
    const eventDate = (p: (typeof payments)[number], word: string): string =>
      (p.history.find((h) => h.action.toLowerCase().includes(word))?.at ?? p.paidAt).slice(0, 10);
    const tally = (status: 'Refunded' | 'Reversed', word: string) => {
      const list = payments.filter((p) => p.status === status && inRange(eventDate(p, word), f));
      return { count: list.length, amount: round2(list.reduce((s, p) => s + p.amount, 0)) };
    };

    // Outstanding as of the end of the range (never later than today).
    const today = localDateIso();
    const asOf = f.to < today ? f.to : today;
    const aging: AgingRow[] = [
      { bucket: '0-30', count: 0, amount: 0 },
      { bucket: '31-60', count: 0, amount: 0 },
      { bucket: '61-90', count: 0, amount: 0 },
      { bucket: '90+', count: 0, amount: 0 },
    ];
    let outstanding = 0;
    let outstandingCount = 0;
    for (const c of charges) {
      if (c.issueDate > asOf || (c.cancelledAt && c.cancelledAt.slice(0, 10) <= asOf)) continue;
      const paid = payments.filter((p) => p.chargeId === c.id && p.status === 'Successful' && p.paidAt.slice(0, 10) <= asOf).reduce((s, p) => s + p.amount, 0);
      const balance = round2(c.total - paid);
      if (balance <= 0) continue;
      const late = dayNo(asOf) - dayNo(c.dueDate);
      const row = aging[late <= 30 ? 0 : late <= 60 ? 1 : late <= 90 ? 2 : 3];
      row.count++;
      row.amount = round2(row.amount + balance);
      outstanding = round2(outstanding + balance);
      outstandingCount++;
    }

    return {
      chargesRaised: round2(raised.reduce((s, c) => s + c.total, 0)),
      chargesCount: raised.length,
      cancelledAmount: round2(waived.reduce((s, c) => s + c.total, 0)),
      collected: round2(collectedPayments.reduce((s, p) => s + p.amount, 0)),
      paymentsCount: collectedPayments.length,
      byMethod,
      refunds: tally('Refunded', 'refund'),
      reversals: tally('Reversed', 'revers'),
      outstanding,
      outstandingCount,
      aging,
      asOf,
    };
  }

  // ---- Complaints ---------------------------------------------------------------------

  complaintPerformance(f: AnalyticsFilters): ComplaintResult {
    this.assertValid(f);
    const ok = this.residentPredicate(f, true);
    const list = this.complaints.complaints.filter((c) => inRange(c.createdAt.slice(0, 10), f) && ok(c.residentId));

    const resolution = (c: Complaint): number | null => (c.resolvedAt ? Math.max(0, hoursBetween(c.createdAt, c.resolvedAt)) : null);
    // First response: the first assignment, status change, note or resolution after the complaint was raised.
    const firstResponse = (c: Complaint): number | null => {
      const e = [...c.history]
        .sort((a, b) => a.at.localeCompare(b.at))
        .find((h) => ['assigned', 'status', 'note', 'resolved'].includes(h.type) && h.at >= c.createdAt);
      return e ? Math.max(0, hoursBetween(c.createdAt, e.at)) : null;
    };
    const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
    const row = (key: string, items: Complaint[]): ComplaintGroupRow => ({
      key,
      count: items.length,
      avgResolutionHours: avg(nums(items.map(resolution))),
      avgFirstResponseHours: avg(nums(items.map(firstResponse))),
      reopened: items.reduce((s, c) => s + c.reopenCount, 0),
    });
    const group = (keyOf: (c: Complaint) => string, order?: readonly string[]): ComplaintGroupRow[] => {
      const keys = [...new Set(list.map(keyOf))];
      keys.sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : 0) || a.localeCompare(b));
      return keys.map((k) => row(k, list.filter((c) => keyOf(c) === k)));
    };

    const overall = row('All', list);
    const firsts = nums(list.map(firstResponse));
    return {
      total: list.length,
      resolved: list.filter((c) => c.resolvedAt).length,
      reopened: overall.reopened,
      avgResolutionHours: overall.avgResolutionHours,
      hasFirstResponse: firsts.length > 0,
      avgFirstResponseHours: overall.avgFirstResponseHours,
      byCategory: group((c) => c.category),
      byPriority: group((c) => c.priority, COMPLAINT_PRIORITIES),
      byAssignee: group((c) => staffLabel(c.assignedTo)),
    };
  }

  // ---- Services (laundry) -------------------------------------------------------------

  serviceUtilization(f: AnalyticsFilters): ServiceResult {
    this.assertValid(f);
    const ok = this.residentPredicate(f, true);
    const list = this.laundry.bookings.filter((b) => inRange(b.date, f) && ok(b.residentId));
    const count = (status: string) => list.filter((b) => b.status === status).length;
    const minutes = (b: { start: string; end: string }) => Math.max(0, Number(b.end.slice(0, 2)) * 60 + Number(b.end.slice(3, 5)) - (Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3, 5))));

    const byUnit: MachineUsageRow[] = this.laundry.units
      .map((u) => {
        const mine = list.filter((b) => b.unitId === u.id);
        return {
          unit: u.name,
          bookings: mine.length,
          completed: mine.filter((b) => b.status === 'Completed').length,
          cancelled: mine.filter((b) => b.status === 'Cancelled').length,
          noShows: mine.filter((b) => b.status === 'No-show').length,
          hoursUsed: round1(mine.filter((b) => b.status === 'Completed').reduce((s, b) => s + minutes(b), 0) / 60),
        };
      })
      .filter((r) => r.bookings > 0)
      .sort((a, b) => b.bookings - a.bookings || a.unit.localeCompare(b.unit));

    // Demand by start hour; cancelled bookings never held the slot.
    const slots = new Map<string, number>();
    for (const b of list.filter((x) => x.status !== 'Cancelled')) {
      const slot = `${b.start.slice(0, 2)}:00`;
      slots.set(slot, (slots.get(slot) ?? 0) + 1);
    }
    const peakSlots: PeakSlot[] = [...slots.entries()]
      .map(([slot, bookings]) => ({ slot, bookings }))
      .sort((a, b) => b.bookings - a.bookings || a.slot.localeCompare(b.slot))
      .slice(0, 5);

    return {
      bookings: list.length,
      completed: count('Completed'),
      cancelled: count('Cancelled'),
      noShows: count('No-show'),
      open: count('Requested') + count('Confirmed'),
      byUnit,
      peakSlots,
    };
  }

  // ---- Mess ---------------------------------------------------------------------------

  messUtilization(f: AnalyticsFilters): MessResult {
    this.assertValid(f);
    const ok = this.residentPredicate(f, true);
    const meals = new Map(MEAL_TYPES.map((m) => [m, { present: 0, optedOut: 0 }]));
    const days: MessDay[] = [];

    for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
      const day: MessDay = { date: d, present: 0, optedOut: 0 };
      for (const meal of MEAL_TYPES) {
        for (const [id, mark] of Object.entries(this.mess.marks(d, meal))) {
          if (!ok(id)) continue;
          const m = meals.get(meal)!;
          if (mark === 'Present') {
            m.present++;
            day.present++;
          } else {
            m.optedOut++;
            day.optedOut++;
          }
        }
      }
      if (day.present || day.optedOut) days.push(day);
    }

    const pct = (present: number, out: number): number | null => (present + out ? round1((present / (present + out)) * 100) : null);
    const byMeal: MealRow[] = MEAL_TYPES.map((meal) => {
      const m = meals.get(meal)!;
      return { meal, present: m.present, optedOut: m.optedOut, participationPct: pct(m.present, m.optedOut) };
    });
    const totalPresent = byMeal.reduce((s, m) => s + m.present, 0);
    const totalOptedOut = byMeal.reduce((s, m) => s + m.optedOut, 0);

    const current = this.mess.currentResidents.filter((r) => ok(r.residentId));
    const plans = MEAL_PLANS.map((plan) => ({ plan, residents: current.filter((r) => this.mess.profile(r.residentId).plan === plan).length }));

    return { byMeal, byDate: days, plans, totalPresent, totalOptedOut, participationPct: pct(totalPresent, totalOptedOut) };
  }

  // ---- Export (Hostel Owner only; always audited) -------------------------------------

  /** Flat table behind a section's Excel / PDF export. */
  exportTable(section: AnalyticsSection, f: AnalyticsFilters): AnalyticsExport {
    this.assertValid(f);
    const num = (header: string, value: (r: any) => string | number, money = false): ReportExportColumn => ({ header, value, numeric: true, money });
    const txt = (header: string, value: (r: any) => string | number): ReportExportColumn => ({ header, value });
    const meta: [string, string][] = [
      ['Report', SECTION_LABELS[section]],
      ['Hostel', `${this.hostel.name} (${this.hostel.id})`],
      ['Filters applied', this.filterSummary(f)],
    ];
    const title = SECTION_LABELS[section];

    switch (section) {
      case 'occupancy': {
        const r = this.occupancyTrend(f);
        const l = r.latest;
        return {
          title, meta: [...meta, ['Definition', OCCUPANCY_NOTE]],
          columns: [txt('Month', (p) => p.label), txt('Snapshot date', (p) => p.snapshotDate), num('Total beds', (p) => p.totalBeds), num('Occupied beds', (p) => p.occupiedBeds), num('Occupancy %', (p) => p.occupancyPct)],
          rows: r.points,
          totals: ['Latest month', l?.snapshotDate ?? '—', l?.totalBeds ?? 0, l?.occupiedBeds ?? 0, l?.occupancyPct ?? 0],
        };
      }
      case 'movement': {
        const r = this.movement(f);
        return {
          title, meta: [...meta, ['Definition', MOVEMENT_NOTE]],
          columns: [txt('Month', (m) => m.label), ...MOVEMENT_KINDS.map((k) => num(k, (m) => m.counts[k]))],
          rows: r.months,
          totals: ['Total', ...MOVEMENT_KINDS.map((k) => r.totals[k])],
        };
      }
      case 'revenue': {
        const r = this.revenueAndDues(f);
        const rows: { group: string; item: string; count: number; amount: number }[] = [
          { group: 'Charges', item: 'Charges raised', count: r.chargesCount, amount: r.chargesRaised },
          ...r.byMethod.map((m) => ({ group: 'Collected', item: m.method, count: m.count, amount: m.amount })),
          { group: 'Refunds & reversals (not collected)', item: 'Refunds', count: r.refunds.count, amount: r.refunds.amount },
          { group: 'Refunds & reversals (not collected)', item: 'Reversals', count: r.reversals.count, amount: r.reversals.amount },
          ...r.aging.map((a) => ({ group: 'Outstanding aging', item: `${a.bucket} days`, count: a.count, amount: a.amount })),
        ];
        return {
          title, meta: [...meta, ['Total collected', String(r.collected)], ['Outstanding as of ' + r.asOf, String(r.outstanding)], ['Definition', REVENUE_NOTE]],
          columns: [txt('Group', (x) => x.group), txt('Item', (x) => x.item), num('Count', (x) => x.count), num('Amount', (x) => x.amount, true)],
          rows,
          totals: ['Outstanding (sum of aging buckets)', '', r.outstandingCount, r.outstanding],
        };
      }
      case 'complaints': {
        const r = this.complaintPerformance(f);
        const rows = [
          ...r.byCategory.map((x) => ({ group: 'Category', ...x })),
          ...r.byPriority.map((x) => ({ group: 'Priority', ...x })),
          ...r.byAssignee.map((x) => ({ group: 'Assignee', ...x })),
        ];
        const hrs = (v: number | null) => (v === null ? '—' : v);
        const columns = [
          txt('Group', (x) => x.group), txt('Value', (x) => x.key), num('Complaints', (x) => x.count),
          ...(r.hasFirstResponse ? [num('Avg first response (h)', (x) => hrs(x.avgFirstResponseHours))] : []),
          num('Avg resolution (h)', (x) => hrs(x.avgResolutionHours)), num('Reopened', (x) => x.reopened),
        ];
        return {
          title, meta, columns, rows,
          totals: ['All complaints', '', r.total, ...(r.hasFirstResponse ? [hrs(r.avgFirstResponseHours)] : []), hrs(r.avgResolutionHours), r.reopened],
        };
      }
      case 'service': {
        const r = this.serviceUtilization(f);
        return {
          title, meta,
          columns: [txt('Machine / service', (u) => u.unit), num('Bookings', (u) => u.bookings), num('Completed', (u) => u.completed), num('Cancelled', (u) => u.cancelled), num('No-shows', (u) => u.noShows), num('Hours used', (u) => u.hoursUsed)],
          rows: r.byUnit,
          totals: ['Total', r.bookings, r.completed, r.cancelled, r.noShows, round1(r.byUnit.reduce((s, u) => s + u.hoursUsed, 0))],
        };
      }
      case 'mess': {
        const r = this.messUtilization(f);
        return {
          title, meta,
          columns: [txt('Meal', (m) => m.meal), num('Present', (m) => m.present), num('Opted out', (m) => m.optedOut), num('Participation %', (m) => (m.participationPct === null ? '—' : m.participationPct))],
          rows: r.byMeal,
          totals: ['Total', r.totalPresent, r.totalOptedOut, r.participationPct === null ? '—' : r.participationPct],
        };
      }
    }
  }

  /**
   * Excel (CSV) or PDF (print) export of one section. Hostel Owner only; every attempt is audited
   * with the filters ('Export Data'), failed ones as Failed.
   */
  exportReport(section: AnalyticsSection, format: 'excel' | 'pdf', f: AnalyticsFilters): void {
    const label = SECTION_LABELS[section];
    const filters = this.filterSummary(f);
    if (!this.auth.isHostelOwner) {
      this.audit.record('Export Data', `Analytics · ${label}`, { status: 'Failed', details: `${format.toUpperCase()} export refused: Hostel Owner only. Filters: ${filters}` });
      throw new Error('Exports are restricted to the Hostel Owner.');
    }
    const t = this.exportTable(section, f);
    const generated = this.fmt.date(new Date(), 'datetime');
    if (format === 'excel') {
      downloadReportCsv(`${this.hostel.name} Analytics ${label}`, [...t.meta, ['Generated', generated], ['Records', String(t.rows.length)]], t.columns, t.rows, t.totals);
    } else {
      const money = (v: string | number) => (typeof v === 'number' ? this.fmt.money(v) : v);
      this.exporter.exportPdf({
        title: `Analytics: ${label} - ${this.hostel.name}`,
        filterSummary: `Hostel: ${this.hostel.name} (${this.hostel.id}) · Filters: ${filters}`,
        columns: t.columns.map((c) => ({ header: c.header, numeric: c.money || c.numeric, value: (row: unknown) => (c.money ? money(c.value(row)) : c.value(row)) })),
        rows: t.rows,
        totals: t.totals.map((v, i) => (t.columns[i]?.money ? money(v) : v)),
      });
    }
    this.audit.record('Export Data', `Analytics · ${label}`, { details: `${format === 'excel' ? 'Excel' : 'PDF'} export of ${t.rows.length} row(s). Hostel: ${this.hostel.name}. Filters: ${filters}` });
  }

  // ---- Internals ----------------------------------------------------------------------

  private assertValid(f: AnalyticsFilters): void {
    const errors = this.filterErrors(f);
    if (errors.length) throw new Error(errors[0]);
  }

  private roomMatches(r: Room, f: AnalyticsFilters): boolean {
    return (f.building === ALL || r.building === f.building) && (f.roomType === ALL || r.roomType === f.roomType);
  }

  /**
   * Every stay in a bed, from allocation history (transfers close one stay and open another).
   * An occupied bed with no open history entry (older data) falls back to the bed's joined date.
   */
  private stays(): Stay[] {
    const out: Stay[] = [];
    for (const room of this.rooms.rooms) {
      for (const bed of room.beds) {
        const history = bed.allocationHistory ?? [];
        for (const h of history) {
          if (h.allocationType === 'Check-out') continue;
          out.push({ residentId: h.residentId, bedId: bed.id, roomId: room.id, from: h.allocatedDate, to: h.checkOutDate });
        }
        if (bed.status === 'Occupied' && bed.residentId && !history.some((h) => h.residentId === bed.residentId && !h.checkOutDate)) {
          const joined = bed.joinedDate ?? this.residents.byId(bed.residentId)?.joiningDate ?? '0000-01-01';
          out.push({ residentId: bed.residentId, bedId: bed.id, roomId: room.id, from: joined });
        }
      }
    }
    return out;
  }

  /**
   * Which residents the filters let through: resident type and status always; with `withRoom`, a
   * building / room type filter also requires a stay in a matching room.
   */
  private residentPredicate(f: AnalyticsFilters, withRoom: boolean): (id: string) => boolean {
    const byId = new Map<string, HostelResident>(this.residents.residents.map((r) => [r.residentId, r]));
    let inRooms: Set<string> | null = null;
    if (withRoom && (f.building !== ALL || f.roomType !== ALL)) {
      const matching = new Set(this.rooms.rooms.filter((r) => this.roomMatches(r, f)).map((r) => r.id));
      inRooms = new Set(this.stays().filter((s) => matching.has(s.roomId)).map((s) => s.residentId));
    }
    return (id: string) => {
      const r = byId.get(id);
      if (!r) return false;
      if (f.residentType !== ALL && r.residentType !== f.residentType) return false;
      if (f.residentStatus !== ALL && r.status !== f.residentStatus) return false;
      return !inRooms || inRooms.has(id);
    };
  }

  /** Option lists for the filter dropdowns. */
  readonly residentTypes = RESIDENT_TYPES;
  readonly residentStatuses = RESIDENT_STATUSES;
}

// Short definitions repeated in exports (full text in analytics.models.ts).
const OCCUPANCY_NOTE = 'Reserved beds are not counted as occupied. Snapshot at month end 23:59 hostel-local (last month: end of range).';
const MOVEMENT_NOTE = 'Counted from resident activity history by activity date.';
const REVENUE_NOTE = 'Collected = successful payments only. Refunds and reversals shown separately. Outstanding measured as of the end of the range.';
