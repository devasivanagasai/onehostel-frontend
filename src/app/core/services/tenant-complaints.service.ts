import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ComplaintsService, CONFIRMED_TEXT, INTERNAL_NOTE, TENANT_AUTHOR } from './complaints.service';
import { ResidentsService } from './residents.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { Complaint, ComplaintAttachment, ComplaintCategory, ComplaintEvent, ComplaintPriority, ComplaintStatus, REOPEN_WINDOW_DAYS, staffById } from '../models/complaints.models';
import { TenantAttachmentMeta, assertAttachments } from '../models/tenant-support.models';
import { residentFullName } from '../models/residents.models';

const META_KEY = 'onehostel_tenant_complaint_meta_v1';
const SEED_FLAG = 'onehostel_tenant_complaints_seeded_v1';

/** Categories a Tenant can pick (FRD 5.6.1). "Room" is stored as "Other" in the shared complaint record. */
export const TENANT_COMPLAINT_CATEGORIES = ['Plumbing', 'Electrical', 'Cleaning', 'Wi-Fi', 'Furniture', 'Room', 'Other'] as const;
export type TenantComplaintCategory = (typeof TENANT_COMPLAINT_CATEGORIES)[number];

export const TENANT_CATEGORY_ICONS: Record<TenantComplaintCategory, string> = {
  Plumbing: 'plumbing',
  Electrical: 'bolt',
  Cleaning: 'cleaning_services',
  'Wi-Fi': 'wifi',
  Furniture: 'chair',
  Room: 'meeting_room',
  Other: 'report_problem',
};

/** A Tenant may suggest these; Urgent is only ever set by the hostel. */
export const TENANT_PRIORITIES = ['Low', 'Medium', 'High'] as const;
export type TenantSuggestedPriority = (typeof TENANT_PRIORITIES)[number];

export const LOCATION_KINDS = ['My room', 'Common area', 'Other'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const TITLE_MAX = 100;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const REASON_MIN = 10;
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface TenantComplaintInput {
  category: TenantComplaintCategory;
  title: string;
  description: string;
  locationKind: LocationKind;
  /** Required for "Common area" and "Other"; ignored for "My room". */
  locationDetail: string;
  priority: TenantSuggestedPriority;
  attachments: TenantAttachmentMeta[];
}

export interface TenantComplaintUpdate {
  at: string;
  /** "You" for the Tenant's own entries, otherwise "Hostel team" (never an individual's name). */
  by: 'You' | 'Hostel team';
  kind: 'submitted' | 'assigned' | 'status' | 'note' | 'resolved';
  text: string;
}

export interface TenantComplaintView {
  id: string;
  category: TenantComplaintCategory;
  title: string;
  description: string;
  location: string;
  status: ComplaintStatus;
  /** The hostel's current priority (starts as the Tenant's suggestion). */
  priority: ComplaintPriority;
  createdAt: string;
  updatedAt: string;
  /** Team or category name, e.g. "Plumber team". */
  assignedTeam: string;
  updates: TenantComplaintUpdate[];
  resolutionNote?: string;
  resolvedAt?: string;
  attachments: TenantAttachmentMeta[];
  reopenCount: number;
  canComment: boolean;
  /** Resolved and the Tenant has not yet confirmed. */
  canConfirm: boolean;
  confirmed: boolean;
  canReopen: boolean;
  /** Why reopening is not offered on a Resolved complaint (outside the window). */
  reopenBlockedReason?: string;
  /** Last moment the complaint can be reopened (yyyy-mm-ddTHH:mm:ss), when Resolved. */
  reopenUntil?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localIso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hoursAgo = (h: number): string => localIso(new Date(Date.now() - h * 3_600_000));

/** Attachments keep only name, type and size: the size lives in the (unused) url as "meta:<bytes>". */
const toStored = (a: TenantAttachmentMeta, i: number): ComplaintAttachment => ({ id: `ATT-${Date.now()}-${i}`, name: a.name, type: a.type, url: `meta:${a.size}` });
const fromStored = (a: ComplaintAttachment): TenantAttachmentMeta => ({ name: a.name, type: a.type, size: Number(a.url.startsWith('meta:') ? a.url.slice(5) : 0) || 0 });

/**
 * Complaints for the signed-in Tenant. Every read is filtered to the Tenant's own resident id and every
 * mutation checks ownership (ComplaintsService.requireOwned) so another resident's complaint is never
 * visible or changeable, whatever id is passed in.
 */
@Injectable({ providedIn: 'root' })
export class TenantComplaintsService {
  private readonly tenant = inject(TenantContextService);
  private readonly complaints = inject(ComplaintsService);
  private readonly residents = inject(ResidentsService);
  private readonly notifications = inject(TenantNotificationService);

  /** Complaint id -> category the Tenant picked (only needed for "Room", which the shared record stores as "Other"). */
  private readonly meta = new BehaviorSubject<Record<string, TenantComplaintCategory>>(this.loadMeta());

  /** The signed-in Tenant's complaints, newest first. Emits nothing but an empty list for anyone else. */
  readonly mine$: Observable<TenantComplaintView[]> = combineLatest([this.complaints.complaints$, this.meta]).pipe(map(([list]) => this.ownViews(list)));

  constructor() {
    this.seedDemo();
  }

  get mine(): TenantComplaintView[] {
    return this.ownViews(this.complaints.complaints);
  }

  /** One of the Tenant's own complaints; throws "Complaint not found." for anyone else's. */
  get(id: string): TenantComplaintView {
    return this.toView(this.requireOwn(id));
  }

  /** Raise a complaint for the signed-in Tenant. Returns the new complaint (its id is the confirmation reference). */
  raise(input: TenantComplaintInput): TenantComplaintView {
    const me = this.tenant.requireResidentId();
    const resident = this.tenant.requireResident();
    if (resident.deactivatedAt || (resident.status !== 'Active' && resident.status !== 'On Leave')) {
      throw new Error('Only current tenants can raise complaints. Contact the hostel office.');
    }

    const title = input.title.trim();
    const description = input.description.trim();
    if (!title) throw new Error('Title is required.');
    if (title.length > TITLE_MAX) throw new Error(`Title can be up to ${TITLE_MAX} characters.`);
    if (!TENANT_COMPLAINT_CATEGORIES.includes(input.category)) throw new Error('Choose a category.');
    if (description.length < DESCRIPTION_MIN) throw new Error(`Describe the issue in at least ${DESCRIPTION_MIN} characters.`);
    if (description.length > DESCRIPTION_MAX) throw new Error(`Description can be up to ${DESCRIPTION_MAX} characters.`);
    if (!(TENANT_PRIORITIES as readonly string[]).includes(input.priority)) throw new Error('You can suggest Low, Medium or High priority. The hostel sets Urgent.');
    assertAttachments(input.attachments);
    const location = this.resolveLocation(input);

    const now = Date.now();
    const duplicate = this.mine.find((c) => c.category === input.category && c.title.trim().toLowerCase() === title.toLowerCase() && now - new Date(c.createdAt).getTime() < DUPLICATE_WINDOW_MS);
    if (duplicate) throw new Error(`You already submitted this complaint a moment ago (${duplicate.id}). Please wait a couple of minutes before sending it again.`);

    const created = this.complaints.createForTenant(me, {
      category: this.stored(input.category),
      title,
      description,
      priority: input.priority,
      location,
      attachments: input.attachments.map(toStored),
    });
    this.setMeta(created.id, input.category);
    this.notify(me, `${created.id} was received. We will post updates here.`);
    return this.toView(created);
  }

  /** Add a follow-up comment (not on a Closed complaint). */
  comment(id: string, text: string): TenantComplaintView {
    const me = this.tenant.requireResidentId();
    this.requireOwn(id);
    return this.toView(this.complaints.tenantComment(me, id, text));
  }

  /** Tell the hostel the Resolved complaint is fixed. It stays Resolved. */
  confirmResolved(id: string): TenantComplaintView {
    const me = this.tenant.requireResidentId();
    this.requireOwn(id);
    return this.toView(this.complaints.tenantConfirmResolved(me, id));
  }

  /** Reopen a Resolved complaint within the reopen window, with a reason (10+ characters). */
  reopen(id: string, reason: string): TenantComplaintView {
    const me = this.tenant.requireResidentId();
    this.requireOwn(id);
    const next = this.complaints.tenantReopen(me, id, reason);
    this.notify(me, `Your request to reopen ${next.id} was sent to the hostel.`);
    return this.toView(next);
  }

  // ---------------------------------------------------------------------------

  private requireOwn(id: string): Complaint {
    const me = this.tenant.requireResidentId();
    const c = this.complaints.byId(id);
    if (!c || c.residentId !== me) throw new Error('Complaint not found.');
    return c;
  }

  private ownViews(list: Complaint[]): TenantComplaintView[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    return list
      .filter((c) => c.residentId === me)
      .map((c) => this.toView(c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  private resolveLocation(input: TenantComplaintInput): string {
    if (!LOCATION_KINDS.includes(input.locationKind)) throw new Error('Choose where the issue is.');
    if (input.locationKind === 'My room') {
      const alloc = this.tenant.allocation;
      if (!alloc) throw new Error('You do not have a room allocated. Choose Common area or Other and describe the location.');
      return this.residents.describe(alloc);
    }
    const detail = input.locationDetail.trim();
    if (detail.length < 2) throw new Error('Tell us the location.');
    if (detail.length > 80) throw new Error('Location can be up to 80 characters.');
    return `${input.locationKind}: ${detail}`;
  }

  private stored(c: TenantComplaintCategory): ComplaintCategory {
    return c === 'Room' ? 'Other' : c;
  }

  private toView(c: Complaint): TenantComplaintView {
    const category = this.meta.value[c.id] ?? (c.category as TenantComplaintCategory);
    const confirmed = c.status === 'Resolved' && c.history.some((e) => e.by === TENANT_AUTHOR && e.text === CONFIRMED_TEXT && e.at >= (c.resolvedAt ?? ''));
    const canReopen = this.complaints.canReopen(c);
    const role = staffById(c.assignedTo)?.role;
    return {
      id: c.id,
      category,
      title: c.title,
      description: c.description,
      location: c.location || 'Not specified',
      status: c.status,
      priority: c.priority,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      assignedTeam: role ? `${role} team` : 'Not assigned yet',
      updates: this.visibleUpdates(c),
      resolutionNote: c.status === 'Resolved' || c.status === 'Closed' ? c.resolutionNote : undefined,
      resolvedAt: c.resolvedAt,
      attachments: c.attachments.map(fromStored),
      reopenCount: c.reopenCount,
      canComment: c.status !== 'Closed',
      canConfirm: c.status === 'Resolved' && !confirmed,
      confirmed,
      canReopen,
      reopenBlockedReason: c.status === 'Resolved' && !canReopen ? `The ${REOPEN_WINDOW_DAYS}-day reopen window has passed. Please raise a new complaint if the problem is back.` : undefined,
      reopenUntil: c.status === 'Resolved' && c.resolvedAt ? localIso(new Date(new Date(c.resolvedAt).getTime() + REOPEN_WINDOW_DAYS * 86_400_000)) : undefined,
    };
  }

  /** What the Tenant may see of the history: no internal notes, priority/target edits or system notices, and no staff names. */
  private visibleUpdates(c: Complaint): TenantComplaintUpdate[] {
    const out: TenantComplaintUpdate[] = [];
    for (const e of c.history) {
      const by: TenantComplaintUpdate['by'] = e.by === TENANT_AUTHOR ? 'You' : 'Hostel team';
      switch (e.type) {
        case 'created':
          out.push({ at: e.at, by, kind: 'submitted', text: 'Complaint submitted.' });
          break;
        case 'assigned': {
          if (/^unassigned/i.test(e.text)) break;
          const role = /\(([^)]+)\)/.exec(e.text)?.[1];
          out.push({ at: e.at, by, kind: 'assigned', text: role ? `Assigned to the ${role} team.` : 'Assigned to the maintenance team.' });
          break;
        }
        case 'status':
          if (/^target resolution/i.test(e.text)) break;
          out.push({ at: e.at, by, kind: 'status', text: e.text });
          break;
        case 'note':
          if (INTERNAL_NOTE.test(e.text)) break;
          out.push({ at: e.at, by, kind: 'note', text: e.text });
          break;
        case 'resolved':
          out.push({ at: e.at, by, kind: 'resolved', text: e.text });
          break;
        default:
          break; // 'priority', 'notified': internal bookkeeping
      }
    }
    return out;
  }

  private notify(residentId: string, body: string): void {
    try {
      this.notifications.push(residentId, { category: 'Complaint', title: 'Complaint update', body, route: '/my/complaints' });
    } catch {
      // storage or text rules; the complaint itself is already saved
    }
  }

  private setMeta(id: string, category: TenantComplaintCategory): void {
    if (category !== 'Room') return;
    const next = { ...this.meta.value, [id]: category };
    this.meta.next(next);
    try {
      localStorage.setItem(META_KEY, JSON.stringify(next));
    } catch {
      /* kept in memory */
    }
  }

  private loadMeta(): Record<string, TenantComplaintCategory> {
    try {
      const raw = localStorage.getItem(META_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, TenantComplaintCategory>) : null;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* fall through */
    }
    return {};
  }

  /** Once per browser: gives the built-in Tenant (RES000001) a few realistic complaints. */
  private seedDemo(): void {
    try {
      if (localStorage.getItem(SEED_FLAG)) return;
    } catch {
      /* no storage: seed in memory every load; seedIfMissing is idempotent */
    }
    const r = this.residents.byId('RES000001');
    if (!r) return;
    const ev = (hours: number, type: ComplaintEvent['type'], by: string, text: string): ComplaintEvent => ({ at: hoursAgo(hours), type, by, text });
    const base = { residentId: r.residentId, residentName: residentFullName(r), location: 'Room 101 · Bed B1', attachments: [], source: 'Resident App' as const, reopenCount: 0, id: '' };
    const OWNER = 'Hostel Owner';
    const rows: Complaint[] = [
      {
        ...base,
        category: 'Plumbing', title: 'Washbasin tap dripping', description: 'The tap in the attached washroom keeps dripping even when fully closed.',
        priority: 'Medium', assignedTo: 'STF01', createdAt: hoursAgo(52), status: 'In Progress', updatedAt: hoursAgo(5),
        history: [
          ev(5, 'note', 'Ravi Kumar', 'Part ordered; we will fit it tomorrow morning.'),
          ev(6, 'note', OWNER, '[Internal] Vendor quoted extra for the cartridge; approve if over budget.'),
          ev(30, 'status', OWNER, 'Status changed Open → In Progress.'),
          ev(31, 'priority', OWNER, 'Priority changed Low → Medium.'),
          ev(32, 'assigned', OWNER, 'Assigned to Ravi Kumar (Plumber).'),
          ev(52, 'created', TENANT_AUTHOR, 'Submitted from the Resident App.'),
        ],
      },
      {
        ...base,
        category: 'Cleaning', title: 'Room not swept for two days', description: 'Housekeeping has skipped our room for the last two days; the floor needs sweeping and mopping.',
        priority: 'Low', assignedTo: 'STF03', createdAt: hoursAgo(80), status: 'Resolved', resolvedAt: hoursAgo(20), updatedAt: hoursAgo(20),
        resolutionNote: 'Room cleaned and the housekeeping roster updated. Please tell us if it is missed again.',
        history: [
          ev(20, 'notified', OWNER, 'Resident notified in the Resident App and by SMS.'),
          ev(20, 'resolved', OWNER, 'Room cleaned and the housekeeping roster updated. Please tell us if it is missed again.'),
          ev(70, 'assigned', OWNER, 'Assigned to Lakshmi Devi (Housekeeping).'),
          ev(80, 'created', TENANT_AUTHOR, 'Submitted from the Resident App.'),
        ],
      },
      {
        ...base,
        category: 'Wi-Fi', title: 'Wi-Fi slow in the evenings', description: 'Speeds drop below 1 Mbps between 8 and 11 PM in our wing.',
        priority: 'Low', assignedTo: 'STF04', createdAt: hoursAgo(24 * 14), status: 'Closed', resolvedAt: hoursAgo(24 * 11), closedAt: hoursAgo(24 * 3), updatedAt: hoursAgo(24 * 3),
        resolutionNote: 'Access point replaced on your floor.',
        history: [
          ev(24 * 3, 'status', OWNER, 'Status changed Resolved → Closed.'),
          ev(24 * 11, 'resolved', OWNER, 'Access point replaced on your floor.'),
          ev(24 * 13, 'assigned', OWNER, 'Assigned to Arjun Rao (IT / Wi-Fi).'),
          ev(24 * 14, 'created', TENANT_AUTHOR, 'Submitted from the Resident App.'),
        ],
      },
    ];
    this.complaints.seedIfMissing(rows);
    try {
      localStorage.setItem(SEED_FLAG, '1');
    } catch {
      /* ignore */
    }
  }
}
