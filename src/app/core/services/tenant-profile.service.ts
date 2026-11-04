import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { ResidentsService } from './residents.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { HostelResident, ResidentDocument, formatMobile, residentFullName } from '../models/residents.models';
import {
  EMAIL_PATTERN,
  FIELDS_NEEDING_VERIFICATION,
  MOBILE_PATTERN,
  PHOTO_ALLOWED_TYPES,
  PHOTO_MAX_BYTES,
  PROFILE_FIELD_LABELS,
  ProfileRequestInput,
  ProfileRequestField,
  TenantAccountStatus,
  TenantProfileRequest,
  accountStatusFor,
} from '../models/tenant-profile.models';

const STORAGE_KEY = 'onehostel_tenant_profile_v1';
const OTP_MINUTES = 10;
const MAX_OTP_SENDS = 3;
const MAX_OTP_ATTEMPTS = 3;
const MIN_REASON = 5;

interface ProfileState {
  requests: TenantProfileRequest[];
  /** Data URLs of profile photos the Tenant uploaded, by resident id. Kept apart from the resident record. */
  photos: Record<string, string>;
}

export interface VerificationCodeResult {
  /** UI-only build: shown in a "simulation" banner instead of being sent by SMS / email. */
  simulatedCode: string;
  expiresInMinutes: number;
  /** Where the code is "sent", e.g. "98••••4321" or "a•••@x.com". */
  sentTo: string;
}

interface PendingCode {
  value: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

/** What the Tenant profile page shows. Every field except the photo is read-only. */
export interface TenantProfileView {
  residentId: string;
  fullName: string;
  mobile: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  emergencyContact?: string;
  permanentAddress?: string;
  accountStatus: TenantAccountStatus;
  residentType: string;
  documents: ResidentDocument[];
  photoUrl?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const nowLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const maskMobile = (m: string): string => `${m.slice(0, 2)}••••${m.slice(-4)}`;
const maskEmail = (e: string): string => {
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
};

/**
 * Tenant profile and profile-update requests (FRD 5.3). The Tenant can read their own record, upload a
 * photo and raise change requests; the change itself is made only when the Hostel Owner approves it
 * (`decideRequest`). Every Tenant call goes through TenantContextService, never an id from the page.
 */
@Injectable({ providedIn: 'root' })
export class TenantProfileService {
  private readonly tenant = inject(TenantContextService);
  private readonly residents = inject(ResidentsService);
  private readonly notifications = inject(TenantNotificationService);
  private readonly auditLog = inject(AuditLogService);
  private readonly auth = inject(AuthService);

  private readonly state = new BehaviorSubject<ProfileState>(this.load());
  /** Verification codes live in memory only (never stored or put in a notification), per resident + field. */
  private readonly codes = new Map<string, PendingCode>();
  private readonly codeSends = new Map<string, number[]>();

  /** The signed-in Tenant's requests, newest first. */
  readonly mine$: Observable<TenantProfileRequest[]> = this.state.pipe(map((s) => this.ownRequests(s.requests)));

  /** The signed-in Tenant's profile, refreshed when the resident record or photo changes. */
  readonly view$: Observable<TenantProfileView | undefined> = combineLatest([this.tenant.resident$, this.state]).pipe(map(() => this.view));

  get myRequests(): TenantProfileRequest[] {
    return this.ownRequests(this.state.value.requests);
  }

  get view(): TenantProfileView | undefined {
    const r = this.tenant.resident;
    if (!r) return undefined;
    const emergency =
      r.emergencyContactName || r.emergencyContactMobile
        ? [r.emergencyContactName, r.emergencyContactMobile ? formatMobile(r.mobileCode || '+91', r.emergencyContactMobile) : ''].filter(Boolean).join(' · ')
        : undefined;
    return {
      residentId: r.residentId,
      fullName: residentFullName(r),
      mobile: formatMobile(r.mobileCode || '+91', r.mobile),
      email: r.email,
      dateOfBirth: r.dateOfBirth,
      gender: r.gender,
      emergencyContact: emergency,
      permanentAddress: r.permanentAddress,
      accountStatus: accountStatusFor(r.status),
      residentType: r.residentType,
      documents: r.documents,
      photoUrl: this.state.value.photos[r.residentId] ?? r.photoUrl,
    };
  }

  // ---- Photo ----------------------------------------------------------------

  /** Validates (JPG / PNG, up to 2 MB) and stores the Tenant's own profile photo. */
  async setPhoto(file: File): Promise<void> {
    const me = this.tenant.requireResidentId();
    if (!PHOTO_ALLOWED_TYPES.includes(file.type)) throw new Error('Upload a JPG or PNG image.');
    if (file.size > PHOTO_MAX_BYTES) throw new Error('The photo must be 2 MB or smaller.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the photo. Try another file.'));
      reader.readAsDataURL(file);
    });
    this.save({ ...this.state.value, photos: { ...this.state.value.photos, [me]: dataUrl } });
  }

  removePhoto(): void {
    const me = this.tenant.requireResidentId();
    const photos = { ...this.state.value.photos };
    delete photos[me];
    this.save({ ...this.state.value, photos });
  }

  hasUploadedPhoto(): boolean {
    const me = this.tenant.residentId;
    return !!me && !!this.state.value.photos[me];
  }

  // ---- Requests (Tenant) --------------------------------------------------------

  /** The current value of a field as the Tenant sees it, for "current → proposed". */
  currentValue(field: ProfileRequestField, r: HostelResident | undefined = this.tenant.resident): string {
    if (!r) return '';
    switch (field) {
      case 'name':
        return residentFullName(r);
      case 'mobile':
        return r.mobile;
      case 'email':
        return r.email ?? '';
      case 'permanentAddress':
        return r.permanentAddress ?? '';
      case 'emergencyContact':
        return [r.emergencyContactName, r.emergencyContactMobile].filter(Boolean).join(' · ');
    }
  }

  /** The first problem with a proposed change, or null when it can be submitted. Does not need a code. */
  validate(input: ProfileRequestInput): string | null {
    const r = this.tenant.resident;
    if (!r) return 'Your resident record was not found. Contact your hostel office.';
    const value = (input.proposedValue ?? '').trim();
    const value2 = (input.proposedValue2 ?? '').trim();
    switch (input.field) {
      case 'name':
        if (value.length < 2) return 'Enter your full name.';
        if (!/^[\p{L}][\p{L} .'-]*$/u.test(value)) return 'The name can only contain letters, spaces and . - \'';
        if (value.toLowerCase() === residentFullName(r).toLowerCase()) return 'The new name is the same as your current name.';
        break;
      case 'mobile':
        if (!MOBILE_PATTERN.test(value)) return 'Enter a 10-digit mobile number.';
        if (value === r.mobile) return 'The new mobile number is the same as your current one.';
        if (this.residents.findDuplicate('mobile', value, r.residentId)) return 'This mobile number is already in use.';
        break;
      case 'email':
        if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address.';
        if (value.toLowerCase() === (r.email ?? '').toLowerCase()) return 'The new email is the same as your current one.';
        if (this.residents.findDuplicate('email', value, r.residentId)) return 'This email address is already in use.';
        break;
      case 'permanentAddress':
        if (value.length < 5) return 'Enter your full permanent address.';
        if (value === (r.permanentAddress ?? '').trim()) return 'The new address is the same as your current address.';
        break;
      case 'emergencyContact':
        if (value.length < 2) return 'Enter the emergency contact’s name.';
        if (!MOBILE_PATTERN.test(value2)) return 'Enter a 10-digit mobile number for the emergency contact.';
        if (value === (r.emergencyContactName ?? '') && value2 === (r.emergencyContactMobile ?? '')) return 'These are the same as your current emergency contact.';
        break;
      default:
        return 'Choose what you want to change.';
    }
    if ((input.reason ?? '').trim().length < MIN_REASON) return `Give a reason (at least ${MIN_REASON} characters).`;
    return null;
  }

  /**
   * Sends a verification code to the NEW mobile / email (simulated). The code is returned only so the
   * simulation banner can show it; it is never stored, logged or put in a notification.
   */
  requestVerificationCode(field: ProfileRequestField, proposedValue: string): VerificationCodeResult {
    const me = this.tenant.requireResidentId();
    if (!FIELDS_NEEDING_VERIFICATION.includes(field)) throw new Error('This change does not need verification.');
    const problem = this.validate({ field, proposedValue, reason: 'verification' });
    if (problem) throw new Error(problem);
    const key = `${me}:${field}`;
    const now = Date.now();
    const recent = (this.codeSends.get(key) ?? []).filter((t) => now - t < 30 * 60_000);
    if (recent.length >= MAX_OTP_SENDS) throw new Error('Too many codes requested. Please wait 30 minutes and try again.');
    this.codeSends.set(key, [...recent, now]);
    const value = proposedValue.trim();
    const code = String(100000 + Math.floor(Math.random() * 900000));
    this.codes.set(key, { value, code, expiresAt: now + OTP_MINUTES * 60_000, attempts: 0 });
    return { simulatedCode: code, expiresInMinutes: OTP_MINUTES, sentTo: field === 'mobile' ? maskMobile(value) : maskEmail(value) };
  }

  /** Raises a profile update request for the signed-in Tenant. Mobile / email need a valid code for the proposed value. */
  submitRequest(input: ProfileRequestInput): TenantProfileRequest {
    const me = this.tenant.requireResidentId();
    const r = this.tenant.requireResident();
    const problem = this.validate(input);
    if (problem) throw new Error(problem);
    if (this.myRequests.some((q) => q.field === input.field && q.status === 'Pending')) {
      throw new Error(`You already have a pending request to change your ${PROFILE_FIELD_LABELS[input.field].toLowerCase()}. Cancel it or wait for the decision.`);
    }
    const needsVerification = FIELDS_NEEDING_VERIFICATION.includes(input.field);
    if (needsVerification) this.consumeCode(me, input.field, input.proposedValue.trim(), input.verificationCode ?? '');

    const request: TenantProfileRequest = {
      id: this.nextId(),
      residentId: me,
      field: input.field,
      currentValue: this.currentValue(input.field, r),
      proposedValue: input.proposedValue.trim(),
      proposedValue2: input.field === 'emergencyContact' ? (input.proposedValue2 ?? '').trim() : undefined,
      reason: input.reason.trim(),
      needsVerification,
      verified: needsVerification,
      status: 'Pending',
      createdAt: nowLocal(),
    };
    this.save({ ...this.state.value, requests: [request, ...this.state.value.requests] });
    this.auditLog.record('Update Resident', `${me} · ${residentFullName(r)}`, { details: `Profile update requested: ${PROFILE_FIELD_LABELS[input.field]} (${request.id}).` });
    return request;
  }

  /** The Tenant withdraws one of their own Pending requests. */
  cancelRequest(id: string): TenantProfileRequest {
    const req = this.requireOwn(id);
    if (req.status !== 'Pending') throw new Error(`This request is already ${req.status.toLowerCase()}.`);
    const next: TenantProfileRequest = { ...req, status: 'Cancelled', decidedAt: nowLocal(), decidedBy: 'Tenant', remark: 'Cancelled by you.' };
    this.replace(next);
    this.auditLog.record('Update Resident', `${req.residentId}`, { details: `Profile update request ${req.id} cancelled by the Tenant.` });
    return next;
  }

  // ---- Owner side ---------------------------------------------------------------

  /** Every request from every resident, newest first. Hostel Owner / Admin screens only. */
  get allRequests(): TenantProfileRequest[] {
    this.requireStaff();
    return [...this.state.value.requests];
  }

  /** Live list for the owner's review screen; empty for anyone who is not Hostel Owner / Admin. */
  readonly allRequests$: Observable<TenantProfileRequest[]> = this.state.pipe(map((s) => (this.isStaff ? [...s.requests] : [])));

  /**
   * Hostel Owner / Admin decision. Approve applies the value to the resident record (duplicates are
   * refused and the request stays Pending); Reject needs a remark. The Tenant gets a 'Profile' notification.
   */
  decideRequest(id: string, decision: 'Approved' | 'Rejected', remark: string): TenantProfileRequest {
    this.requireStaff();
    const req = this.state.value.requests.find((q) => q.id === id);
    if (!req) throw new Error('Request not found.');
    if (req.status !== 'Pending') throw new Error(`This request is already ${req.status.toLowerCase()}.`);
    const note = remark.trim();
    if (decision === 'Rejected' && note.length < 3) throw new Error('Add a remark explaining why the request is rejected.');
    if (decision === 'Approved' && req.needsVerification && !req.verified) throw new Error('The new contact was not verified.');

    if (decision === 'Approved') this.apply(req);

    const next: TenantProfileRequest = { ...req, status: decision, decidedAt: nowLocal(), decidedBy: this.auth.currentUser?.name ?? 'Hostel Owner', remark: note || undefined };
    this.replace(next);
    const label = PROFILE_FIELD_LABELS[req.field].toLowerCase();
    this.notifications.push(req.residentId, {
      category: 'Profile',
      title: decision === 'Approved' ? 'Profile update approved' : 'Profile update rejected',
      body:
        decision === 'Approved'
          ? `Your request to change your ${label} was approved and your profile is updated.`
          : `Your request to change your ${label} was rejected.${note ? ' Remark: ' + note : ''}`,
      route: '/my/profile',
    });
    this.auditLog.record('Update Resident', req.residentId, { details: `Profile update request ${req.id} (${PROFILE_FIELD_LABELS[req.field]}) ${decision.toLowerCase()}.` });
    return next;
  }

  // ---------------------------------------------------------------------------

  private apply(req: TenantProfileRequest): void {
    switch (req.field) {
      case 'name': {
        const parts = req.proposedValue.split(/\s+/);
        this.residents.applyProfileChange(req.residentId, { firstName: parts[0], lastName: parts.slice(1).join(' ') });
        break;
      }
      case 'mobile':
        this.residents.applyProfileChange(req.residentId, { mobile: req.proposedValue });
        break;
      case 'email':
        this.residents.applyProfileChange(req.residentId, { email: req.proposedValue });
        break;
      case 'permanentAddress':
        this.residents.applyProfileChange(req.residentId, { permanentAddress: req.proposedValue });
        break;
      case 'emergencyContact':
        this.residents.applyProfileChange(req.residentId, { emergencyContactName: req.proposedValue, emergencyContactMobile: req.proposedValue2 });
        break;
    }
  }

  private consumeCode(me: string, field: ProfileRequestField, value: string, code: string): void {
    const key = `${me}:${field}`;
    const pending = this.codes.get(key);
    if (!pending || pending.value !== value) throw new Error('Send a verification code to the new contact first.');
    if (Date.now() > pending.expiresAt) {
      this.codes.delete(key);
      throw new Error('This code has expired. Request a new one.');
    }
    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      this.codes.delete(key);
      throw new Error('Too many wrong codes. Request a new one.');
    }
    if (code.trim() !== pending.code) {
      pending.attempts += 1;
      const left = MAX_OTP_ATTEMPTS - pending.attempts;
      throw new Error(left > 0 ? `That code is not valid. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Request a new one.');
    }
    this.codes.delete(key);
  }

  private get isStaff(): boolean {
    return this.auth.isAdmin || this.auth.isHostelOwner;
  }

  private requireStaff(): void {
    if (!this.isStaff) throw new Error('Only the Hostel Owner can review profile update requests.');
  }

  private requireOwn(id: string): TenantProfileRequest {
    const me = this.tenant.requireResidentId();
    const req = this.state.value.requests.find((q) => q.id === id);
    if (!req || req.residentId !== me) throw new Error('Request not found.');
    return req;
  }

  private ownRequests(list: TenantProfileRequest[]): TenantProfileRequest[] {
    const me = this.tenant.residentId;
    return me ? list.filter((q) => q.residentId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : [];
  }

  private replace(next: TenantProfileRequest): void {
    this.save({ ...this.state.value, requests: this.state.value.requests.map((q) => (q.id === next.id ? next : q)) });
  }

  private nextId(): string {
    const max = this.state.value.requests.reduce((m, q) => Math.max(m, Number(q.id.slice(3)) || 0), 0);
    return `PUR${String(max + 1).padStart(6, '0')}`;
  }

  private load(): ProfileState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as ProfileState) : null;
      if (parsed && Array.isArray(parsed.requests)) return { requests: parsed.requests, photos: parsed.photos ?? {} };
    } catch {
      /* fall back to the seed */
    }
    return seed();
  }

  private save(next: ProfileState): void {
    this.state.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable or full (large photo); kept in memory */
    }
  }
}

function seed(): ProfileState {
  return {
    photos: {},
    requests: [
      {
        id: 'PUR000001',
        residentId: 'RES000001',
        field: 'name',
        currentValue: 'Rahul Sharma',
        proposedValue: 'Rahul Kumar Sharma',
        reason: 'Match the name on my college ID.',
        needsVerification: false,
        verified: false,
        status: 'Rejected',
        createdAt: '2026-09-10T11:00:00',
        decidedAt: '2026-09-11T10:15:00',
        decidedBy: 'Hostel Owner',
        remark: 'Name must match the Aadhaar on file. Upload a college letter and request again.',
      },
    ],
  };
}
