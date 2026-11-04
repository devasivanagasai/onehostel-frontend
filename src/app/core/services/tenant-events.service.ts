import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { localDateIso } from '../../shared/utils/local-date';
import { EventInput, EventRsvp, EventStatus, HostelEvent, RSVP_CHOICES, RsvpChoice } from '../models/tenant-events.models';

const EVENTS_KEY = 'onehostel_events_v1';
const RSVPS_KEY = 'onehostel_event_rsvps_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

interface EventsState {
  events: HostelEvent[];
  rsvps: EventRsvp[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** Local wall-clock date-time (yyyy-mm-ddTHH:mm:ss), never UTC. */
const localNow = (d: Date = new Date()): string => `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const stamp = (iso: string): number => new Date(iso.length === 16 ? `${iso}:00` : iso).getTime();

/** What a Tenant sees for one event. */
export interface TenantEventView extends HostelEvent {
  status: EventStatus;
  ongoing: boolean;
  /** Effective deadline (the start time when none was set). */
  deadline: string;
  goingCount: number;
  spotsLeft?: number;
  full: boolean;
  myRsvp?: EventRsvp;
  /** Why the Tenant can't RSVP, or '' when they can. */
  rsvpBlocker: string;
}

/**
 * Hostel events. Tenants read published events and RSVP for themselves only; RSVP counts are aggregates,
 * other residents' answers are never exposed. OWNER SIDE for later: `createEvent`, `cancelEvent`, `publishEvent`.
 */
@Injectable({ providedIn: 'root' })
export class TenantEventsService {
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  private readonly notifications = inject(TenantNotificationService);

  private readonly subject = new BehaviorSubject<EventsState>(this.load());
  readonly state$: Observable<EventsState> = this.subject.asObservable();

  get events(): HostelEvent[] {
    return this.subject.value.events;
  }

  // ---- Derived state ---------------------------------------------------------------

  /** Cancelled flag wins; otherwise Completed once the event has ended, else Upcoming. */
  eventStatus(e: HostelEvent, now = Date.now()): EventStatus {
    if (e.cancelled) return 'Cancelled';
    return stamp(e.endAt) < now ? 'Completed' : 'Upcoming';
  }

  deadlineOf(e: HostelEvent): string {
    return e.registrationDeadline ?? e.startAt;
  }

  goingCount(eventId: string): number {
    return this.subject.value.rsvps.filter((r) => r.eventId === eventId && r.choice === 'Going').length;
  }

  /** The signed-in Tenant's RSVP for an event. */
  myRsvp(eventId: string): EventRsvp | undefined {
    const me = this.tenant.residentId;
    return me ? this.subject.value.rsvps.find((r) => r.eventId === eventId && r.residentId === me) : undefined;
  }

  /** Why `choice` (or any RSVP when omitted) is not allowed now; '' when it is. */
  rsvpBlocker(e: HostelEvent, choice?: RsvpChoice): string {
    if (!this.tenant.residentId) return 'Sign in as a Tenant to do this.';
    const status = this.eventStatus(e);
    if (status === 'Cancelled') return 'This event was cancelled.';
    if (status === 'Completed') return 'This event has already finished.';
    if (!e.registrationOpen) return 'Registration is not enabled for this event.';
    if (Date.now() > stamp(this.deadlineOf(e))) return 'The registration deadline has passed.';
    if (Date.now() >= stamp(e.startAt)) return 'This event has already started.';
    if (choice === 'Going') {
      const mine = this.myRsvp(e.id);
      if (e.capacity !== undefined && mine?.choice !== 'Going' && this.goingCount(e.id) >= e.capacity) return 'This event is full, so "Going" is not available. You can still mark Interested.';
    }
    return '';
  }

  private view(e: HostelEvent): TenantEventView {
    const goingCount = this.goingCount(e.id);
    const status = this.eventStatus(e);
    const now = Date.now();
    return {
      ...e,
      status,
      ongoing: status === 'Upcoming' && stamp(e.startAt) <= now,
      deadline: this.deadlineOf(e),
      goingCount,
      spotsLeft: e.capacity !== undefined ? Math.max(0, e.capacity - goingCount) : undefined,
      full: e.capacity !== undefined && goingCount >= e.capacity,
      myRsvp: this.myRsvp(e.id),
      rsvpBlocker: this.rsvpBlocker(e),
    };
  }

  /** Published events for the Tenant: upcoming (soonest first) and past / cancelled (latest first). Drafts are never returned. */
  tenantEvents(): { upcoming: TenantEventView[]; past: TenantEventView[] } {
    if (!this.tenant.residentId) return { upcoming: [], past: [] };
    const all = this.events.filter((e) => e.published && e.hostelId === HOSTEL_ID).map((e) => this.view(e));
    return {
      upcoming: all.filter((e) => e.status === 'Upcoming').sort((a, b) => a.startAt.localeCompare(b.startAt)),
      past: all.filter((e) => e.status !== 'Upcoming').sort((a, b) => b.startAt.localeCompare(a.startAt)),
    };
  }

  // ---- RSVP ---------------------------------------------------------------------------

  /** Records or changes the signed-in Tenant's RSVP. Allowed only while registration is open, before the deadline, for an upcoming event. */
  rsvp(eventId: string, choice: RsvpChoice): EventRsvp {
    const me = this.tenant.requireResidentId();
    if (!RSVP_CHOICES.includes(choice)) throw new Error('Pick Interested, Going or Not Going.');
    const e = this.events.find((x) => x.id === eventId && x.published);
    if (!e) throw new Error('Event not found.');
    const blocker = this.rsvpBlocker(e, choice);
    if (blocker) throw new Error(blocker);
    const prev = this.myRsvp(eventId);
    if (prev?.choice === choice) throw new Error(`You have already answered "${choice}".`);
    const next: EventRsvp = { eventId, residentId: me, choice, at: localNow() };
    this.commit({ rsvps: [...this.subject.value.rsvps.filter((r) => !(r.eventId === eventId && r.residentId === me)), next] });
    try {
      this.notifications.push(me, {
        category: 'Event',
        title: 'RSVP confirmed',
        body: `You answered "${choice}" for ${e.name} on ${e.startAt.slice(0, 10)}.`,
        route: '/my/events',
      });
    } catch {
      // A notification must never block the RSVP.
    }
    return next;
  }

  // ---- OWNER SIDE (for the future owner events screen) ----------------------------------

  private requireOwner(): void {
    if (!this.auth.isHostelOwner && !this.auth.isAdmin) throw new Error('Only the hostel owner can manage events.');
  }

  /** Creates an event. Published by default. */
  createEvent(input: EventInput): HostelEvent {
    this.requireOwner();
    const name = input.name?.trim();
    if (!name) throw new Error('Event name is required.');
    if (!input.description?.trim()) throw new Error('Description is required.');
    if (!input.venue?.trim()) throw new Error('Venue is required.');
    if (!input.organizer?.trim()) throw new Error('Organizer is required.');
    const start = stamp(input.startAt);
    const end = stamp(input.endAt);
    if (isNaN(start) || isNaN(end)) throw new Error('Enter a valid start and end.');
    if (end <= start) throw new Error('The event must end after it starts.');
    if (input.registrationDeadline) {
      const dl = stamp(input.registrationDeadline);
      if (isNaN(dl)) throw new Error('Enter a valid registration deadline.');
      if (dl > start) throw new Error('The registration deadline must be on or before the start.');
    }
    if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < 1)) throw new Error('Capacity must be a whole number of at least 1.');
    const now = localNow();
    const e: HostelEvent = {
      id: this.nextId(),
      hostelId: HOSTEL_ID,
      name,
      description: input.description.trim(),
      startAt: input.startAt.length === 16 ? `${input.startAt}:00` : input.startAt,
      endAt: input.endAt.length === 16 ? `${input.endAt}:00` : input.endAt,
      venue: input.venue.trim(),
      organizer: input.organizer.trim(),
      published: input.published ?? true,
      cancelled: false,
      registrationOpen: input.registrationOpen,
      registrationDeadline: input.registrationDeadline ? (input.registrationDeadline.length === 16 ? `${input.registrationDeadline}:00` : input.registrationDeadline) : undefined,
      capacity: input.capacity,
      createdAt: now,
      updatedAt: now,
    };
    this.commit({ events: [e, ...this.events] });
    return e;
  }

  /** Cancels an event and tells every resident who answered Interested or Going. */
  cancelEvent(id: string, reason: string): HostelEvent {
    this.requireOwner();
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error('Event not found.');
    if (e.cancelled) throw new Error('This event is already cancelled.');
    if (this.eventStatus(e) === 'Completed') throw new Error('A finished event cannot be cancelled.');
    if (!reason?.trim()) throw new Error('Give a reason for cancelling.');
    const next: HostelEvent = { ...e, cancelled: true, cancelReason: reason.trim(), updatedAt: localNow() };
    this.commit({ events: this.events.map((x) => (x.id === id ? next : x)) });
    for (const r of this.subject.value.rsvps.filter((x) => x.eventId === id && x.choice !== 'Not Going')) {
      try {
        this.notifications.push(r.residentId, { category: 'Event', title: 'Event cancelled', body: `${e.name} on ${e.startAt.slice(0, 10)} was cancelled: ${next.cancelReason}.`, route: '/my/events' });
      } catch {
        // ignore a failed notification
      }
    }
    return next;
  }

  publishEvent(id: string): HostelEvent {
    this.requireOwner();
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error('Event not found.');
    const next = { ...e, published: true, updatedAt: localNow() };
    this.commit({ events: this.events.map((x) => (x.id === id ? next : x)) });
    return next;
  }

  // ---------------------------------------------------------------------------------------

  private nextId(): string {
    const max = this.events.reduce((m, e) => Math.max(m, Number(e.id.slice(3)) || 0), 0);
    return `EVT${String(max + 1).padStart(4, '0')}`;
  }

  private commit(patch: Partial<EventsState>): void {
    const next = { ...this.subject.value, ...patch };
    this.subject.next(next);
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(next.events));
      localStorage.setItem(RSVPS_KEY, JSON.stringify(next.rsvps));
    } catch {
      // Storage full or blocked; kept in memory.
    }
  }

  private load(): EventsState {
    try {
      const e = localStorage.getItem(EVENTS_KEY);
      const r = localStorage.getItem(RSVPS_KEY);
      if (e) {
        const events = JSON.parse(e) as HostelEvent[];
        const rsvps = r ? (JSON.parse(r) as EventRsvp[]) : [];
        if (Array.isArray(events) && Array.isArray(rsvps)) return { events, rsvps };
      }
    } catch {
      // Fall through to the seed data.
    }
    const s = seed();
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(s.events));
      localStorage.setItem(RSVPS_KEY, JSON.stringify(s.rsvps));
    } catch {
      // ignore
    }
    return s;
  }
}

// ---- Seed data (relative to today) ------------------------------------------------------

function seed(): EventsState {
  const at = (days: number, hhmm: string): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${localDateIso(d)}T${hhmm}:00`;
  };
  const created = at(-20, '10:00');
  let n = 0;
  const ev = (x: Omit<HostelEvent, 'id' | 'hostelId' | 'published' | 'cancelled' | 'createdAt' | 'updatedAt'> & Partial<Pick<HostelEvent, 'published' | 'cancelled' | 'cancelReason'>>): HostelEvent => ({
    id: `EVT${String(++n).padStart(4, '0')}`,
    hostelId: HOSTEL_ID,
    published: true,
    cancelled: false,
    createdAt: created,
    updatedAt: created,
    ...x,
  });
  const events: HostelEvent[] = [
    ev({ name: 'Movie Night: Open Air Screening', description: 'A family-friendly movie on the terrace. Bring a mat; snacks provided by the mess.', startAt: at(3, '19:30'), endAt: at(3, '22:00'), venue: 'Terrace, Block A', organizer: 'Hostel Warden', registrationOpen: true, registrationDeadline: at(2, '18:00'), capacity: 60 }),
    ev({ name: 'Inter-Block Cricket Tournament', description: 'Teams of 8 from each block. Register your interest and the sports coordinator will form the teams.', startAt: at(6, '16:00'), endAt: at(6, '19:00'), venue: 'Hostel Ground', organizer: 'Sports Committee', registrationOpen: true, registrationDeadline: at(4, '20:00'), capacity: 3 }),
    ev({ name: 'Fire Safety Drill', description: 'A mandatory fire-safety walkthrough and evacuation drill for all residents. No registration needed.', startAt: at(2, '17:00'), endAt: at(2, '18:00'), venue: 'Main Entrance', organizer: 'Hostel Office', registrationOpen: false }),
    ev({ name: 'Diwali Cultural Evening', description: 'Music, rangoli and dinner together. Registration closed once the headcount was shared with the mess.', startAt: at(1, '18:30'), endAt: at(1, '21:30'), venue: 'Common Hall', organizer: 'Cultural Club', registrationOpen: true, registrationDeadline: at(-1, '12:00'), capacity: 80 }),
    ev({ name: 'Career Guidance Webinar', description: 'An online session with alumni on internships and placements.', startAt: at(9, '18:00'), endAt: at(9, '19:30'), venue: 'Online (link shared on RSVP)', organizer: 'Alumni Cell', registrationOpen: true }),
    ev({ name: 'Blood Donation Camp', description: 'Held with a partner hospital. Cancelled because the medical team is unavailable.', startAt: at(5, '10:00'), endAt: at(5, '14:00'), venue: 'Reception', organizer: 'Hostel Office', registrationOpen: true, registrationDeadline: at(4, '10:00'), cancelled: true, cancelReason: 'The medical team is unavailable; a new date will be announced' }),
    ev({ name: 'Freshers Welcome Dinner', description: 'A welcome dinner for new residents.', startAt: at(-12, '19:00'), endAt: at(-12, '21:30'), venue: 'Dining Hall', organizer: 'Hostel Warden', registrationOpen: true, registrationDeadline: at(-14, '18:00'), capacity: 100 }),
    ev({ name: 'Yoga & Wellness Morning', description: 'A guided yoga session on the lawn.', startAt: at(-4, '06:30'), endAt: at(-4, '07:30'), venue: 'Lawn, Block B', organizer: 'Wellness Club', registrationOpen: false }),
    ev({ name: 'Annual Day Planning Meet (draft)', description: 'Internal planning, not yet announced.', startAt: at(14, '17:00'), endAt: at(14, '18:00'), venue: 'Office', organizer: 'Hostel Office', registrationOpen: false, published: false }),
  ];
  const id = (name: string): string => events.find((e) => e.name.startsWith(name))!.id;
  const r = (eventName: string, residentId: string, choice: RsvpChoice, daysAgo: number): EventRsvp => ({ eventId: id(eventName), residentId, choice, at: at(-daysAgo, '12:00') });
  const rsvps: EventRsvp[] = [
    r('Movie Night', 'RES000001', 'Interested', 1),
    r('Movie Night', 'RES000002', 'Going', 1),
    r('Movie Night', 'RES000003', 'Going', 1),
    r('Inter-Block', 'RES000002', 'Going', 2),
    r('Inter-Block', 'RES000003', 'Going', 2),
    r('Inter-Block', 'RES000005', 'Going', 1),
    r('Diwali', 'RES000002', 'Going', 3),
    r('Freshers', 'RES000001', 'Going', 14),
    r('Freshers', 'RES000002', 'Going', 14),
  ];
  return { events, rsvps };
}
