import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { ResidentsService } from './residents.service';
import { SystemSettingsService } from './system-settings.service';
import { diffForAudit } from '../models/audit.models';
import { HostelResident, residentFullName } from '../models/residents.models';
import { localDateIso } from '../../shared/utils/local-date';
import {
  ACCESS_SCOPES,
  CONSENT_CHANNELS,
  DEFAULT_OTP_MINUTES,
  EffectiveAccess,
  EMAIL_PATTERN,
  Guardian,
  GuardianEvent,
  GuardianInput,
  GuardianNotifyKind,
  GUARDIAN_RELATIONSHIP_OPTIONS,
  MAX_OTP_ATTEMPTS,
  MOBILE_PATTERN,
  REASON_MAX,
  VerifyResult,
} from '../models/guardians.models';

// Mock data: guardians live in localStorage. A verification code is generated in the browser and
// shown only in the dialog's simulation banner. A real build sends it by SMS / email and checks it server-side.
// Audit: every mutation is recorded through AuditLogService (never with the code in it).

const STORAGE_KEY = 'onehostel_guardians_v1';

const AUDIT_LABELS: Record<string, string> = {
  name: 'Guardian name',
  relationship: 'Relationship',
  mobile: 'Mobile',
  email: 'Email',
  primary: 'Primary contact',
  consent: 'Notification consent',
  consentDate: 'Consent captured on',
  scope: 'Access scope',
};

/** Local wall-clock date-time as yyyy-mm-ddTHH:mm:ss. */
function nowIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDateIso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseIso(iso: string): number {
  return new Date(iso).getTime();
}

const ev = (at: string, by: string, action: string, note?: string): GuardianEvent => ({ at, by, action, note });

type SeedGuardian = Partial<Guardian> & Pick<Guardian, 'id' | 'residentId' | 'name' | 'relationship' | 'primary' | 'verification' | 'consent' | 'scope'>;

/** Seed: verified, unverified, rejected, siblings sharing one guardian mobile, and a guardian of a checked-out resident. */
function seed(): Guardian[] {
  const o = 'Hostel Owner';
  const g = (x: SeedGuardian): Guardian => ({
    consentDate: '2026-08-01',
    createdAt: '2026-08-01T10:00:00',
    updatedAt: '2026-08-01T10:00:00',
    history: [ev('2026-08-01T10:00:00', o, 'Guardian added')],
    ...x,
  });
  return [
    g({ id: 'GDN000001', residentId: 'RES000001', name: 'Mahesh Sharma', relationship: 'Parent', mobile: '9822001101', email: 'mahesh.sharma@gmail.com', primary: true, verification: 'Verified', verifiedAt: '2026-08-02T11:20:00', consent: 'SMS', scope: ['Leave decisions', 'Emergency alerts', 'Dues', 'Notices'], history: [ev('2026-08-01T10:00:00', o, 'Guardian added'), ev('2026-08-02T11:20:00', o, 'Verified with code')] }),
    g({ id: 'GDN000002', residentId: 'RES000001', name: 'Sunita Sharma', relationship: 'Parent', mobile: '9822001102', primary: false, verification: 'Unverified', consent: 'Email', scope: ['Emergency alerts', 'Notices'] }),
    g({ id: 'GDN000003', residentId: 'RES000002', name: 'Rakesh Verma', relationship: 'Guardian', email: 'rakesh.verma@outlook.com', primary: true, verification: 'Unverified', consent: 'Email', scope: ['Emergency alerts', 'Dues'] }),
    g({ id: 'GDN000004', residentId: 'RES000003', name: 'Harpreet Singh', relationship: 'Parent', mobile: '9811004401', primary: true, verification: 'Verified', verifiedAt: '2026-07-12T09:30:00', consent: 'SMS', scope: ['Leave decisions', 'Emergency alerts', 'Attendance summary'], consentDate: '2026-07-10' }),
    g({ id: 'GDN000005', residentId: 'RES000004', name: 'Dilip Patel', relationship: 'Parent', mobile: '9811000011', primary: true, verification: 'Verified', verifiedAt: '2026-07-14T16:00:00', consent: 'SMS', scope: ['Leave decisions', 'Emergency alerts', 'Dues'], consentDate: '2026-07-12' }),
    g({ id: 'GDN000006', residentId: 'RES000008', name: 'Dilip Patel', relationship: 'Parent', mobile: '9811000011', primary: true, verification: 'Unverified', consent: 'SMS', scope: ['Leave decisions', 'Notices'], consentDate: '2026-10-14' }),
    g({ id: 'GDN000007', residentId: 'RES000005', name: 'Imran Khan', relationship: 'Parent', mobile: '9811005501', primary: true, verification: 'Rejected', consent: 'None', scope: ['Emergency alerts'], history: [ev('2026-07-15T12:00:00', o, 'Guardian added'), ev('2026-07-15T12:05:00', 'System', 'Rejected after 3 wrong codes')] }),
    g({ id: 'GDN000008', residentId: 'RES000010', name: 'Kavita Iyer', relationship: 'Parent', mobile: '9811007701', primary: true, verification: 'Verified', verifiedAt: '2026-01-12T10:00:00', consent: 'SMS', scope: ['Emergency alerts', 'Dues'], consentDate: '2026-01-10' }),
  ];
}

@Injectable({ providedIn: 'root' })
export class GuardiansService {
  private readonly auth = inject(AuthService);
  private readonly audit = inject(AuditLogService);
  private readonly residentsService = inject(ResidentsService);
  private readonly systemSettings = inject(SystemSettingsService);

  private readonly subject = new BehaviorSubject<Guardian[]>(this.load());
  readonly guardians$: Observable<Guardian[]> = this.subject.asObservable();

  get guardians(): Guardian[] {
    return this.subject.value;
  }

  byId(id: string): Guardian | undefined {
    return this.guardians.find((g) => g.id === id);
  }

  /** Guardians linked to one resident, primary first. */
  byResident(residentId: string): Guardian[] {
    return this.guardians.filter((g) => g.residentId === residentId).sort((a, b) => Number(b.primary) - Number(a.primary) || a.id.localeCompare(b.id));
  }

  // ---- Residents (read only) ---------------------------------------------------------

  /** Residents a guardian can be linked to: everyone not deactivated (a checked-out resident is allowed but shows access revoked). */
  get linkableResidents(): HostelResident[] {
    return this.residentsService.residents.filter((r) => !r.deactivatedAt);
  }

  resident(id: string): HostelResident | undefined {
    return this.residentsService.byId(id);
  }

  residentName(id: string): string {
    const r = this.resident(id);
    return r ? residentFullName(r) : id;
  }

  /** Minutes a verification code stays valid: the security setting when present, else 10. */
  get otpMinutes(): number {
    const v = Number((this.systemSettings.settings.security as unknown as Record<string, unknown> | undefined)?.['otpExpiryMinutes']);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_OTP_MINUTES;
  }

  // ---- Derived state -----------------------------------------------------------------

  /**
   * Access is computed, not stored: a checked-out or deactivated (or missing) resident revokes it
   * automatically; the owner can also revoke by hand with a reason.
   */
  effectiveAccess(g: Guardian): EffectiveAccess {
    const r = this.resident(g.residentId);
    if (!r) return { state: 'Revoked', reason: 'Access revoked – resident record not found', automatic: true };
    if (r.status === 'Checked Out') return { state: 'Revoked', reason: 'Access revoked – resident checked out', automatic: true };
    if (r.deactivatedAt) return { state: 'Revoked', reason: 'Access revoked – resident deactivated', automatic: true };
    if (g.manualRevoke) return { state: 'Revoked', reason: `Access revoked by owner – ${g.manualRevoke.reason}`, automatic: false };
    return { state: 'Active', reason: '', automatic: false };
  }

  /**
   * Guardians who may be alerted about `kind` for a resident: Verified, access active, consent other
   * than None, and the kind inside their access scope. Leave / Dues can call this when they send alerts.
   */
  guardiansToNotify(residentId: string, kind: GuardianNotifyKind): Guardian[] {
    return this.byResident(residentId).filter((g) => !this.notifyBlocker(g, kind));
  }

  /** Why one guardian would not get an alert (empty = they would). */
  notifyBlocker(g: Guardian, kind: GuardianNotifyKind): string {
    if (this.effectiveAccess(g).state === 'Revoked') return 'Access revoked';
    if (g.verification !== 'Verified') return `Not verified (${g.verification})`;
    if (g.consent === 'None') return 'No notification consent';
    if (!g.scope.includes(kind)) return `${kind} is outside their access scope`;
    return '';
  }

  /** Seconds left on a pending code; 0 when none / expired. */
  otpSecondsLeft(g: Guardian): number {
    if (!g.otp) return 0;
    return Math.max(0, Math.ceil((parseIso(g.otp.expiresAt) - Date.now()) / 1000));
  }

  /** Simulation only: the code the dialog's banner shows in place of an SMS / email. */
  simulatedCode(id: string): string | undefined {
    return this.byId(id)?.otp?.code;
  }

  // ---- Validation --------------------------------------------------------------------

  /** First problem with the input, or '' when it can be saved. `exceptId` = the guardian being edited. */
  validate(input: GuardianInput, exceptId?: string): string {
    const existing = exceptId ? this.byId(exceptId) : undefined;
    if (!existing && !this.linkableResidents.some((r) => r.residentId === input.residentId)) return 'Select a resident to link.';
    if (existing && existing.residentId !== input.residentId) return 'A guardian cannot be moved to another resident. Add a new link instead.';
    if (!input.name?.trim()) return 'Guardian name is required.';
    if (!GUARDIAN_RELATIONSHIP_OPTIONS.includes(input.relationship)) return 'Select a relationship.';
    const mobile = input.mobile?.trim() ?? '';
    const email = input.email?.trim() ?? '';
    if (!mobile && !email) return 'Enter a mobile number or an email (at least one contact).';
    if (mobile && !MOBILE_PATTERN.test(mobile)) return 'Mobile must be 10 digits.';
    if (email && !EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
    if (!CONSENT_CHANNELS.includes(input.consent)) return 'Select a notification consent.';
    if (!input.consentDate) return 'Enter the date consent was captured.';
    if (input.consentDate > localDateIso()) return 'Consent date cannot be in the future.';
    if (!input.scope?.length) return 'Select at least one item the guardian may access.';
    if (input.scope.some((s) => !ACCESS_SCOPES.includes(s))) return 'Unknown access scope.';
    if (mobile) {
      const dup = this.guardians.find((g) => g.id !== exceptId && g.residentId === input.residentId && g.mobile === mobile);
      if (dup) return `${dup.name} (${dup.id}) already has this mobile for this resident.`;
    }
    if (existing?.primary && !input.primary) return 'Each resident needs one primary contact. Make another guardian primary instead.';
    return '';
  }

  // ---- Actions -----------------------------------------------------------------------

  create(input: GuardianInput): Guardian {
    const problem = this.validate(input);
    if (problem) throw new Error(problem);
    const now = nowIso();
    const siblings = this.byResident(input.residentId);
    // The first guardian is always primary; a new primary moves the flag off the others.
    const primary = input.primary || siblings.length === 0;
    const g: Guardian = {
      id: this.nextId(),
      residentId: input.residentId,
      name: input.name.trim(),
      relationship: input.relationship,
      mobile: input.mobile?.trim() || undefined,
      email: input.email?.trim() || undefined,
      primary,
      verification: 'Unverified',
      consent: input.consent,
      consentDate: input.consentDate,
      scope: this.cleanScope(input.scope),
      createdAt: now,
      updatedAt: now,
      history: [ev(now, this.userName, 'Guardian added', primary ? 'Primary contact' : undefined)],
    };
    const rest = primary ? this.guardians.map((x) => (x.residentId === g.residentId && x.primary ? this.demote(x, now, g.id) : x)) : this.guardians;
    this.commit([...rest, g]);
    this.audit.record('Create Guardian', this.label(g), { details: `Linked to ${this.residentLabel(g.residentId)} as ${g.relationship}${primary ? ' (primary)' : ''}` });
    return g;
  }

  update(id: string, input: GuardianInput): Guardian {
    const before = this.require(id);
    const problem = this.validate(input, id);
    if (problem) throw new Error(problem);
    const now = nowIso();
    const mobile = input.mobile?.trim() || undefined;
    const email = input.email?.trim() || undefined;
    const contactChanged = mobile !== before.mobile || email !== before.email;
    // A changed contact is a different person to verify, so the earlier result no longer stands.
    const resetVerification = contactChanged && before.verification !== 'Unverified';
    const next: Guardian = {
      ...before,
      name: input.name.trim(),
      relationship: input.relationship,
      mobile,
      email,
      primary: input.primary || before.primary,
      consent: input.consent,
      consentDate: input.consentDate,
      scope: this.cleanScope(input.scope),
      ...(resetVerification ? { verification: 'Unverified' as const, verifiedAt: undefined, otp: undefined } : {}),
      updatedAt: now,
    };
    const changes = diffForAudit(this.auditView(before), this.auditView(next), AUDIT_LABELS);
    if (resetVerification) changes.push({ field: 'Verification', oldValue: before.verification, newValue: 'Unverified' });
    next.history = [...before.history, ev(now, this.userName, 'Guardian updated', changes.length ? changes.map((c) => c.field).join(', ') : 'No changes')];
    const promote = next.primary && !before.primary;
    const list = this.guardians.map((x) => {
      if (x.id === id) return next;
      return promote && x.residentId === next.residentId && x.primary ? this.demote(x, now, id) : x;
    });
    this.commit(list);
    if (changes.length) this.audit.record('Update Guardian', this.label(next), { changes });
    return next;
  }

  /** Makes this guardian the resident's primary contact; the previous primary is moved off. */
  setPrimary(id: string): Guardian {
    const g = this.require(id);
    if (g.primary) return g;
    return this.update(id, { ...this.toInput(g), primary: true });
  }

  /** Starts (or restarts) verification: a 6-digit code valid for `otpMinutes`, status Pending. */
  sendVerification(id: string): Guardian {
    const g = this.require(id);
    if (this.effectiveAccess(g).state === 'Revoked') throw new Error('Access is revoked, so no verification can be sent.');
    if (g.verification === 'Verified') throw new Error('This guardian is already verified.');
    if (!g.mobile && !g.email) throw new Error('Add a mobile number or email first.');
    const now = new Date();
    const sentTo = g.mobile ? `SMS to ${g.mobile.slice(0, 2)}******${g.mobile.slice(-2)}` : `email to ${g.email}`;
    const otp = {
      code: String(Math.floor(100000 + Math.random() * 900000)),
      sentAt: nowIso(now),
      expiresAt: nowIso(new Date(now.getTime() + this.otpMinutes * 60_000)),
      attempts: 0,
      sentTo,
    };
    const at = nowIso(now);
    const next: Guardian = { ...g, verification: 'Pending', otp, updatedAt: at, history: [...g.history, ev(at, this.userName, 'Verification sent', `${sentTo} · valid ${this.otpMinutes} min`)] };
    this.replace(next);
    this.audit.record('Verify Guardian', this.label(next), {
      details: `Verification code sent (${sentTo}), valid ${this.otpMinutes} minutes`,
      changes: [{ field: 'Verification', oldValue: g.verification, newValue: 'Pending' }],
    });
    return next;
  }

  /**
   * Checks the code. Returns the outcome instead of throwing for wrong / expired codes, so the dialog
   * can show the message; three wrong codes Reject the guardian (they can be re-sent a new one).
   */
  verify(id: string, code: string): VerifyResult {
    const g = this.require(id);
    if (g.verification === 'Verified') return { ok: true, status: 'Verified', message: 'Already verified.' };
    if (g.verification !== 'Pending' || !g.otp) throw new Error('No verification is pending. Send a code first.');
    if (this.effectiveAccess(g).state === 'Revoked') throw new Error('Access is revoked, so this guardian cannot be verified.');
    const now = nowIso();
    if (parseIso(g.otp.expiresAt) <= Date.now()) {
      return { ok: false, status: 'Pending', message: 'This code has expired. Send a new verification code.' };
    }
    const entered = (code ?? '').trim();
    if (!/^\d{6}$/.test(entered)) return { ok: false, status: 'Pending', message: 'Enter the 6-digit code.', attemptsLeft: MAX_OTP_ATTEMPTS - g.otp.attempts };
    if (entered === g.otp.code) {
      this.replace({ ...g, verification: 'Verified', verifiedAt: now, otp: undefined, updatedAt: now, history: [...g.history, ev(now, this.userName, 'Verified with code')] });
      this.audit.record('Verify Guardian', this.label(g), { changes: [{ field: 'Verification', oldValue: 'Pending', newValue: 'Verified' }] });
      return { ok: true, status: 'Verified', message: 'Guardian verified.' };
    }
    const attempts = g.otp.attempts + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      this.replace({ ...g, verification: 'Rejected', otp: undefined, updatedAt: now, history: [...g.history, ev(now, 'System', `Rejected after ${MAX_OTP_ATTEMPTS} wrong codes`)] });
      this.audit.record('Verify Guardian', this.label(g), {
        status: 'Failed',
        details: `Rejected after ${MAX_OTP_ATTEMPTS} wrong codes`,
        changes: [{ field: 'Verification', oldValue: 'Pending', newValue: 'Rejected' }],
      });
      return { ok: false, status: 'Rejected', message: 'Too many wrong codes. The guardian is Rejected; send a new code to try again.', attemptsLeft: 0 };
    }
    this.replace({ ...g, otp: { ...g.otp, attempts }, history: [...g.history, ev(now, this.userName, 'Wrong code entered', `Attempt ${attempts} of ${MAX_OTP_ATTEMPTS}`)] });
    const left = MAX_OTP_ATTEMPTS - attempts;
    return { ok: false, status: 'Pending', message: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, attemptsLeft: left };
  }

  /** Owner revokes access by hand. A reason is required and recorded. */
  revoke(id: string, reason: string): Guardian {
    const g = this.require(id);
    const why = this.cleanReason(reason, 'revoke');
    const access = this.effectiveAccess(g);
    if (access.state === 'Revoked') throw new Error(access.reason + '.');
    const now = nowIso();
    const next: Guardian = { ...g, manualRevoke: { reason: why, at: now, by: this.userName }, updatedAt: now, history: [...g.history, ev(now, this.userName, 'Access revoked', why)] };
    this.replace(next);
    this.audit.record('Revoke Guardian', this.label(g), { details: `Reason: ${why}`, changes: [{ field: 'Access', oldValue: 'Active', newValue: 'Revoked' }] });
    return next;
  }

  /** Lifts a manual revoke. Access that the resident record revokes cannot be restored here. */
  restore(id: string, reason: string): Guardian {
    const g = this.require(id);
    const why = this.cleanReason(reason, 'restore');
    if (!g.manualRevoke) {
      const access = this.effectiveAccess(g);
      throw new Error(access.state === 'Revoked' ? `${access.reason}. It follows the resident record and cannot be restored here.` : 'Access is not revoked.');
    }
    const now = nowIso();
    const next: Guardian = { ...g, manualRevoke: undefined, updatedAt: now, history: [...g.history, ev(now, this.userName, 'Access restored', why)] };
    this.replace(next);
    this.audit.record('Revoke Guardian', this.label(g), { details: `Access restored. Reason: ${why}`, changes: [{ field: 'Access', oldValue: 'Revoked', newValue: 'Active' }] });
    return next;
  }

  toInput(g: Guardian): GuardianInput {
    return { residentId: g.residentId, name: g.name, relationship: g.relationship, mobile: g.mobile, email: g.email, primary: g.primary, consent: g.consent, consentDate: g.consentDate, scope: [...g.scope] };
  }

  // ---------------------------------------------------------------------------

  private cleanReason(reason: string, verb: string): string {
    const why = reason?.trim() ?? '';
    if (!why) throw new Error(`A reason is required to ${verb} access.`);
    if (why.length > REASON_MAX) throw new Error(`Reason must be ${REASON_MAX} characters or fewer.`);
    return why;
  }

  private demote(x: Guardian, at: string, newPrimaryId: string): Guardian {
    return { ...x, primary: false, updatedAt: at, history: [...x.history, ev(at, this.userName, 'Primary contact moved', `Now ${newPrimaryId}`)] };
  }

  private cleanScope(scope: GuardianInput['scope']): GuardianInput['scope'] {
    return ACCESS_SCOPES.filter((s) => scope.includes(s));
  }

  private auditView(g: Guardian): Record<string, unknown> {
    return { ...g, scope: g.scope.join(', ') };
  }

  private label(g: Guardian): string {
    return `${g.id} – ${g.name}`;
  }

  private residentLabel(id: string): string {
    return `${this.residentName(id)} (${id})`;
  }

  private replace(next: Guardian): Guardian {
    this.commit(this.guardians.map((g) => (g.id === next.id ? next : g)));
    return next;
  }

  private require(id: string): Guardian {
    const g = this.byId(id);
    if (!g) throw new Error('Guardian not found.');
    return g;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.guardians.reduce((m, g) => Math.max(m, Number(g.id.slice(3)) || 0), 0);
    return `GDN${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Guardian[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): Guardian[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Guardian[];
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
