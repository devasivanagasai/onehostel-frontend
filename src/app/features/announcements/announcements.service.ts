import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { RoomsService } from '../rooms-management/rooms.service';
import { Room } from '../rooms-management/rooms.models';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident } from '../residents/residents.models';
import {
  Announcement,
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementInput,
  AnnouncementStatus,
  ChannelDelivery,
  MESSAGE_MAX,
  TITLE_MAX,
  effectiveStatus,
  expiryTime,
  localIso,
  wasSent,
} from './announcements.models';

// Audit: AUDIT_EVENTS (core/models/audit.models.ts) has no announcement events yet, so nothing is recorded there.
// Created / updated / cancelled by + at are kept on each announcement instead.

const STORAGE_KEY = 'onehostel_announcements_v1';
export const HOSTEL_ID = 'HST-OWNER-01';
export const HOSTEL_NAME = 'Grand Stay Hostel';

export interface AnnouncementStats {
  published: number;
  scheduled: number;
  drafts: number;
  /** In-app read rate across live/expired announcements of the last 30 days; null when none. */
  readRate: number | null;
  closed: number;
}

/** Local date-time `days` from today at hh:mm. */
const at = (days: number, time: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${localIso(d).slice(0, 10)}T${time}:00`;
};
const day = (days: number): string => at(days, '00:00').slice(0, 10);

const audience = (patch: Partial<AnnouncementAudience> = {}): AnnouncementAudience => ({
  type: 'All', roomIds: [], roomTypes: [], residentIds: [], ...patch,
});

/** Seed data, relative to today so there is always something upcoming. */
function seed(): Announcement[] {
  const by = 'Hostel Owner';
  const base = (id: string, created: string): Pick<Announcement, 'id' | 'hostelId' | 'createdBy' | 'createdAt' | 'updatedAt'> => ({
    id, hostelId: HOSTEL_ID, createdBy: by, createdAt: created, updatedAt: created,
  });
  return [
    {
      ...base('ANN000011', at(-1, '09:40')),
      title: 'Fire safety drill on Saturday',
      message: 'A fire safety drill will be held on Saturday at 11:00 AM. Please assemble at the front lawn when the alarm sounds.',
      audience: audience(), channels: ['In-app', 'Push'], publishAt: at(2, '08:00'), status: 'Cancelled',
      cancelledBy: by, cancelledAt: at(0, '08:15'), updatedAt: at(0, '08:15'),
    },
    {
      ...base('ANN000010', at(-1, '18:20')),
      title: 'Gym timings update',
      message: 'The gym on the ground floor will now open from 5:30 AM to 10:00 PM.',
      audience: audience(), channels: ['In-app'], status: 'Draft',
    },
    {
      ...base('ANN000009', at(-2, '16:05')),
      title: 'New mess menu from 1st November',
      message: 'We have revised the weekly mess menu based on your feedback. South Indian breakfast is now served on Tuesdays and Fridays. The full menu is attached.',
      audience: audience(), channels: ['In-app', 'Push', 'Email'], status: 'Draft',
      attachment: { name: 'mess_menu_november.pdf', size: 248_000, type: 'application/pdf' },
    },
    {
      ...base('ANN000008', at(-1, '12:30')),
      title: 'Monthly rent due reminder',
      message: 'Rent for next month is due by the 5th. Pay through the Resident App or at the front desk to avoid a late fee.',
      audience: audience(), channels: ['In-app', 'Push', 'Email'], publishAt: at(9, '09:00'), expiryDate: day(14), status: 'Scheduled',
    },
    {
      ...base('ANN000007', at(-2, '11:10')),
      title: 'Diwali celebration in the common hall',
      message: 'Join us for Diwali celebrations in the common hall from 7:00 PM — rangoli, sweets and a small cultural programme. Family visitors are welcome until 9:30 PM.',
      audience: audience(), channels: ['In-app', 'Push', 'Email'], publishAt: at(3, '10:00'), expiryDate: day(10), status: 'Scheduled',
      attachment: { name: 'diwali_poster.jpg', size: 1_420_000, type: 'image/jpeg' },
    },
    {
      ...base('ANN000006', at(-1, '07:30')),
      title: 'Water supply interruption',
      message: 'Water supply will be interrupted tomorrow from 10:00 AM to 2:00 PM for tank cleaning. Please store water in advance.',
      audience: audience(), channels: ['In-app', 'Push', 'SMS'], publishAt: at(-1, '08:00'), expiryDate: day(1), status: 'Published',
    },
    {
      ...base('ANN000005', at(-2, '17:45')),
      title: 'Wi-Fi upgrade on the 2nd floor',
      message: 'New Wi-Fi access points are being installed on the 2nd floor. Expect short drops between 2:00 PM and 4:00 PM today.',
      audience: audience({ type: 'Rooms', roomIds: ['RM-201', 'RM-202', 'RM-203'] }), channels: ['In-app', 'Push'],
      publishAt: at(-2, '18:00'), status: 'Published',
    },
    {
      ...base('ANN000004', at(-5, '10:00')),
      title: 'Pending document verification',
      message: 'Your ID document is still pending verification. Please submit a clear copy at the front desk this week.',
      audience: audience({ type: 'Residents', residentIds: ['RES000002', 'RES000004', 'RES000006'] }), channels: ['In-app', 'Email'],
      publishAt: at(-5, '10:05'), status: 'Published',
    },
    {
      ...base('ANN000003', at(-9, '15:00')),
      title: 'AC servicing in double rooms',
      message: 'AC units in all double rooms will be serviced this week. A technician will visit between 10:00 AM and 5:00 PM.',
      audience: audience({ type: 'RoomTypes', roomTypes: ['Double'] }), channels: ['In-app', 'Push'],
      publishAt: at(-8, '09:00'), expiryDate: day(-2), status: 'Scheduled',
    },
    {
      ...base('ANN000002', at(-7, '19:30')),
      title: 'Pest control in Room 201',
      message: 'Pest control is scheduled for Room 201 tomorrow at 11:00 AM. Please keep food items sealed and stay out for two hours.',
      audience: audience({ type: 'Rooms', roomIds: ['RM-201'] }), channels: ['In-app', 'Push', 'SMS'],
      publishAt: at(-7, '19:45'), expiryDate: day(-5), status: 'Published',
    },
    {
      ...base('ANN000001', at(-16, '10:00')),
      title: 'Updated hostel rules',
      message: 'The hostel rules have been updated: gate closes at 10:30 PM, guests must sign in at reception, and quiet hours are 11:00 PM to 6:00 AM. Please read the attached document.',
      audience: audience(), channels: ['In-app', 'Push', 'Email'], publishAt: at(-15, '09:00'), status: 'Published',
      attachment: { name: 'hostel_rules_2026.pdf', size: 612_000, type: 'application/pdf' },
    },
  ];
}

/** Stable 0..1 value per key, so mock delivery figures don't change between renders. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly rooms = inject(RoomsService);
  private readonly residents = inject(ResidentsService);
  private readonly settings = inject(SystemSettingsService);
  private readonly auth = inject(AuthService);

  private readonly subject = new BehaviorSubject<Announcement[]>(this.load());
  readonly announcements$: Observable<Announcement[]> = this.subject.asObservable();

  readonly stats$: Observable<AnnouncementStats> = combineLatest([this.announcements$, this.residents.residents$]).pipe(
    map(([list]) => {
      const counts = (s: AnnouncementStatus) => list.filter((a) => effectiveStatus(a) === s).length;
      const monthAgo = Date.now() - 30 * 86_400_000;
      let targeted = 0;
      let read = 0;
      for (const a of list) {
        if (!wasSent(effectiveStatus(a)) || new Date(a.publishAt!).getTime() < monthAgo) continue;
        const inApp = this.delivery(a).find((d) => d.channel === 'In-app');
        targeted += inApp?.delivered ?? 0;
        read += inApp?.read ?? 0;
      }
      return {
        published: counts('Published'),
        scheduled: counts('Scheduled'),
        drafts: counts('Draft'),
        readRate: targeted ? Math.round((read / targeted) * 100) : null,
        closed: counts('Expired') + counts('Cancelled'),
      };
    }),
  );

  get announcements(): Announcement[] {
    return this.subject.value;
  }

  byId(id: string): Announcement | undefined {
    return this.announcements.find((a) => a.id === id);
  }

  status(a: Announcement): AnnouncementStatus {
    return effectiveStatus(a);
  }

  // ---- Channels & audience ---------------------------------------------------

  /** Email / SMS can be picked only when a provider is set up in Settings → Communication. In-app and push are always on. */
  channelAvailable(channel: AnnouncementChannel): boolean {
    const c = this.settings.settings.communication;
    if (channel === 'Email') return !!c.emailProvider && (c.emailProvider === 'SMTP' ? !!c.smtpHost : !!c.emailApiKey);
    if (channel === 'SMS') return !!c.smsProvider && !!c.smsApiKey;
    return true;
  }

  get hostelRooms(): Room[] {
    return this.rooms.rooms.filter((r) => r.hostelId === HOSTEL_ID);
  }

  /** Residents who can receive announcements: current (Active / On Leave), not deactivated. */
  get reachableResidents(): HostelResident[] {
    return this.residents.residents.filter((r) => !r.deactivatedAt && (r.status === 'Active' || r.status === 'On Leave'));
  }

  location(residentId: string): string {
    const alloc = this.residents.allocationFor(residentId);
    return alloc ? this.residents.describe(alloc) : 'No bed';
  }

  recipients(aud: AnnouncementAudience): HostelResident[] {
    const all = this.reachableResidents;
    switch (aud.type) {
      case 'All':
        return all;
      case 'Residents':
        return all.filter((r) => aud.residentIds.includes(r.residentId));
      case 'Rooms':
      case 'RoomTypes': {
        const rooms = this.hostelRooms.filter((room) => (aud.type === 'Rooms' ? aud.roomIds.includes(room.id) : aud.roomTypes.includes(room.roomType)));
        const ids = new Set(rooms.flatMap((room) => room.beds.filter((b) => b.status === 'Occupied' && b.residentId).map((b) => b.residentId!)));
        return all.filter((r) => ids.has(r.residentId));
      }
    }
  }

  audienceLabel(aud: AnnouncementAudience): string {
    switch (aud.type) {
      case 'All':
        return 'All residents';
      case 'Residents':
        return `${aud.residentIds.length} selected resident${aud.residentIds.length === 1 ? '' : 's'}`;
      case 'RoomTypes':
        return aud.roomTypes.length ? `${aud.roomTypes.join(', ')} rooms` : 'No room type selected';
      case 'Rooms': {
        const names = this.hostelRooms.filter((r) => aud.roomIds.includes(r.id)).map((r) => r.roomNumber);
        if (!names.length) return 'No room selected';
        return names.length <= 3 ? `Room${names.length === 1 ? '' : 's'} ${names.join(', ')}` : `${names.length} rooms`;
      }
    }
  }

  // ---- Delivery (mock) ---------------------------------------------------------

  /**
   * Per-channel delivery / read figures. Mocked deterministically from the announcement ID; reads
   * build up over the first two days. Push reaches only devices with notifications allowed,
   * email only residents with an email address, and SMS can't report reads.
   */
  delivery(a: Announcement): ChannelDelivery[] {
    if (!wasSent(effectiveStatus(a))) return [];
    const people = this.recipients(a.audience);
    const n = people.length;
    const ramp = Math.min(1, (Date.now() - new Date(a.publishAt!).getTime()) / (48 * 3_600_000));
    return a.channels.map((channel) => {
      const r = rand(a.id + channel);
      const reads = (delivered: number, low: number, high: number) => Math.round(delivered * (low + r * (high - low)) * ramp);
      switch (channel) {
        case 'In-app':
          return { channel, targeted: n, delivered: n, read: this.inAppReaders(a, people).length };
        case 'Push': {
          const blocked = Math.round(n * (0.08 + r * 0.17));
          const delivered = n - blocked;
          return { channel, targeted: n, delivered, read: reads(delivered, 0.45, 0.7), note: blocked ? `${blocked} without notification permission` : undefined };
        }
        case 'Email': {
          const targeted = people.filter((p) => !!p.email).length;
          const delivered = targeted - (targeted > 3 && r < 0.4 ? 1 : 0);
          return { channel, targeted, delivered, read: reads(delivered, 0.35, 0.65), note: targeted < n ? `${n - targeted} without an email address` : undefined };
        }
        case 'SMS': {
          const delivered = n - (n > 4 && r < 0.5 ? 1 : 0);
          return { channel, targeted: n, delivered, read: null, note: 'Read receipts are not available for SMS' };
        }
      }
    });
  }

  /** Residents who have opened it in the app (mock). */
  inAppReaders(a: Announcement, people = this.recipients(a.audience)): HostelResident[] {
    if (!wasSent(effectiveStatus(a))) return [];
    const ramp = Math.min(1, (Date.now() - new Date(a.publishAt!).getTime()) / (48 * 3_600_000));
    return people.filter((p) => rand(a.id + p.residentId) < 0.85 * ramp);
  }

  // ---- Actions ----------------------------------------------------------------

  /** Drafts need only a title; nothing is sent. */
  saveDraft(input: AnnouncementInput, id?: string): Announcement {
    if (!input.title.trim()) throw new Error('Title is required.');
    return this.upsert(input, 'Draft', id);
  }

  /** Publish now (no publishAt) or schedule (future publishAt). */
  publish(input: AnnouncementInput, id?: string): Announcement {
    this.validate(input);
    const scheduled = !!input.publishAt && new Date(input.publishAt).getTime() > Date.now();
    return this.upsert({ ...input, publishAt: scheduled ? input.publishAt : localIso() }, scheduled ? 'Scheduled' : 'Published', id);
  }

  cancel(id: string): Announcement {
    const a = this.require(id);
    if (effectiveStatus(a) !== 'Scheduled') throw new Error('Only scheduled announcements can be cancelled.');
    const now = localIso();
    const next: Announcement = { ...a, status: 'Cancelled', cancelledBy: this.userName, cancelledAt: now, updatedBy: this.userName, updatedAt: now };
    this.commit(this.announcements.map((x) => (x.id === id ? next : x)));
    return next;
  }

  delete(id: string): void {
    const a = this.require(id);
    if (a.status !== 'Draft') throw new Error('Only drafts can be deleted.');
    this.commit(this.announcements.filter((x) => x.id !== id));
  }

  /** Copy as a new draft; the publish time is cleared so it gets picked again. */
  duplicate(id: string): Announcement {
    const a = this.require(id);
    return this.upsert(
      { title: `Copy of ${a.title}`.slice(0, TITLE_MAX), message: a.message, audience: structuredClone(a.audience), channels: a.channels.filter((c) => this.channelAvailable(c)), attachment: a.attachment },
      'Draft',
    );
  }

  // ---------------------------------------------------------------------------

  private validate(input: AnnouncementInput): void {
    if (!input.title.trim() || input.title.length > TITLE_MAX) throw new Error(`Title is required (max ${TITLE_MAX} characters).`);
    if (!input.message.trim() || input.message.length > MESSAGE_MAX) throw new Error(`Message is required (max ${MESSAGE_MAX} characters).`);
    if (!input.channels.length) throw new Error('Pick at least one channel.');
    if (!this.recipients(input.audience).length) throw new Error('The selected audience has no residents to receive it.');
    const publishAt = input.publishAt ? new Date(input.publishAt).getTime() : Date.now();
    if (input.expiryDate && expiryTime(input.expiryDate) <= publishAt) throw new Error('Expiry date must follow the publish date.');
  }

  private upsert(input: AnnouncementInput, status: Announcement['status'], id?: string): Announcement {
    const now = localIso();
    const clean: AnnouncementInput = {
      ...input,
      title: input.title.trim(),
      message: input.message.trim(),
      publishAt: input.publishAt || undefined,
      expiryDate: input.expiryDate || undefined,
    };
    if (id) {
      const existing = this.require(id);
      if (existing.status !== 'Draft') throw new Error('Only drafts can be edited.');
      const next: Announcement = { ...existing, ...clean, status, updatedBy: this.userName, updatedAt: now };
      this.commit(this.announcements.map((x) => (x.id === id ? next : x)));
      return next;
    }
    const created: Announcement = { id: this.nextId(), hostelId: HOSTEL_ID, ...clean, status, createdBy: this.userName, createdAt: now, updatedAt: now };
    this.commit([created, ...this.announcements]);
    return created;
  }

  private require(id: string): Announcement {
    const a = this.byId(id);
    if (!a) throw new Error('Announcement not found.');
    return a;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.announcements.reduce((m, a) => Math.max(m, Number(a.id.slice(3)) || 0), 0);
    return `ANN${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Announcement[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): Announcement[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Announcement[];
    } catch {
      // Fall through to the seed data.
    }
    const list = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
    return list;
  }
}
