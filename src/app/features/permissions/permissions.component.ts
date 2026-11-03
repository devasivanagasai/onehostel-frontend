import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { AuditLog, AuditModule, auditAction, auditEventLabel, auditModule } from '../../core/models/audit.models';
import {
  ApprovalLimits,
  ExportControls,
  MAINTENANCE_BLOCKED,
  MODULE_LABELS,
  OUTPASS_APPROVERS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  PermissionAction,
  PermissionMatrix,
  PermissionModule,
  ROLE_TEMPLATES,
  RoleTemplate,
} from '../../core/models/permissions.models';

type PermTab = 'matrix' | 'limits' | 'export' | 'session' | 'audit';

/** Modules whose entries belong in the hostel's audit history ("Auth" only for the signed-in user). */
const HISTORY_MODULES: AuditModule[] = ['Tenant', 'Fees & Payments', 'Complaints', 'Hostel', 'Staff', 'Guardian', 'Academic Year', 'Disciplinary', 'Permissions', 'Auth'];

interface LimitsDraft {
  refundMax: string;
  feeAdjustmentMax: string;
  attendanceCorrectionNeedsApproval: boolean;
  outpassApprover: string;
}

interface AuditFilters {
  search: string;
  module: string;
  status: string;
  from: string;
  to: string;
}

const DEFAULT_AUDIT_FILTERS: AuditFilters = { search: '', module: 'All', status: 'All', from: '', to: '' };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, MatSnackBarModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './permissions.component.html',
  styleUrl: './permissions.component.scss',
})
export class PermissionsComponent {
  readonly service = inject(PermissionsService);
  readonly fmt = inject(AppFormatService);
  private readonly audit = inject(AuditLogService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly tabs: { id: PermTab; label: string; icon: string }[] = [
    { id: 'matrix', label: 'Role Permissions', icon: 'admin_panel_settings' },
    { id: 'limits', label: 'Approval Limits', icon: 'rule' },
    { id: 'export', label: 'Export Controls', icon: 'ios_share' },
    { id: 'session', label: 'Session Security', icon: 'lock_clock' },
    { id: 'audit', label: 'Audit History', icon: 'history' },
  ];
  readonly roles: RoleTemplate[] = [...ROLE_TEMPLATES];
  readonly modules: PermissionModule[] = [...PERMISSION_MODULES];
  readonly actions: PermissionAction[] = [...PERMISSION_ACTIONS];
  readonly moduleLabels = MODULE_LABELS;
  readonly approvers = OUTPASS_APPROVERS;
  readonly historyModules = HISTORY_MODULES;

  tab: PermTab = 'matrix';

  // ---- Drafts (edited locally, written on Save) ----
  role: RoleTemplate = 'Warden';
  draftMatrix: PermissionMatrix = clone(this.service.matrix);
  draftLimits: LimitsDraft = this.limitsToDraft(this.service.limits);
  draftExport: ExportControls = { ...this.service.exportControls };
  limitsSubmitted = false;

  // ---- Audit history ----
  auditFilters: AuditFilters = { ...DEFAULT_AUDIT_FILTERS };
  auditPageSize = 10;
  auditPage = 0;
  expanded = new Set<string>();

  // ---- Matrix --------------------------------------------------------------------

  get matrixDirty(): boolean {
    return JSON.stringify(this.draftMatrix) !== JSON.stringify(this.service.matrix);
  }

  blocker(module: PermissionModule): string {
    return this.service.blocker(this.role, module);
  }

  isBlocked(module: PermissionModule): boolean {
    return MAINTENANCE_BLOCKED.includes(module) && this.role === 'Maintenance';
  }

  toggle(module: PermissionModule, action: PermissionAction, checked: boolean): void {
    if (this.isBlocked(module)) {
      this.snackBar.open(this.blocker(module), 'Close', { duration: 4000 });
      return;
    }
    const cell = this.draftMatrix[this.role][module];
    cell[action] = checked;
    // Anything beyond viewing needs view access.
    if (checked && action !== 'view') cell.view = true;
    if (!checked && action === 'view') for (const a of this.actions) cell[a] = false;
  }

  /** Number of modules the role can reach at all (for the role chips). */
  reach(role: RoleTemplate): number {
    return this.modules.filter((m) => this.draftMatrix[role][m].view).length;
  }

  discardMatrix(): void {
    this.draftMatrix = clone(this.service.matrix);
  }

  saveMatrix(): void {
    try {
      const changes = this.service.saveMatrix(this.draftMatrix);
      this.snackBar.open(changes.length ? `Permissions saved (${changes.length} change${changes.length === 1 ? '' : 's'}).` : 'No changes to save.', 'Close', { duration: 3500 });
      this.draftMatrix = clone(this.service.matrix);
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not save permissions.', 'Close', { duration: 5000 });
    }
  }

  resetDefaults(): void {
    this.confirm
      .confirm({
        title: 'Reset to defaults?',
        message: 'Role permissions, approval limits and export controls go back to the standard settings.',
        confirmLabel: 'Reset',
        tone: 'warning',
        icon: 'restart_alt',
        note: 'The reset is recorded in the audit history.',
      })
      .subscribe((ok) => {
        if (!ok) return;
        const changes = this.service.resetToDefaults();
        this.syncDrafts();
        this.snackBar.open(changes.length ? 'Defaults restored.' : 'Already using the defaults.', 'Close', { duration: 3500 });
      });
  }

  // ---- Approval limits -----------------------------------------------------------

  private limitsToDraft(l: ApprovalLimits): LimitsDraft {
    return { refundMax: String(l.refundMax), feeAdjustmentMax: String(l.feeAdjustmentMax), attendanceCorrectionNeedsApproval: l.attendanceCorrectionNeedsApproval, outpassApprover: l.outpassApprover };
  }

  private parsedLimits(): ApprovalLimits {
    const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
    const d = this.draftLimits;
    return {
      refundMax: num(d.refundMax),
      feeAdjustmentMax: num(d.feeAdjustmentMax),
      attendanceCorrectionNeedsApproval: d.attendanceCorrectionNeedsApproval,
      outpassApprover: d.outpassApprover as ApprovalLimits['outpassApprover'],
    };
  }

  get limitErrors(): Partial<Record<keyof ApprovalLimits, string>> {
    return this.limitsSubmitted ? this.service.validateLimits(this.parsedLimits()) : {};
  }

  get limitsDirty(): boolean {
    return JSON.stringify(this.draftLimits) !== JSON.stringify(this.limitsToDraft(this.service.limits));
  }

  discardLimits(): void {
    this.draftLimits = this.limitsToDraft(this.service.limits);
    this.limitsSubmitted = false;
  }

  saveLimits(): void {
    this.limitsSubmitted = true;
    if (Object.keys(this.limitErrors).length) return;
    try {
      const changes = this.service.saveLimits(this.parsedLimits());
      this.snackBar.open(changes.length ? 'Approval limits saved.' : 'No changes to save.', 'Close', { duration: 3500 });
      this.limitsSubmitted = false;
      this.draftLimits = this.limitsToDraft(this.service.limits);
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not save the limits.', 'Close', { duration: 5000 });
    }
  }

  // ---- Export controls -----------------------------------------------------------

  get exportDirty(): boolean {
    return JSON.stringify(this.draftExport) !== JSON.stringify(this.service.exportControls);
  }

  discardExport(): void {
    this.draftExport = { ...this.service.exportControls };
  }

  saveExport(): void {
    try {
      const changes = this.service.saveExportControls(this.draftExport);
      this.snackBar.open(changes.length ? 'Export controls saved.' : 'No changes to save.', 'Close', { duration: 3500 });
      this.draftExport = { ...this.service.exportControls };
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not save export controls.', 'Close', { duration: 5000 });
    }
  }

  get recentExports() {
    return this.service.exportLog.slice(0, 10);
  }

  private syncDrafts(): void {
    this.draftMatrix = clone(this.service.matrix);
    this.draftLimits = this.limitsToDraft(this.service.limits);
    this.draftExport = { ...this.service.exportControls };
    this.limitsSubmitted = false;
  }

  // ---- Audit history (read-only) -------------------------------------------------

  private get userName(): string {
    return this.auth.currentUser?.name ?? '';
  }

  /** Hostel-relevant, append-only entries; sign-in/out only for the person looking at the page. */
  get history(): AuditLog[] {
    return this.audit.logs.filter((l) => {
      const m = auditModule(l);
      if (!HISTORY_MODULES.includes(m)) return false;
      return m !== 'Auth' || l.user === this.userName;
    });
  }

  get filteredHistory(): AuditLog[] {
    const f = this.auditFilters;
    const q = f.search.trim().toLowerCase();
    return this.history
      .filter((l) => {
        if (f.module !== 'All' && auditModule(l) !== f.module) return false;
        if (f.status !== 'All' && l.status !== f.status) return false;
        const day = l.timestamp.slice(0, 10);
        if (f.from && day < f.from) return false;
        if (f.to && day > f.to) return false;
        return !q || [l.logId, l.user, l.entity, auditEventLabel(l.event), auditAction(l), l.details ?? ''].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.logId.localeCompare(a.logId));
  }

  get hasAuditFilters(): boolean {
    const f = this.auditFilters;
    return !!f.search.trim() || f.module !== 'All' || f.status !== 'All' || !!f.from || !!f.to;
  }

  get auditTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredHistory.length / this.auditPageSize));
  }

  get auditSafePage(): number {
    return Math.min(this.auditPage, this.auditTotalPages - 1);
  }

  get pagedHistory(): AuditLog[] {
    const start = this.auditSafePage * this.auditPageSize;
    return this.filteredHistory.slice(start, start + this.auditPageSize);
  }

  clearAuditFilters(): void {
    this.auditFilters = { ...DEFAULT_AUDIT_FILTERS };
    this.auditPage = 0;
  }

  moduleOf(l: AuditLog): string {
    return auditModule(l);
  }

  actionOf(l: AuditLog): string {
    return `${auditEventLabel(l.event)}`;
  }

  toggleRow(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
  }

  setTab(t: PermTab): void {
    this.tab = t;
  }
}
