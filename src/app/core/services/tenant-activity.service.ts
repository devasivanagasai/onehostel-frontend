import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { ComplaintsService } from './complaints.service';
import { FeesService } from './fees.service';
import { LeaveOutpassService } from './leave-outpass.service';
import { RoomsService } from './rooms.service';
import { TenantContextService } from './tenant-context.service';
import { LaundryService } from '../../features/laundry/laundry.service';
import { ParcelsService } from '../../features/parcels/parcels.service';
import { VisitorsService } from '../../features/visitors/visitors.service';

export const ACTIVITY_TYPES = ['Payment', 'Complaint', 'Booking', 'Visitor', 'Leave', 'Parcel', 'Room'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  /** Local date-time, yyyy-mm-ddTHH:mm:ss */
  at: string;
  title: string;
  detail: string;
  /** Shown as a badge; payment states are shown honestly (Successful / Pending / Failed ...). */
  status: string;
  /** Invoice, receipt, complaint id, etc. */
  reference?: string;
  amount?: number;
}

export const RETENTION_NOTE = 'Your activity history is kept for the hostel\'s record-retention period and then archived. It is read-only: to correct anything, contact your hostel office.';

const dateOnly = (d: string): string => (d.length === 10 ? `${d}T00:00:00` : d.length === 16 ? `${d}:00` : d);

/**
 * A read-only, unified timeline of the Tenant's OWN records, drawn from the existing services.
 * Complaint internal notes, staff assignments and visitor ID details are never included.
 */
@Injectable({ providedIn: 'root' })
export class TenantActivityService {
  private readonly tenant = inject(TenantContextService);
  private readonly fees = inject(FeesService);
  private readonly complaints = inject(ComplaintsService);
  private readonly laundry = inject(LaundryService);
  private readonly visitors = inject(VisitorsService);
  private readonly leave = inject(LeaveOutpassService);
  private readonly parcels = inject(ParcelsService);
  private readonly rooms = inject(RoomsService);

  /** Emits the signed-in Tenant's timeline now and whenever any source changes. */
  readonly entries$: Observable<ActivityEntry[]> = combineLatest([
    this.fees.payments$,
    this.complaints.complaints$,
    this.laundry.stats$,
    this.visitors.visitors$,
    this.leave.requests$,
    this.parcels.parcels$,
    this.rooms.rooms$,
    this.tenant.resident$,
  ]).pipe(map(() => this.entries));

  get entries(): ActivityEntry[] {
    const me = this.tenant.residentId;
    return me ? this.forResident(me) : [];
  }

  /** Timeline for one resident id (newest first). Pure with respect to the source services' current data. */
  forResident(residentId: string): ActivityEntry[] {
    if (!residentId) return [];
    return [
      ...this.payments(residentId),
      ...this.complaintEntries(residentId),
      ...this.bookings(residentId),
      ...this.visitorEntries(residentId),
      ...this.leaveEntries(residentId),
      ...this.parcelEntries(residentId),
      ...this.roomEntries(residentId),
    ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }

  private payments(me: string): ActivityEntry[] {
    return this.fees.payments
      .filter((p) => p.residentId === me)
      .map((p) => ({
        id: `pay-${p.id}`,
        type: 'Payment' as const,
        at: dateOnly(p.paidAt),
        title: p.chargeDescription,
        detail: `Invoice ${p.chargeId} · ${p.method}${p.receiptId ? ` · Receipt ${p.receiptId}` : ''}`,
        status: p.status,
        reference: p.receiptId ?? p.id,
        amount: p.amount,
      }));
  }

  private complaintEntries(me: string): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    for (const c of this.complaints.complaints.filter((x) => x.residentId === me)) {
      out.push({ id: `cmp-${c.id}`, type: 'Complaint', at: dateOnly(c.createdAt), title: c.title, detail: `${c.category} complaint raised`, status: 'Open', reference: c.id });
      // Only status moves and the resolution are shown: assignments, priority changes and internal notes are not.
      c.history
        .filter((h) => h.type === 'status' || h.type === 'resolved')
        .forEach((h, i) => out.push({ id: `cmp-${c.id}-e${i}-${h.at}`, type: 'Complaint', at: dateOnly(h.at), title: c.title, detail: h.type === 'resolved' && c.resolutionNote ? `Resolved: ${c.resolutionNote}` : h.text, status: h.type === 'resolved' ? 'Resolved' : c.status, reference: c.id }));
    }
    return out;
  }

  private bookings(me: string): ActivityEntry[] {
    return this.laundry.bookings
      .filter((b) => b.residentId === me)
      .map((b) => ({ id: `bk-${b.id}`, type: 'Booking' as const, at: `${b.date}T${b.start}:00`, title: this.laundry.unit(b.unitId)?.name ?? 'Laundry booking', detail: `${b.date} ${b.start}-${b.end}`, status: b.status, reference: b.id, amount: b.amount || undefined }));
  }

  private visitorEntries(me: string): ActivityEntry[] {
    return this.visitors.visitors
      .filter((v) => v.residentId === me)
      .map((v) => ({
        id: `vis-${v.id}`,
        type: 'Visitor' as const,
        at: dateOnly(v.expectedAt),
        title: `Visitor: ${v.name}`,
        detail: `${v.purpose} · ${v.count} ${v.count === 1 ? 'person' : 'people'}${v.approvalReason ? ` · ${v.approvalReason}` : ''}`,
        status: v.approval === 'Not Required' ? v.status : v.approval === 'Approved' ? v.status : v.approval,
        reference: v.id,
      }));
  }

  private leaveEntries(me: string): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    for (const r of this.leave.requests.filter((x) => x.residentId === me)) {
      out.push({ id: `lv-${r.id}`, type: 'Leave', at: dateOnly(r.createdAt), title: `${r.type} request`, detail: `${r.departAt.replace('T', ' ')} to ${r.returnAt.replace('T', ' ')}${r.decisionReason ? ` · ${r.decisionReason}` : ''}`, status: r.status, reference: r.id });
      if (r.exitAt) out.push({ id: `lv-${r.id}-out`, type: 'Leave', at: dateOnly(r.exitAt), title: `${r.type} movement`, detail: 'Left the hostel', status: 'Out', reference: r.id });
      if (r.returnedAt) out.push({ id: `lv-${r.id}-in`, type: 'Leave', at: dateOnly(r.returnedAt), title: `${r.type} movement`, detail: 'Returned to the hostel', status: 'Returned', reference: r.id });
    }
    return out;
  }

  private parcelEntries(me: string): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    for (const p of this.parcels.parcels.filter((x) => x.residentId === me)) {
      out.push({ id: `pcl-${p.id}`, type: 'Parcel', at: dateOnly(p.receivedAt), title: `Parcel from ${p.courier}`, detail: 'Received at the front desk', status: p.status === 'Collected' || p.status === 'Returned' ? 'Received' : p.status, reference: p.id });
      if (p.collectedAt) out.push({ id: `pcl-${p.id}-c`, type: 'Parcel', at: dateOnly(p.collectedAt), title: `Parcel from ${p.courier}`, detail: 'Collected', status: 'Collected', reference: p.id });
    }
    return out;
  }

  private roomEntries(me: string): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    let hasCurrent = false;
    for (const room of this.rooms.rooms) {
      for (const bed of room.beds) {
        const where = `${room.building} · Room ${room.roomNumber} · Bed ${bed.bedNumber}`;
        for (const h of (bed.allocationHistory ?? []).filter((x) => x.residentId === me && x.allocationType !== 'Check-out')) {
          const current = !h.checkOutDate && bed.status === 'Occupied' && bed.residentId === me;
          hasCurrent = hasCurrent || current;
          out.push({ id: `rm-${h.id}`, type: 'Room', at: dateOnly(h.allocatedDate), title: h.allocationType === 'Transfer' ? 'Moved to a new room' : 'Room allocated', detail: where, status: current ? 'Current' : 'Previous', reference: h.id });
          if (h.checkOutDate) out.push({ id: `rm-${h.id}-out`, type: 'Room', at: dateOnly(h.checkOutDate), title: 'Left this bed', detail: where, status: 'Previous', reference: h.id });
        }
        if (!hasCurrent && bed.status === 'Occupied' && bed.residentId === me && bed.joinedDate && !(bed.allocationHistory ?? []).some((x) => x.residentId === me)) {
          hasCurrent = true;
          out.push({ id: `rm-cur-${bed.id}`, type: 'Room', at: dateOnly(bed.joinedDate), title: 'Room allocated', detail: where, status: 'Current', reference: bed.id });
        }
      }
    }
    return out;
  }
}
