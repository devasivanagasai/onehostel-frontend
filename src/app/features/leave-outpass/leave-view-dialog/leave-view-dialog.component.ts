import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { LeaveOutpassService } from '../leave-outpass.service';
import { APPROVAL_TONES, LeaveRequest, MOVEMENT_TONES, durationLabel, time } from '../leave-outpass.models';
import { LeaveAction } from '../leave-action-dialog/leave-action-dialog.component';

interface TimelineStep {
  icon: string;
  title: string;
  /** done = happened, current = waiting on it, skipped = won't happen. */
  state: 'done' | 'current' | 'todo' | 'bad';
  at?: string;
  by?: string;
  note?: string;
}

@Component({
  selector: 'app-leave-view-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './leave-view-dialog.component.html',
  styleUrl: './leave-view-dialog.component.scss',
})
export class LeaveViewDialogComponent {
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LeaveViewDialogComponent, LeaveAction>);
  readonly service = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);

  readonly r: LeaveRequest = this.service.byId(this.data.id)!;
  readonly name = this.service.residentName(this.r.residentId);
  readonly movement = this.service.movement(this.r);
  readonly approvalTone = APPROVAL_TONES[this.r.status];
  readonly movementTone = this.movement ? MOVEMENT_TONES[this.movement] : '';
  readonly duration = durationLabel(this.r.departAt, this.r.returnAt);
  readonly tracking = this.service.policy.movementTracking;
  readonly canExit = this.tracking && this.r.status === 'Approved' && !this.r.exitAt && time(this.r.returnAt) > Date.now();
  readonly canReturn = this.r.status === 'Approved' && !!this.r.exitAt && !this.r.returnedAt;
  readonly canCancel = this.service.canCancel(this.r);
  readonly notifications = [...this.r.notifications].reverse();
  readonly steps = this.buildSteps();

  close(action?: LeaveAction): void {
    this.dialogRef.close(action);
  }

  /** Submitted → decision → exit → return. Approval and movement are separate steps. */
  private buildSteps(): TimelineStep[] {
    const r = this.r;
    const steps: TimelineStep[] = [
      { icon: 'send', title: `Submitted via ${r.submittedVia}`, state: 'done', at: r.createdAt, by: r.submittedBy },
    ];
    if (r.status === 'Pending') {
      steps.push({ icon: 'hourglass_top', title: 'Awaiting decision', state: 'current' });
    } else if (r.decidedAt) {
      steps.push({
        icon: r.status === 'Rejected' ? 'block' : 'check_circle',
        title: r.status === 'Rejected' ? 'Rejected' : 'Approved',
        state: r.status === 'Rejected' ? 'bad' : 'done',
        at: r.decidedAt,
        by: r.decidedBy,
        note: r.decisionReason,
      });
    }
    if (r.status === 'Cancelled') {
      steps.push({ icon: 'event_busy', title: 'Cancelled', state: 'bad', at: r.cancelledAt, by: r.cancelledBy, note: r.cancelReason });
      return steps;
    }
    if (r.status === 'Rejected') return steps;

    const late = r.returnedAt && time(r.returnedAt) > time(r.returnAt) ? `Late by ${durationLabel(r.returnAt, r.returnedAt)}` : undefined;
    if (r.exitAt) {
      steps.push({ icon: 'logout', title: 'Left the hostel', state: 'done', at: r.exitAt, by: r.exitBy });
    } else if (this.tracking || r.status === 'Pending') {
      steps.push({ icon: 'logout', title: 'Exit', state: r.status === 'Approved' ? 'current' : 'todo', note: `Planned ${this.fmt.date(r.departAt, 'datetime')}` });
    }
    if (r.returnedAt) {
      steps.push({ icon: 'login', title: 'Returned', state: late ? 'bad' : 'done', at: r.returnedAt, by: r.returnBy, note: late });
    } else if (this.tracking || r.exitAt || r.status === 'Pending') {
      const overdue = this.movement === 'Overdue return';
      steps.push({ icon: 'login', title: overdue ? 'Return overdue' : 'Return', state: overdue ? 'bad' : r.exitAt ? 'current' : 'todo', note: `Expected ${this.fmt.date(r.returnAt, 'datetime')}` });
    }
    return steps;
  }
}
