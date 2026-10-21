import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent, AppDialogTone } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent, AppButtonVariant } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { LeaveOutpassService } from '../leave-outpass.service';
import { LeaveRequest, REASON_MAX, durationLabel, localIso, time } from '../leave-outpass.models';

/** Decision or movement step on a request. Also returned by the view dialog. */
export type LeaveAction = 'approve' | 'reject' | 'cancel' | 'exit' | 'return';

export interface LeaveActionData {
  id: string;
  action: LeaveAction;
}

interface ActionCopy {
  title: string;
  subtitle: string;
  icon: string;
  tone: AppDialogTone;
  confirm: string;
  variant: AppButtonVariant;
}

const COPY: Record<LeaveAction, ActionCopy> = {
  approve: { title: 'Approve Request', subtitle: 'The resident may leave within the approved window.', icon: 'check_circle', tone: 'green', confirm: 'Approve', variant: 'accent' },
  reject: { title: 'Reject Request', subtitle: 'Tell the resident why the request was not approved.', icon: 'block', tone: 'red', confirm: 'Reject', variant: 'danger' },
  cancel: { title: 'Cancel Request', subtitle: 'The request will no longer be valid for exit.', icon: 'event_busy', tone: 'red', confirm: 'Cancel Request', variant: 'danger' },
  exit: { title: 'Record Exit', subtitle: 'Physical exit as seen at the gate. Separate from the approval.', icon: 'logout', tone: 'blue', confirm: 'Record Exit', variant: 'primary' },
  return: { title: 'Record Return', subtitle: 'Physical return as seen at the gate.', icon: 'login', tone: 'teal', confirm: 'Record Return', variant: 'accent' },
};

@Component({
  selector: 'app-leave-action-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './leave-action-dialog.component.html',
  styleUrl: './leave-action-dialog.component.scss',
})
export class LeaveActionDialogComponent {
  private readonly data = inject<LeaveActionData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LeaveActionDialogComponent, LeaveRequest>);
  readonly service = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);

  readonly action = this.data.action;
  readonly copy = COPY[this.action];
  readonly r: LeaveRequest = this.service.byId(this.data.id)!;
  readonly name = this.service.residentName(this.r.residentId);
  readonly duration = durationLabel(this.r.departAt, this.r.returnAt);
  readonly reasonMax = REASON_MAX;
  readonly isDecision = this.action === 'approve' || this.action === 'reject';
  readonly isMovement = this.action === 'exit' || this.action === 'return';
  readonly guardianBlock = this.service.guardianBlock(this.r.residentId);
  readonly guardianName = this.service.resident(this.r.residentId)?.guardian?.name;
  readonly maxWhen = localIso().slice(0, 16);

  note = '';
  when = localIso().slice(0, 16);
  attempted = false;
  saving = false;
  saveError = '';

  get noteError(): string {
    return this.attempted && this.action === 'reject' && !this.note.trim() ? 'A reason is required to reject' : '';
  }

  get whenError(): string {
    return this.isMovement ? this.service.movementError(this.r, this.action as 'exit' | 'return', this.when ? `${this.when}:00` : '') : '';
  }

  /** "Late by 2h" when the return is after the expected time. */
  get lateBy(): string {
    if (this.action !== 'return' || !this.when) return '';
    const v = `${this.when}:00`;
    return time(v) > time(this.r.returnAt) ? durationLabel(this.r.returnAt, v) : '';
  }

  get noteLabel(): string {
    return this.action === 'reject' ? 'Reason for rejection' : this.action === 'cancel' ? 'Reason for cancelling' : 'Note to resident';
  }

  confirm(): void {
    this.attempted = true;
    if (this.noteError || this.whenError) return;
    this.saving = true;
    this.saveError = '';
    try {
      const id = this.r.id;
      const when = `${this.when}:00`;
      const next =
        this.action === 'approve' ? this.service.approve(id, this.note)
        : this.action === 'reject' ? this.service.reject(id, this.note)
        : this.action === 'cancel' ? this.service.cancel(id, this.note)
        : this.action === 'exit' ? this.service.recordExit(id, when)
        : this.service.recordReturn(id, when);
      this.dialogRef.close(next);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not update the request.';
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
