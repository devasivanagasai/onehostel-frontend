// Hostel events and resident RSVPs (FRD 6.7). No owner events module exists yet, so the Tenant events
// service holds the events; `createEvent` / `cancelEvent` are the owner-side entry points for later.

export const RSVP_CHOICES = ['Interested', 'Going', 'Not Going'] as const;
export type RsvpChoice = (typeof RSVP_CHOICES)[number];

export const EVENT_STATUSES = ['Upcoming', 'Completed', 'Cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface HostelEvent {
  /** e.g. EVT0001 */
  id: string;
  hostelId: string;
  name: string;
  description: string;
  /** Local date-times (yyyy-mm-ddTHH:mm:ss). */
  startAt: string;
  endAt: string;
  /** Hostel venue or an online link. */
  venue: string;
  organizer: string;
  /** Drafts are never shown to Tenants. */
  published: boolean;
  cancelled: boolean;
  cancelReason?: string;
  /** Residents can RSVP only while registration is enabled and before the deadline. */
  registrationOpen: boolean;
  /** Local date-time; defaults to the event start. */
  registrationDeadline?: string;
  /** Maximum number of "Going" RSVPs; unset = unlimited. */
  capacity?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventRsvp {
  eventId: string;
  residentId: string;
  choice: RsvpChoice;
  /** Local date-time of the latest change. */
  at: string;
}

export interface EventInput {
  name: string;
  description: string;
  startAt: string;
  endAt: string;
  venue: string;
  organizer: string;
  registrationOpen: boolean;
  registrationDeadline?: string;
  capacity?: number;
  published?: boolean;
}

export const EVENT_STATUS_TONES: Record<EventStatus, string> = {
  Upcoming: 'info',
  Completed: 'neutral',
  Cancelled: 'danger',
};

export const RSVP_TONES: Record<RsvpChoice, string> = {
  Going: 'success',
  Interested: 'info',
  'Not Going': 'neutral',
};
