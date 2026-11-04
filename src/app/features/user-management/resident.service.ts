import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
import { AuditLogService } from '../../core/services/audit-log.service';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { ConfirmDialogData } from '../../shared/components/confirm-dialog/app-confirm-dialog.component';
import { MOCK_RESIDENTS, Resident, ResidentStatus, residentAuditEntity, residentFullName } from './resident.models';

export type ResidentAction = 'activate' | 'deactivate' | 'block' | 'unblock';

export const RESIDENT_ACTION_META: Record<ResidentAction, { label: string; icon: string; danger?: boolean }> = {
  activate: { label: 'Activate', icon: 'check_circle' },
  deactivate: { label: 'Deactivate', icon: 'person_off', danger: true },
  block: { label: 'Block', icon: 'block', danger: true },
  unblock: { label: 'Unblock', icon: 'lock_open' },
};

/** Which account actions make sense for each status. */
export function residentActions(status: ResidentStatus): ResidentAction[] {
  switch (status) {
    case 'Active':
      return ['block', 'deactivate'];
    case 'Blocked':
      return ['unblock', 'deactivate'];
    case 'Inactive':
      return ['activate'];
  }
}

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the mock data. */
function nowIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

/**
 * Resident (end-user) accounts across all hostels, and the account actions a
 * Admin can take. Each action asks for confirmation, updates the account
 * and writes an audit entry. UI-only build: data is in-memory mock data.
 */
@Injectable({ providedIn: 'root' })
export class ResidentService {
  private readonly residentsSubject = new BehaviorSubject<Resident[]>(structuredClone(MOCK_RESIDENTS));
  readonly residents$ = this.residentsSubject.asObservable();

  constructor(
    private auditLog: AuditLogService,
    private confirm: ConfirmDialogService,
    private snackBar: MatSnackBar,
  ) {}

  get residents(): Resident[] {
    return this.residentsSubject.value;
  }

  byId(residentId: string): Resident | undefined {
    return this.residents.find((r) => r.residentId === residentId);
  }

  /** Confirms with the user, then applies the action. Emits the updated resident, or null if cancelled. */
  perform(resident: Resident, action: ResidentAction): Observable<Resident | null> {
    if (!residentActions(resident.status).includes(action)) return of(null);

    const name = residentFullName(resident);
    const dialogs: Record<ResidentAction, ConfirmDialogData> = {
      activate: {
        title: 'Activate tenant?',
        message: `${name} will be able to use the tenant app for ${resident.hostelName} again.`,
        icon: 'check_circle_outline',
        tone: 'success',
        confirmLabel: 'Activate',
      },
      deactivate: {
        title: 'Deactivate tenant?',
        message: `${name} will be signed out and can no longer use the tenant app.`,
        icon: 'person_off',
        note: 'Use this when a tenant has moved out. You can reactivate the account later.',
        confirmLabel: 'Deactivate',
        danger: true,
      },
      block: {
        title: 'Block tenant?',
        message: `${name} will be signed out immediately and blocked until the account is unblocked.`,
        icon: 'block',
        note: 'Use this for rule violations or suspicious activity.',
        confirmLabel: 'Block',
        danger: true,
      },
      unblock: {
        title: 'Unblock tenant?',
        message: `${name} will be able to use the tenant app again.`,
        icon: 'lock_open',
        tone: 'success',
        confirmLabel: 'Unblock',
      },
    };

    return this.confirm.confirm({ cancelLabel: 'Cancel', ...dialogs[action] }).pipe(
      map((ok) => {
        if (!ok) return null;
        this.apply(resident, action);
        return this.byId(resident.residentId) ?? null;
      }),
    );
  }

  private apply(resident: Resident, action: ResidentAction): void {
    const name = residentFullName(resident);
    const entity = residentAuditEntity(resident);
    const statusChange = (to: ResidentStatus) => [{ field: 'Status', oldValue: resident.status, newValue: to }];

    switch (action) {
      case 'activate':
        this.patch(resident.residentId, { status: 'Active', checkOutDate: undefined });
        this.auditLog.record('Activate Resident', entity, { changes: statusChange('Active') });
        this.toast(`${name} activated`);
        break;

      case 'deactivate':
        this.patch(resident.residentId, { status: 'Inactive', blockReason: undefined, blockedAt: undefined });
        this.auditLog.record('Deactivate Resident', entity, { changes: statusChange('Inactive') });
        this.toast(`${name} deactivated`);
        break;

      case 'block':
        this.patch(resident.residentId, { status: 'Blocked', blockReason: 'Blocked manually by Admin.', blockedAt: nowIso() });
        this.auditLog.record('Block Resident', entity, { changes: statusChange('Blocked') });
        this.toast(`${name} blocked`);
        break;

      case 'unblock':
        this.patch(resident.residentId, { status: 'Active', blockReason: undefined, blockedAt: undefined });
        this.auditLog.record('Unblock Resident', entity, {
          changes: statusChange('Active'),
          details: resident.blockReason ? `Previous block: ${resident.blockReason}` : undefined,
        });
        this.toast(`${name} unblocked`);
        break;
    }
  }

  private patch(residentId: string, changes: Partial<Resident>): void {
    this.residentsSubject.next(this.residents.map((r) => (r.residentId === residentId ? { ...r, ...changes } : r)));
  }

  private toast(message: string): void {
    this.snackBar.open(message, 'x', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['app-snackbar--success', 'green-snackbar'],
    });
  }
}
