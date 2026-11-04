import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  ApprovalLimits,
  DEFAULT_EXPORT_CONTROLS,
  DEFAULT_LIMITS,
  ExportControls,
  ExportLogEntry,
  LIMIT_LABELS,
  MAINTENANCE_BLOCKED,
  MODULE_LABELS,
  OUTPASS_APPROVERS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  PermissionAction,
  PermissionMatrix,
  PermissionModule,
  PermissionRole,
  ROLE_TEMPLATES,
  RoleTemplate,
} from '../models/permissions.models';
import { AuditChange, diffForAudit } from '../models/audit.models';
import { localDateIso } from '../../shared/utils/local-date';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { SystemSettingsService } from './system-settings.service';

const STORAGE_KEY = 'onehostel_permissions_v1';
const MAX_EXPORT_LOG = 200;

export interface PermissionState {
  matrix: PermissionMatrix;
  limits: ApprovalLimits;
  exportControls: ExportControls;
  exportLog: ExportLogEntry[];
}

/** v view, c create, e edit, a approve, x export. */
const FLAGS: Record<string, PermissionAction> = { v: 'view', c: 'create', e: 'edit', a: 'approve', x: 'export' };

const access = (flags: string) => {
  const on = new Set([...flags].map((f) => FLAGS[f]));
  return Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, on.has(a)])) as Record<PermissionAction, boolean>;
};

const build = (spec: Partial<Record<PermissionModule, string>>) =>
  Object.fromEntries(PERMISSION_MODULES.map((m) => [m, access(spec[m] ?? '')])) as PermissionMatrix[RoleTemplate];

/** Sensible starting point; the Owner can change it (except the Maintenance limits). */
export function defaultMatrix(): PermissionMatrix {
  return {
    Warden: build({
      residents: 'vcex', rooms: 'vce', fees: 'v', complaints: 'vceax', announcements: 'vce', reports: 'vx', laundry: 'vce',
      visitors: 'vcea', mess: 'vce', leave: 'vcea', attendance: 'vcea', parcels: 'vce', staff: 'v', guardians: 'vce',
      disciplinary: 'v', analytics: 'v',
    }),
    Accountant: build({ residents: 'v', rooms: 'v', fees: 'vcex', reports: 'vx', analytics: 'v' }),
    Security: build({ residents: 'v', leave: 'v', visitors: 'vcea', attendance: 'vce', parcels: 'vce' }),
    Maintenance: build({ rooms: 'v', complaints: 'vce' }),
    'Mess Manager': build({ residents: 'v', announcements: 'v', reports: 'v', mess: 'vcex' }),
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Role templates x modules x actions, approval limits and export controls for the hostel.
 * Every save is audited with old/new values. UI-only build: persisted to localStorage;
 * real enforcement must live on the server.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly audit = inject(AuditLogService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SystemSettingsService);

  private readonly subject = new BehaviorSubject<PermissionState>(this.load());
  readonly state$: Observable<PermissionState> = this.subject.asObservable();

  get matrix(): PermissionMatrix { return this.subject.value.matrix; }
  get limits(): ApprovalLimits { return this.subject.value.limits; }
  get exportControls(): ExportControls { return this.subject.value.exportControls; }
  get exportLog(): ExportLogEntry[] { return this.subject.value.exportLog; }

  /** Read-only session policy from System Defaults. */
  get security() { return this.settings.settings.security; }

  // ---- Checks ---------------------------------------------------------------------

  /** Whether `role` may perform `action` on `module`. Owner: always; unknown role / None: never. */
  can(role: PermissionRole | 'None' | string | null | undefined, module: PermissionModule, action: PermissionAction): boolean {
    if (role === 'Owner') return true;
    if (!role || !(ROLE_TEMPLATES as readonly string[]).includes(role)) return false;
    const r = role as RoleTemplate;
    if (r === 'Maintenance' && MAINTENANCE_BLOCKED.includes(module)) return false; // never financial / disciplinary
    if (!this.matrix[r]?.[module]?.[action]) return false;
    return action !== 'export' || this.exportControls[r];
  }

  /** Same check for a staff member: inactive staff have no access; Maintenance staff never get finance. */
  staffCan(staff: { roleTemplate: string; category: string; status: string }, module: PermissionModule, action: PermissionAction): boolean {
    if (staff.status === 'Inactive') return false;
    if (staff.category === 'Maintenance' && module === 'fees') return false;
    return this.can(staff.roleTemplate, module, action);
  }

  // ---- Matrix ---------------------------------------------------------------------

  /** Why this cell cannot be granted ('' = allowed). */
  blocker(role: RoleTemplate, module: PermissionModule): string {
    return role === 'Maintenance' && MAINTENANCE_BLOCKED.includes(module)
      ? `Maintenance can never be given access to ${MODULE_LABELS[module]}.`
      : '';
  }

  /** Saves a whole edited matrix. Rejects (throws) when Maintenance is granted fees / disciplinary. */
  saveMatrix(next: PermissionMatrix): AuditChange[] {
    for (const m of MAINTENANCE_BLOCKED) {
      if (PERMISSION_ACTIONS.some((a) => next.Maintenance?.[m]?.[a])) throw new Error(this.blocker('Maintenance', m));
    }
    const changes = this.matrixChanges(this.matrix, next);
    if (!changes.length) return [];
    this.commit({ ...this.subject.value, matrix: clone(next) });
    this.audit.record('Update Permissions', 'Role permission matrix', { changes });
    return changes;
  }

  /** Restores the default matrix, limits and export controls. */
  resetToDefaults(): AuditChange[] {
    const cur = this.subject.value;
    const changes = [
      ...this.matrixChanges(cur.matrix, defaultMatrix()),
      ...this.limitChanges(cur.limits, DEFAULT_LIMITS),
      ...this.exportChanges(cur.exportControls, DEFAULT_EXPORT_CONTROLS),
    ];
    this.commit({ ...cur, matrix: defaultMatrix(), limits: { ...DEFAULT_LIMITS }, exportControls: { ...DEFAULT_EXPORT_CONTROLS } });
    if (changes.length) this.audit.record('Update Permissions', 'Reset to defaults', { changes });
    return changes;
  }

  // ---- Approval limits ------------------------------------------------------------

  /** Field errors for approval limits (non-negative whole numbers). */
  validateLimits(l: ApprovalLimits): Partial<Record<keyof ApprovalLimits, string>> {
    const errors: Partial<Record<keyof ApprovalLimits, string>> = {};
    for (const k of ['refundMax', 'feeAdjustmentMax'] as const) {
      const v = l[k] as unknown;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) errors[k] = 'Enter a whole number, zero or more.';
      else if (v > 10_000_000) errors[k] = 'That limit is too high.';
    }
    if (!(OUTPASS_APPROVERS as readonly string[]).includes(l.outpassApprover)) errors.outpassApprover = 'Choose Owner or Warden.';
    if (typeof l.attendanceCorrectionNeedsApproval !== 'boolean') errors.attendanceCorrectionNeedsApproval = 'Invalid value.';
    return errors;
  }

  saveLimits(next: ApprovalLimits): AuditChange[] {
    const errors = this.validateLimits(next);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const changes = this.limitChanges(this.limits, next);
    if (!changes.length) return [];
    this.commit({ ...this.subject.value, limits: { ...next } });
    this.audit.record('Update Permissions', 'Approval limits', { changes });
    return changes;
  }

  // ---- Export controls ------------------------------------------------------------

  saveExportControls(next: ExportControls): AuditChange[] {
    const changes = this.exportChanges(this.exportControls, next);
    if (!changes.length) return [];
    this.commit({ ...this.subject.value, exportControls: { ...next } });
    this.audit.record('Update Permissions', 'Export controls', { changes });
    return changes;
  }

  /** Records an export (Reports etc.) in the audit trail and the export log. */
  recordExport(what: string): ExportLogEntry {
    const cur = this.subject.value;
    const user = this.auth.currentUser?.name || 'Hostel Owner';
    const entry: ExportLogEntry = { id: this.nextExportId(), at: this.nowIso(), by: user, what: what.trim() || 'Data export' };
    this.commit({ ...cur, exportLog: [entry, ...cur.exportLog].slice(0, MAX_EXPORT_LOG) });
    this.audit.record('Export Data', entry.what, { details: `Exported by ${user}` });
    return entry;
  }

  // ---------------------------------------------------------------------------

  private matrixChanges(a: PermissionMatrix, b: PermissionMatrix): AuditChange[] {
    const out: AuditChange[] = [];
    for (const r of ROLE_TEMPLATES) {
      for (const m of PERMISSION_MODULES) {
        const labels = Object.fromEntries(PERMISSION_ACTIONS.map((x) => [x, `${r} · ${MODULE_LABELS[m]} · ${x}`]));
        out.push(...diffForAudit(a[r][m], b[r][m], labels));
      }
    }
    return out;
  }

  private limitChanges(a: ApprovalLimits, b: ApprovalLimits): AuditChange[] {
    return diffForAudit({ ...a }, { ...b }, LIMIT_LABELS);
  }

  private exportChanges(a: ExportControls, b: ExportControls): AuditChange[] {
    return diffForAudit({ ...a }, { ...b }, Object.fromEntries(ROLE_TEMPLATES.map((r) => [r, `${r} · export allowed`])));
  }

  private nowIso(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${localDateIso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private nextExportId(): string {
    const max = this.exportLog.reduce((m, e) => Math.max(m, Number(e.id.slice(3)) || 0), 0);
    return `EXP${String(max + 1).padStart(5, '0')}`;
  }

  private commit(next: PermissionState): void {
    this.subject.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): PermissionState {
    const fresh: PermissionState = { matrix: defaultMatrix(), limits: { ...DEFAULT_LIMITS }, exportControls: { ...DEFAULT_EXPORT_CONTROLS }, exportLog: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<PermissionState>;
        if (s.matrix && s.limits && s.exportControls && Array.isArray(s.exportLog)) {
          // Maintenance can never hold fees / disciplinary, whatever was stored.
          const matrix = s.matrix;
          for (const m of MAINTENANCE_BLOCKED) matrix.Maintenance[m] = access('');
          return { matrix, limits: { ...DEFAULT_LIMITS, ...s.limits }, exportControls: { ...DEFAULT_EXPORT_CONTROLS, ...s.exportControls }, exportLog: s.exportLog };
        }
      }
    } catch {
      // Fall through to the defaults.
    }
    return fresh;
  }
}
