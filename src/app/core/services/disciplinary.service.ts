import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuditChange } from '../models/audit.models';
import {
  ACCESS_CLASSIFICATIONS,
  ACTION_MAX,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  EVIDENCE_MAX_COUNT,
  FIELD_LABELS,
  INCIDENT_CATEGORIES,
  INCIDENT_DATETIME,
  Incident,
  IncidentEvent,
  IncidentEventType,
  IncidentInput,
  IncidentPatch,
  LONG_TEXT_FIELDS,
  NOTE_MIN,
  REVIEW_STATUSES,
  ReviewStatus,
  evidenceErrors,
  localMinute,
} from '../models/disciplinary.models';
import { residentFullName } from '../models/residents.models';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { ResidentsService } from './residents.service';
import { localDateIso } from '../../shared/utils/local-date';

// Audit: every mutation and every detail view writes an entry. The entity is only the incident ID, and
// long text (description, action, closing note) is never copied into the audit trail, so the general
// audit list does not leak incident content. The incident's own timeline keeps the per-change history.

const STORAGE_KEY = 'onehostel_disciplinary_v1';

const DAY = 86_400_000;

type Validated = IncidentInput & { evidence: NonNullable<IncidentInput['evidence']> };

/** Local wall-clock yyyy-mm-ddTHH:mm:ss, `msAgo` before now. */
const stamp = (msAgo = 0): string => {
  const d = new Date(Date.now() - msAgo);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDateIso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const ev = (at: string, by: string, type: IncidentEventType, text: string, changes?: AuditChange[]): IncidentEvent => ({
  at,
  by,
  type,
  text,
  ...(changes?.length ? { changes } : {}),
});

type SeedRow = Omit<Incident, 'reportedBy' | 'createdAt' | 'updatedAt' | 'occurredAt'> & { daysAgo: number };

function seed(): Incident[] {
  const owner = 'Hostel Owner';
  const mk = (x: SeedRow): Incident => {
    const { daysAgo, ...rest } = x;
    return {
      ...rest,
      occurredAt: localMinute(new Date(Date.now() - daysAgo * DAY - 3_600_000)),
      reportedBy: owner,
      createdAt: stamp(daysAgo * DAY),
      updatedAt: stamp(Math.max(0, daysAgo - 1) * DAY),
    };
  };
  return [
    mk({
      id: 'INC000003', residentId: 'RES000006', residentName: 'Sagar Gupta', daysAgo: 2,
      category: 'Curfew Violation', classification: 'Restricted',
      description: 'Resident returned to the hostel at 01:30 without prior intimation; the gate register was signed by security.',
      evidence: [{ name: 'gate-register.pdf', size: 184_320, type: 'application/pdf' }], status: 'Reported',
      history: [ev(stamp(2 * DAY), owner, 'created', 'Incident recorded as Restricted.')],
    }),
    mk({
      id: 'INC000002', residentId: 'RES000002', residentName: 'Aman Verma', daysAgo: 9,
      category: 'Noise/Misconduct', classification: 'Restricted',
      description: 'Loud music played in the common room after quiet hours despite two verbal warnings from the warden.',
      evidence: [], status: 'Under Review',
      history: [ev(stamp(9 * DAY), owner, 'created', 'Incident recorded as Restricted.'), ev(stamp(8 * DAY), owner, 'status', 'Moved from Reported to Under Review.')],
    }),
    mk({
      id: 'INC000001', residentId: 'RES000011', residentName: 'Deepak Joshi', daysAgo: 30,
      category: 'Property Damage', classification: 'Confidential',
      description: 'Damaged the window latch and a study table in the room during an argument; maintenance confirmed the damage.',
      evidence: [{ name: 'damage-photo.jpg', size: 1_240_000, type: 'image/jpeg' }],
      actionTaken: 'Damage cost of the table and latch added to the resident account; written warning issued.',
      closingNote: 'Cost recovered and warning acknowledged by the resident.', status: 'Closed',
      history: [
        ev(stamp(30 * DAY), owner, 'created', 'Incident recorded as Confidential.'),
        ev(stamp(29 * DAY), owner, 'status', 'Moved from Reported to Under Review.'),
        ev(stamp(27 * DAY), owner, 'status', 'Moved from Under Review to Action Recorded.'),
        ev(stamp(24 * DAY), owner, 'status', 'Moved from Action Recorded to Closed.'),
      ],
    }),
  ];
}

@Injectable({ providedIn: 'root' })
export class DisciplinaryService {
  private readonly auth = inject(AuthService);
  private readonly auditLog = inject(AuditLogService);
  private readonly residentsService = inject(ResidentsService);

  private readonly subject = new BehaviorSubject<Incident[]>(this.load());
  readonly incidents$: Observable<Incident[]> = this.subject.asObservable();

  get incidents(): Incident[] {
    return this.subject.value;
  }

  byId(id: string): Incident | undefined {
    return this.incidents.find((i) => i.id === id);
  }

  /** Only the Hostel Owner may read or change incidents. */
  get canAccess(): boolean {
    return this.auth.isHostelOwner;
  }

  /** Residents an incident can be recorded against (not deactivated; checked-out residents stay selectable). */
  get selectableResidents(): { id: string; name: string }[] {
    return this.residentsService.residents.filter((r) => !r.deactivatedAt).map((r) => ({ id: r.residentId, name: residentFullName(r) }));
  }

  residentName(i: Incident): string {
    const r = this.residentsService.byId(i.residentId);
    return r ? residentFullName(r) : i.residentName;
  }

  /** Next status in the workflow, or undefined once closed. */
  nextStatus(s: ReviewStatus): ReviewStatus | undefined {
    return REVIEW_STATUSES[REVIEW_STATUSES.indexOf(s) + 1];
  }

  // ---- Mutations ------------------------------------------------------------------

  create(input: IncidentInput): Incident {
    this.assertAccess();
    const clean = this.validate({ ...input, evidence: input.evidence ?? [] });
    const resident = this.residentsService.byId(clean.residentId)!;
    const now = stamp();
    const incident: Incident = {
      id: this.nextId(),
      residentId: clean.residentId,
      residentName: residentFullName(resident),
      occurredAt: clean.occurredAt,
      category: clean.category,
      description: clean.description,
      reportedBy: this.userName,
      evidence: clean.evidence,
      actionTaken: clean.actionTaken || undefined,
      status: 'Reported',
      classification: clean.classification,
      createdAt: now,
      updatedAt: now,
      history: [ev(now, this.userName, 'created', `Incident recorded as ${clean.classification}.`)],
    };
    this.commit([incident, ...this.incidents]);
    this.auditLog.record('Create Incident', incident.id, {
      details: `Incident recorded (${clean.classification}).`,
      changes: [{ field: 'Review status', oldValue: '—', newValue: 'Reported' }],
    });
    return incident;
  }

  /** Edits an open incident. Closed incidents can only be changed through correct(). */
  update(id: string, patch: IncidentPatch): Incident {
    this.assertAccess();
    const current = this.require(id);
    if (current.status === 'Closed') throw new Error('Closed incidents are read-only. Use an authorized correction instead.');
    if ('closingNote' in patch) throw new Error('The closing note is set when the incident is closed.');
    return this.apply(current, patch, 'edited', 'Details edited.');
  }

  /** Moves the incident one step forward. `note` is the action taken (to Action Recorded) or the closing note (to Closed). */
  advance(id: string, status: ReviewStatus, note = ''): Incident {
    this.assertAccess();
    const current = this.require(id);
    const next = this.nextStatus(current.status);
    if (!REVIEW_STATUSES.includes(status)) throw new Error('Unknown review status.');
    if (!next) throw new Error('This incident is already closed.');
    if (status !== next) {
      const back = REVIEW_STATUSES.indexOf(status) <= REVIEW_STATUSES.indexOf(current.status);
      throw new Error(back ? `Status cannot move back from ${current.status} to ${status}.` : `Move to ${next} first; steps cannot be skipped.`);
    }

    const text = note.trim();
    const moved: Incident = { ...current, status };
    if (status === 'Action Recorded') {
      const action = text || current.actionTaken?.trim() || '';
      if (!action) throw new Error('Record the action taken before moving to Action Recorded.');
      if (action.length > ACTION_MAX) throw new Error(`Action taken can be at most ${ACTION_MAX} characters.`);
      moved.actionTaken = action;
    }
    if (status === 'Closed') {
      if (text.length < NOTE_MIN) throw new Error(`A closing note of at least ${NOTE_MIN} characters is required.`);
      if (text.length > ACTION_MAX) throw new Error(`The closing note can be at most ${ACTION_MAX} characters.`);
      moved.closingNote = text;
    }

    const now = stamp();
    const changes: AuditChange[] = [{ field: 'Review status', oldValue: current.status, newValue: status }];
    if (moved.actionTaken !== current.actionTaken) {
      changes.push({ field: FIELD_LABELS['actionTaken'], oldValue: this.show('actionTaken', current.actionTaken), newValue: this.show('actionTaken', moved.actionTaken) });
    }
    if (moved.closingNote !== current.closingNote) {
      changes.push({ field: FIELD_LABELS['closingNote'], oldValue: '—', newValue: this.show('closingNote', moved.closingNote) });
    }
    this.replace({
      ...moved,
      updatedAt: now,
      history: [...current.history, ev(now, this.userName, 'status', `Moved from ${current.status} to ${status}.`, changes)],
    });
    this.auditLog.record('Update Incident', id, { details: `Review status ${current.status} to ${status}.`, changes });
    return this.require(id);
  }

  /** Authorized correction of a closed incident; the reason is mandatory and the before/after is audited. */
  correct(id: string, patch: IncidentPatch, reason: string): Incident {
    this.assertAccess();
    const current = this.require(id);
    if (current.status !== 'Closed') throw new Error('Only closed incidents need an authorized correction; edit this one directly.');
    const why = reason.trim();
    if (why.length < NOTE_MIN) throw new Error(`A correction reason of at least ${NOTE_MIN} characters is required.`);
    return this.apply(current, patch, 'corrected', `Authorized correction. Reason: ${why}`, why);
  }

  /** Records that the detail view was opened (call once per open). */
  recordView(id: string): void {
    if (!this.canAccess) return;
    const current = this.byId(id);
    if (!current) return;
    const now = stamp();
    this.replace({ ...current, history: [...current.history, ev(now, this.userName, 'viewed', 'Opened the incident details.')] });
    this.auditLog.record('View Incident', id, { details: 'Incident details opened.' });
  }

  // ---- Internals ------------------------------------------------------------------

  private apply(current: Incident, patch: IncidentPatch, type: IncidentEventType, text: string, reason?: string): Incident {
    const merged = this.validate({ ...current, ...patch, evidence: patch.evidence ?? current.evidence });
    const closingNote = 'closingNote' in patch ? patch.closingNote?.trim() || current.closingNote : current.closingNote;
    if (closingNote !== undefined && closingNote.length < NOTE_MIN) throw new Error(`The closing note needs at least ${NOTE_MIN} characters.`);
    const next: Incident = {
      ...current,
      residentId: merged.residentId,
      occurredAt: merged.occurredAt,
      category: merged.category,
      description: merged.description,
      classification: merged.classification,
      evidence: merged.evidence,
      actionTaken: merged.actionTaken || undefined,
      closingNote,
    };
    if (next.residentId !== current.residentId) next.residentName = residentFullName(this.residentsService.byId(next.residentId)!);

    const changes = this.diff(current, next);
    if (!changes.length) throw new Error('Nothing changed.');
    const now = stamp();
    this.replace({ ...next, updatedAt: now, history: [...current.history, ev(now, this.userName, type, text, changes)] });
    this.auditLog.record('Update Incident', current.id, {
      details: reason ? `Authorized correction on a closed incident. Reason: ${reason}` : 'Incident details edited.',
      changes,
    });
    return this.require(current.id);
  }

  /** Before/after for the audit entry and timeline; long text shows only that it changed. */
  private diff(a: Incident, b: Incident): AuditChange[] {
    const keys = ['residentId', 'occurredAt', 'category', 'classification', 'description', 'actionTaken', 'closingNote', 'evidence'] as const;
    const out: AuditChange[] = [];
    for (const k of keys) {
      if (this.raw(a[k]) !== this.raw(b[k])) out.push({ field: FIELD_LABELS[k], oldValue: this.show(k, a[k]), newValue: this.show(k, b[k]) });
    }
    return out;
  }

  private raw(v: unknown): string {
    if (Array.isArray(v)) return v.map((f: { name: string; size: number }) => `${f.name}:${f.size}`).join('|');
    return String(v ?? '').trim();
  }

  private show(field: string, v: unknown): string {
    if (field === 'evidence') return Array.isArray(v) && v.length ? v.map((f: { name: string }) => f.name).join(', ') : '—';
    const text = String(v ?? '').trim();
    if (!text) return '—';
    return LONG_TEXT_FIELDS.has(field) ? `text (${text.length} chars)` : text;
  }

  /** Throws a readable message for the first problem; returns trimmed values. */
  private validate(i: Validated): Validated {
    if (!i.residentId || !this.residentsService.byId(i.residentId)) throw new Error('Select the resident involved.');
    if (!INCIDENT_DATETIME.test(i.occurredAt ?? '') || Number.isNaN(new Date(i.occurredAt).getTime())) throw new Error('Enter the incident date and time.');
    if (i.occurredAt > localMinute()) throw new Error('The incident date and time cannot be in the future.');
    if (!INCIDENT_CATEGORIES.includes(i.category)) throw new Error('Select an incident category.');
    if (!ACCESS_CLASSIFICATIONS.includes(i.classification)) throw new Error('Select the access classification.');
    const description = (i.description ?? '').trim();
    if (!description) throw new Error('Describe the incident factually.');
    if (description.length < DESCRIPTION_MIN) throw new Error(`The description needs at least ${DESCRIPTION_MIN} characters (${description.length} entered).`);
    if (description.length > DESCRIPTION_MAX) throw new Error(`The description can be at most ${DESCRIPTION_MAX} characters.`);
    const action = (i.actionTaken ?? '').trim();
    if (action.length > ACTION_MAX) throw new Error(`Action taken can be at most ${ACTION_MAX} characters.`);
    const evidence = i.evidence.map((f) => ({ name: f.name, size: f.size, type: f.type }));
    if (evidence.length > EVIDENCE_MAX_COUNT) throw new Error(`At most ${EVIDENCE_MAX_COUNT} evidence files are allowed.`);
    const problems = evidenceErrors(evidence);
    if (problems.length) throw new Error(problems[0]);
    return { ...i, description, actionTaken: action, evidence };
  }

  private assertAccess(): void {
    if (!this.canAccess) throw new Error('Disciplinary records are restricted to the Hostel Owner.');
  }

  private require(id: string): Incident {
    const i = this.byId(id);
    if (!i) throw new Error('Incident not found.');
    return i;
  }

  private replace(next: Incident): void {
    this.commit(this.incidents.map((i) => (i.id === next.id ? next : i)));
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private nextId(): string {
    const max = this.incidents.reduce((m, i) => Math.max(m, Number(i.id.slice(3)) || 0), 0);
    return `INC${String(max + 1).padStart(6, '0')}`;
  }

  private commit(list: Incident[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): Incident[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Incident[];
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
