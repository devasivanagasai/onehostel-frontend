import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import {
  CLAIM_MAX,
  CLAIM_MIN,
  CommunityItem,
  CommunityItemView,
  ITEM_STATUSES,
  ITEM_TRANSITIONS,
  ItemClaim,
  ItemKind,
  ItemStatus,
  PHOTO_MAX_BYTES,
  PHOTO_MIME_TYPES,
  ReportInput,
} from '../models/tenant-community.models';
import { localDateIso } from '../../shared/utils/local-date';

const ITEMS_KEY = 'onehostel_tenant_lost_found_v1';
const CLAIMS_KEY = 'onehostel_tenant_lost_found_claims_v1';

const pad = (n: number): string => String(n).padStart(2, '0');
const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const nowMinute = (): string => nowIso().slice(0, 16);
const daysAgo = (n: number, hhmm = '10:00'): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${localDateIso(d)}T${hhmm}`;
};

/** Phone numbers and e-mail addresses are not allowed in a public report; the office passes messages on. */
const CONTACT_PATTERN = /(\+?\d[\d\s-]{8,}\d)|([^\s@]+@[^\s@]+\.[^\s@]+)/;

function seedItems(): CommunityItem[] {
  const mk = (id: string, kind: ItemKind, residentId: string, itemName: string, description: string, location: string, occurredAt: string, status: ItemStatus, extra: Partial<CommunityItem> = {}): CommunityItem => ({
    id, kind, residentId, itemName, description, location, occurredAt, status, createdAt: occurredAt, history: [{ at: occurredAt, action: 'Reported' }], ...extra,
  });
  return [
    mk('LF000001', 'Lost', 'RES000001', 'Black water bottle', 'Steel bottle with a small sticker of a mountain on the side.', 'Study hall, ground floor', daysAgo(3, '17:30'), 'Under Review', {
      moderationNote: 'We are checking the study hall and the front desk. Will update you.', history: [{ at: daysAgo(3, '17:40'), action: 'Reported' }, { at: daysAgo(2, '09:00'), action: 'Under Review', note: 'We are checking the study hall and the front desk. Will update you.' }],
    }),
    mk('LF000002', 'Found', 'RES000002', 'Blue umbrella', 'Large blue umbrella with a wooden handle, left near the entrance.', 'Main entrance', daysAgo(2, '19:00'), 'Reported', { handoverLocation: 'Front desk' }),
    mk('LF000003', 'Found', 'RES000003', 'Set of keys', 'Three keys on a red ring with a small padlock charm.', 'Corridor near laundry room', daysAgo(5, '08:15'), 'Under Review', { handoverLocation: 'Front desk' }),
    mk('LF000004', 'Lost', 'RES000004', 'Earphones', 'White wireless earphones in a small round case.', 'Common room', daysAgo(1, '21:00'), 'Reported'),
    mk('LF000005', 'Found', 'RES000001', 'Scientific calculator', 'Casio calculator with the initials engraved on the back.', 'Mess hall', daysAgo(12, '13:00'), 'Returned', { handoverLocation: 'Front desk', moderationNote: 'Returned to the owner.', history: [{ at: daysAgo(12, '13:10'), action: 'Reported' }, { at: daysAgo(10, '11:00'), action: 'Returned', note: 'Returned to the owner.' }] }),
  ];
}

function read<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) return parsed as T;
  } catch {
    /* use fallback */
  }
  return fallback();
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kept in memory */
  }
}

/**
 * Lost & Found (FRD 7.6). Other Tenants' reports are shown only as "Reported by a tenant": no name, no contact,
 * no resident id. The hostel office moderates; the reporter is notified on every status change.
 */
@Injectable({ providedIn: 'root' })
export class TenantCommunityService {
  private readonly tenant = inject(TenantContextService);
  private readonly staffAuth = inject(AuthService);
  private readonly notices = inject(TenantNotificationService);
  private readonly items = new BehaviorSubject<CommunityItem[]>(read(ITEMS_KEY, seedItems));
  private readonly claims = new BehaviorSubject<ItemClaim[]>(read(CLAIMS_KEY, () => []));

  readonly limits = { claimMin: CLAIM_MIN, claimMax: CLAIM_MAX, photoMaxMb: PHOTO_MAX_BYTES / 1024 / 1024 };

  /** Items visible to this Tenant: all their own, plus others' items that are still open. */
  readonly items$: Observable<CommunityItemView[]> = combineLatest([this.items, this.claims]).pipe(map(() => this.visible));

  get visible(): CommunityItemView[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    return this.items.value
      .filter((i) => i.residentId === me || i.status === 'Reported' || i.status === 'Under Review' || i.status === 'Matched')
      .map((i) => this.toView(i, me))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  /** Per-field problems for a report (empty object = valid). */
  validate(input: ReportInput): Record<string, string> {
    const e: Record<string, string> = {};
    if (input.kind !== 'Lost' && input.kind !== 'Found') e['kind'] = 'Choose Lost or Found.';
    const name = (input.itemName ?? '').trim();
    if (input.kind === 'Lost' && (name.length < 2 || name.length > 60)) e['itemName'] = 'Enter the item name (2-60 characters).';
    if (input.kind === 'Found' && name.length > 60) e['itemName'] = 'Keep the item name within 60 characters.';
    const desc = (input.description ?? '').trim();
    if (desc.length < 10) e['description'] = 'Describe the item in at least 10 characters.';
    else if (desc.length > 500) e['description'] = 'Keep the description within 500 characters.';
    else if (CONTACT_PATTERN.test(desc)) e['description'] = 'Do not include phone numbers or e-mail addresses. The hostel office will pass messages on.';
    const loc = (input.location ?? '').trim();
    if (loc.length < 2 || loc.length > 100) e['location'] = input.kind === 'Found' ? 'Say where you found it.' : 'Say where you lost it.';
    if (input.kind === 'Found') {
      const h = (input.handoverLocation ?? '').trim();
      if (h.length < 2 || h.length > 100) e['handoverLocation'] = 'Say where the item has been handed over.';
    }
    if (!input.occurredAt) e['occurredAt'] = input.kind === 'Found' ? 'Enter when you found it.' : 'Enter roughly when you lost it.';
    else if (Number.isNaN(new Date(input.occurredAt).getTime())) e['occurredAt'] = 'Enter a valid date and time.';
    else if (input.occurredAt > nowMinute()) e['occurredAt'] = 'The date and time cannot be in the future.';
    if (input.photo) {
      if (!PHOTO_MIME_TYPES.includes(input.photo.mime)) e['photo'] = 'Photo must be a JPG or PNG.';
      else if (input.photo.size > PHOTO_MAX_BYTES) e['photo'] = 'Photo must be 3 MB or smaller.';
      else if (input.photo.size <= 0) e['photo'] = 'The photo file is empty.';
    }
    return e;
  }

  report(input: ReportInput): CommunityItemView {
    const me = this.tenant.requireResidentId();
    const first = Object.values(this.validate(input))[0];
    if (first) throw new Error(first);
    const now = nowIso();
    const item: CommunityItem = {
      id: `LF${String(this.items.value.reduce((m, i) => Math.max(m, Number(i.id.slice(2)) || 0), 0) + 1).padStart(6, '0')}`,
      kind: input.kind,
      residentId: me,
      itemName: input.itemName.trim() || (input.kind === 'Found' ? 'Found item' : ''),
      description: input.description.trim(),
      location: input.location.trim(),
      handoverLocation: input.kind === 'Found' ? input.handoverLocation?.trim() : undefined,
      occurredAt: input.occurredAt,
      photoName: input.photo?.name,
      status: 'Reported',
      createdAt: now,
      history: [{ at: now, action: 'Reported' }],
    };
    this.saveItems([item, ...this.items.value]);
    this.notices.push(me, { category: 'Support', title: `${item.kind} item reported`, body: `Your report ${item.id} was received. The hostel office will review it.`, route: '/my/community' });
    return this.toView(item, me);
  }

  /** Edit MY report, only while it is still Reported (before review starts). */
  update(id: string, input: ReportInput): CommunityItemView {
    const me = this.tenant.requireResidentId();
    const item = this.requireOwn(id, me);
    if (item.status !== 'Reported') throw new Error('This report is already being reviewed and can no longer be edited.');
    if (input.kind !== item.kind) throw new Error('A Lost report cannot be turned into a Found report. Withdraw it and report again.');
    const first = Object.values(this.validate(input))[0];
    if (first) throw new Error(first);
    const next: CommunityItem = {
      ...item,
      itemName: input.itemName.trim() || item.itemName,
      description: input.description.trim(),
      location: input.location.trim(),
      handoverLocation: item.kind === 'Found' ? input.handoverLocation?.trim() : undefined,
      occurredAt: input.occurredAt,
      photoName: input.photo === undefined ? item.photoName : input.photo?.name,
      history: [...item.history, { at: nowIso(), action: 'Edited by reporter' }],
    };
    this.saveItems(this.items.value.map((i) => (i.id === id ? next : i)));
    return this.toView(next, me);
  }

  /** Withdraw MY report while it is still Reported. It becomes Closed. */
  withdraw(id: string): CommunityItemView {
    const me = this.tenant.requireResidentId();
    const item = this.requireOwn(id, me);
    if (item.status !== 'Reported') throw new Error('Only a report that has not started review can be withdrawn.');
    const next: CommunityItem = { ...item, status: 'Closed', moderationNote: 'Withdrawn by the reporter.', history: [...item.history, { at: nowIso(), action: 'Closed', note: 'Withdrawn by the reporter' }] };
    this.saveItems(this.items.value.map((i) => (i.id === id ? next : i)));
    return this.toView(next, me);
  }

  /** Claim a Found item that is not mine. One claim per Tenant per item. */
  claim(itemId: string, explanation: string): ItemClaim {
    const me = this.tenant.requireResidentId();
    const item = this.items.value.find((i) => i.id === itemId);
    if (!item || !(item.residentId === me || ['Reported', 'Under Review', 'Matched'].includes(item.status))) throw new Error('Item not found.');
    if (item.kind !== 'Found') throw new Error('Only a Found item can be claimed.');
    if (item.residentId === me) throw new Error('You reported this item, so you cannot claim it.');
    if (!['Reported', 'Under Review', 'Matched'].includes(item.status)) throw new Error('This item is no longer available to claim.');
    const why = (explanation ?? '').trim();
    if (why.length < CLAIM_MIN) throw new Error(`Explain why this item is yours in at least ${CLAIM_MIN} characters.`);
    if (why.length > CLAIM_MAX) throw new Error(`Keep your explanation within ${CLAIM_MAX} characters.`);
    if (CONTACT_PATTERN.test(why)) throw new Error('Do not include phone numbers or e-mail addresses in a claim.');
    if (this.claims.value.some((c) => c.itemId === itemId && c.residentId === me)) throw new Error('You have already claimed this item.');
    const claim: ItemClaim = {
      id: `CLM${String(this.claims.value.reduce((m, c) => Math.max(m, Number(c.id.slice(3)) || 0), 0) + 1).padStart(5, '0')}`,
      itemId,
      residentId: me,
      explanation: why,
      status: 'Pending',
      createdAt: nowIso(),
    };
    this.saveClaims([...this.claims.value, claim]);
    this.notices.push(me, { category: 'Support', title: 'Claim sent', body: `Your claim on item ${itemId} was sent to the hostel office.`, route: '/my/community' });
    return { ...claim };
  }

  // ---- Owner side ---------------------------------------------------------------------

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.staffAuth.isHostelOwner || this.staffAuth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  moderate(id: string, status: ItemStatus, note?: string): CommunityItem {
    this.requireStaff();
    const item = this.items.value.find((i) => i.id === id);
    if (!item) throw new Error('Item not found.');
    if (!ITEM_STATUSES.includes(status)) throw new Error('Unknown status.');
    if (!ITEM_TRANSITIONS[item.status].includes(status)) throw new Error(`An item that is ${item.status} cannot move to ${status}.`);
    const text = note?.trim() ?? '';
    if ((status === 'Closed' || status === 'Returned') && !text) throw new Error('A note is required to close or return an item.');
    const next: CommunityItem = { ...item, status, moderationNote: text || item.moderationNote, history: [...item.history, { at: nowIso(), action: status, note: text || undefined }] };
    this.saveItems(this.items.value.map((i) => (i.id === id ? next : i)));
    this.notices.push(item.residentId, { category: 'Support', title: `Lost & Found: ${status}`, body: `Your report ${item.id} is now "${status}".`, route: '/my/community' });
    return next;
  }

  decideClaim(claimId: string, decision: 'Approved' | 'Rejected', note?: string): ItemClaim {
    this.requireStaff();
    const c = this.claims.value.find((x) => x.id === claimId);
    if (!c) throw new Error('Claim not found.');
    if (c.status !== 'Pending') throw new Error('This claim has already been decided.');
    if (decision !== 'Approved' && decision !== 'Rejected') throw new Error('Choose Approved or Rejected.');
    if (decision === 'Rejected' && !(note ?? '').trim()) throw new Error('A note is required when rejecting a claim.');
    const next: ItemClaim = { ...c, status: decision, decisionNote: note?.trim() || undefined, decidedAt: nowIso() };
    this.saveClaims(this.claims.value.map((x) => (x.id === c.id ? next : x)));
    this.notices.push(c.residentId, { category: 'Support', title: `Claim ${decision.toLowerCase()}`, body: decision === 'Approved' ? `Your claim on item ${c.itemId} was approved. Collect it from the hostel office.` : `Your claim on item ${c.itemId} was not approved.`, route: '/my/community' });
    const item = this.items.value.find((i) => i.id === c.itemId);
    if (decision === 'Approved' && item && ITEM_TRANSITIONS[item.status].includes('Matched')) this.moderate(item.id, 'Matched', 'A claim was approved.');
    return { ...next };
  }

  // ---- internals ----------------------------------------------------------------------

  private toView(i: CommunityItem, me: string): CommunityItemView {
    const mine = i.residentId === me;
    const myClaim = this.claims.value.find((c) => c.itemId === i.id && c.residentId === me);
    const open = i.status === 'Reported' || i.status === 'Under Review' || i.status === 'Matched';
    return {
      id: i.id,
      kind: i.kind,
      mine,
      itemName: i.itemName,
      description: i.description,
      location: i.location,
      handoverLocation: i.handoverLocation,
      occurredAt: i.occurredAt,
      photoName: i.photoName,
      status: i.status,
      reportedBy: mine ? 'You' : 'Reported by a tenant',
      // The moderation note is a message to the reporter; other Tenants never see it.
      moderationNote: mine ? i.moderationNote : undefined,
      canEdit: mine && i.status === 'Reported',
      canWithdraw: mine && i.status === 'Reported',
      canClaim: !mine && i.kind === 'Found' && open && !myClaim,
      myClaim: myClaim ? { ...myClaim } : undefined,
      createdAt: i.createdAt,
    };
  }

  private requireOwn(id: string, me: string): CommunityItem {
    const item = this.items.value.find((i) => i.id === id);
    if (!item || item.residentId !== me) throw new Error('Item not found.');
    return item;
  }

  private saveItems(list: CommunityItem[]): void {
    this.items.next(list);
    write(ITEMS_KEY, list);
  }

  private saveClaims(list: ItemClaim[]): void {
    this.claims.next(list);
    write(CLAIMS_KEY, list);
  }
}
