import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuthService } from './auth.service';
import { HostelSettingsService } from './hostel-settings.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  DUPLICATE_WINDOW_MS,
  NewSupportTicketInput,
  SUBJECT_MAX,
  SUBJECT_MIN,
  SUPPORT_STATUSES,
  SUPPORT_TOPICS,
  SupportMessage,
  SupportStatus,
  SupportTicket,
  TenantAttachmentMeta,
  assertAttachments,
} from '../models/tenant-support.models';

const STORAGE_KEY = 'onehostel_tenant_support_v1';

const pad = (n: number): string => String(n).padStart(2, '0');
const localIso = (d = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Contact details for the hostel office, from the hostel profile. */
export interface HostelContact {
  hostelName: string;
  phone: string;
  email: string;
  address: string;
}

/**
 * Help & Support tickets (FRD 5.9). A Tenant sees and changes only their own tickets (resident id comes from
 * TenantContextService). Past messages are never edited; replies are appended. The hostel-side methods
 * (`reply`, `setStatus`) are for the Owner / Admin screens and notify the Tenant.
 */
@Injectable({ providedIn: 'root' })
export class TenantSupportService {
  private readonly tenant = inject(TenantContextService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(TenantNotificationService);
  private readonly hostelSettings = inject(HostelSettingsService);

  private readonly subject = new BehaviorSubject<SupportTicket[]>(this.load());

  /** The signed-in Tenant's tickets, most recently active first. */
  readonly mine$: Observable<SupportTicket[]> = this.subject.pipe(map((list) => this.own(list)));

  get mine(): SupportTicket[] {
    return this.own(this.subject.value);
  }

  get hostelContact(): HostelContact {
    const p = this.hostelSettings.state.value.profile;
    return {
      hostelName: p.hostelName,
      phone: p.phone,
      email: p.email,
      address: [p.addressLine1, p.addressLine2, p.city, p.state, p.pincode].map((x) => (x ?? '').trim()).filter(Boolean).join(', '),
    };
  }

  /** One of the Tenant's own tickets; "Ticket not found." for anyone else's. */
  get(id: string): SupportTicket {
    return this.requireOwn(id);
  }

  // ---- Tenant actions ------------------------------------------------------------

  create(input: NewSupportTicketInput): SupportTicket {
    const me = this.tenant.requireResidentId();
    const subject = input.subject.trim();
    const description = input.description.trim();
    if (!SUPPORT_TOPICS.includes(input.topic)) throw new Error('Choose a help topic.');
    if (subject.length < SUBJECT_MIN) throw new Error(`Subject must be at least ${SUBJECT_MIN} characters.`);
    if (subject.length > SUBJECT_MAX) throw new Error(`Subject can be up to ${SUBJECT_MAX} characters.`);
    if (description.length < DESCRIPTION_MIN) throw new Error(`Describe the problem in at least ${DESCRIPTION_MIN} characters.`);
    if (description.length > DESCRIPTION_MAX) throw new Error(`Description can be up to ${DESCRIPTION_MAX} characters.`);
    assertAttachments(input.attachments);

    const now = Date.now();
    const dup = this.mine.find((t) => t.status !== 'Closed' && t.status !== 'Resolved' && t.subject.trim().toLowerCase() === subject.toLowerCase() && now - new Date(t.createdAt).getTime() < DUPLICATE_WINDOW_MS);
    if (dup) throw new Error(`You already sent a request with this subject a moment ago (${dup.id}). Please wait a couple of minutes before sending it again.`);

    const at = localIso();
    const ticket: SupportTicket = {
      id: this.nextId(),
      residentId: me,
      topic: input.topic,
      subject,
      description,
      attachments: input.attachments,
      status: 'Submitted',
      createdAt: at,
      updatedAt: at,
      messages: [],
    };
    this.save([ticket, ...this.subject.value]);
    this.notify(me, `Your support request ${ticket.id} was submitted. The hostel office will reply here.`);
    return ticket;
  }

  /** Appends the Tenant's reply (not on a Closed ticket). A reply moves Waiting / Resolved tickets back to In Progress. */
  replyAsTenant(id: string, text: string, attachments: TenantAttachmentMeta[] = []): SupportTicket {
    this.tenant.requireResidentId();
    const t = this.requireOwn(id);
    if (t.status === 'Closed') throw new Error('This request is closed. Please submit a new one.');
    const body = this.cleanText(text);
    assertAttachments(attachments);
    const status: SupportStatus = t.status === 'Waiting for Resident' || t.status === 'Resolved' ? 'In Progress' : t.status;
    return this.append(t, { author: 'Tenant', by: 'You', text: body, attachments }, status);
  }

  /** The Tenant closes their own Resolved ticket. */
  close(id: string): SupportTicket {
    this.tenant.requireResidentId();
    const t = this.requireOwn(id);
    if (t.status !== 'Resolved') throw new Error('Only a resolved request can be closed.');
    return this.update(t, { status: 'Closed' });
  }

  // ---- Hostel (Owner / Admin) side, for the owner screens --------------------------

  /** Hostel office reply (staff only). Moves the ticket to 'Waiting for Resident' and notifies the Tenant. */
  reply(id: string, text: string): SupportTicket {
    this.requireStaff();
    const t = this.requireAny(id);
    if (t.status === 'Closed') throw new Error('A closed request cannot be replied to.');
    const body = this.cleanText(text);
    const status: SupportStatus = t.status === 'Resolved' ? 'Resolved' : 'Waiting for Resident';
    const next = this.append(t, { author: 'Hostel', by: 'Hostel office', text: body, attachments: [] }, status);
    this.notify(t.residentId, `There is a new reply on your support request ${t.id}.`);
    return next;
  }

  /** Hostel sets the status (any of the five). A Closed ticket is final. Notifies the Tenant. */
  setStatus(id: string, status: SupportStatus): SupportTicket {
    this.requireStaff();
    const t = this.requireAny(id);
    if (!SUPPORT_STATUSES.includes(status)) throw new Error('Unknown status.');
    if (t.status === 'Closed') throw new Error('A closed request cannot be changed.');
    if (t.status === status) return t;
    const next = this.update(t, { status });
    this.notify(t.residentId, `Your support request ${t.id} is now ${status === 'Waiting for Resident' ? 'waiting for your reply' : status}.`);
    return next;
  }

  /** Every ticket (hostel staff only). */
  allTickets(): SupportTicket[] {
    this.requireStaff();
    return [...this.subject.value];
  }

  // ---------------------------------------------------------------------------

  private cleanText(text: string): string {
    const body = text.trim();
    if (!body) throw new Error('Write a message first.');
    if (body.length > DESCRIPTION_MAX) throw new Error(`Messages can be up to ${DESCRIPTION_MAX} characters.`);
    return body;
  }

  private requireStaff(): void {
    if (!(this.auth.isAdmin || this.auth.isHostelOwner)) throw new Error("You don't have permission to manage support requests.");
  }

  private requireOwn(id: string): SupportTicket {
    const me = this.tenant.requireResidentId();
    const t = this.subject.value.find((x) => x.id === id);
    if (!t || t.residentId !== me) throw new Error('Ticket not found.');
    return t;
  }

  private requireAny(id: string): SupportTicket {
    const t = this.subject.value.find((x) => x.id === id);
    if (!t) throw new Error('Ticket not found.');
    return t;
  }

  private own(list: SupportTicket[]): SupportTicket[] {
    const me = this.tenant.residentId;
    return me ? list.filter((t) => t.residentId === me).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)) : [];
  }

  private append(t: SupportTicket, m: Pick<SupportMessage, 'author' | 'by' | 'text' | 'attachments'>, status: SupportStatus): SupportTicket {
    const at = localIso();
    const message: SupportMessage = { id: `${t.id}-M${t.messages.length + 1}`, at, ...m };
    return this.update(t, { status, messages: [...t.messages, message] });
  }

  private update(t: SupportTicket, changes: Partial<SupportTicket>): SupportTicket {
    const next: SupportTicket = { ...t, ...changes, updatedAt: localIso() };
    this.save(this.subject.value.map((x) => (x.id === t.id ? next : x)));
    return next;
  }

  private notify(residentId: string, body: string): void {
    try {
      this.notifications.push(residentId, { category: 'Support', title: 'Help & Support', body, route: '/my/support' });
    } catch {
      /* the ticket change is already saved */
    }
  }

  private nextId(): string {
    const max = this.subject.value.reduce((m, t) => Math.max(m, Number(t.id.slice(3)) || 0), 0);
    return `SUP${String(max + 1).padStart(6, '0')}`;
  }

  private save(list: SupportTicket[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* kept in memory */
    }
  }

  private load(): SupportTicket[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as SupportTicket[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall back to the seed */
    }
    return seed();
  }
}

function seed(): SupportTicket[] {
  const ago = (h: number): string => localIso(new Date(Date.now() - h * 3_600_000));
  const msg = (id: string, n: number, h: number, author: SupportMessage['author'], text: string): SupportMessage => ({
    id: `${id}-M${n}`,
    at: ago(h),
    author,
    by: author === 'Tenant' ? 'You' : 'Hostel office',
    text,
    attachments: [],
  });
  return [
    {
      id: 'SUP000003', residentId: 'RES000002', topic: 'Login', subject: 'Cannot sign in on my phone',
      description: 'The sign-in page keeps saying my details are wrong on my phone.', attachments: [], status: 'Submitted',
      createdAt: ago(4), updatedAt: ago(4), messages: [],
    },
    {
      id: 'SUP000002', residentId: 'RES000001', topic: 'Payment', subject: 'Receipt not showing for last month',
      description: 'I paid last month rent but the receipt is not visible in Fees & Payments.', attachments: [], status: 'Resolved',
      createdAt: ago(96), updatedAt: ago(30),
      messages: [
        msg('SUP000002', 1, 72, 'Hostel', 'We found the payment and regenerated your receipt. It is now available under Fees & Payments.'),
        msg('SUP000002', 2, 60, 'Tenant', 'I can see it now, thank you.'),
        msg('SUP000002', 3, 30, 'Hostel', 'Glad it is sorted. Marking this as resolved.'),
      ],
    },
    {
      id: 'SUP000001', residentId: 'RES000001', topic: 'Room', subject: 'Request for an extra study table',
      description: 'Could we get an extra study table in Room 101? We have only one for two people.', attachments: [], status: 'Waiting for Resident',
      createdAt: ago(48), updatedAt: ago(10),
      messages: [
        msg('SUP000001', 1, 40, 'Hostel', 'We can arrange one. Do you prefer a folding table or a fixed one?'),
        msg('SUP000001', 2, 30, 'Tenant', 'A folding table would be great.'),
        msg('SUP000001', 3, 10, 'Hostel', 'Noted. Is tomorrow after 5 PM convenient for delivery?'),
      ],
    },
  ];
}
