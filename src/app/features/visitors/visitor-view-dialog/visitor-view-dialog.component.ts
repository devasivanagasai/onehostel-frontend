import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { VisitorsService } from '../visitors.service';
import { APPROVAL_TONES, VISIT_TONES, Visitor, maskId } from '../visitors.models';
import { VisitorActionMode } from '../visitor-action-dialog/visitor-action-dialog.component';

/** Follow-up the list screen carries out after the dialog closes. */
export type VisitorViewAction = VisitorActionMode | 'checkout';

@Component({
  selector: 'app-visitor-view-dialog',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './visitor-view-dialog.component.html',
  styleUrl: './visitor-view-dialog.component.scss',
})
export class VisitorViewDialogComponent {
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<VisitorViewDialogComponent, VisitorViewAction>);
  readonly service = inject(VisitorsService);
  readonly fmt = inject(AppFormatService);

  readonly maskId = maskId;
  readonly retentionDays = this.service.rules.idRetentionDays;

  /** Full ID, only after a (recorded) reveal in this dialog. */
  revealed = '';
  revealError = '';

  /** Re-read so the history picks up the reveal. */
  get v(): Visitor {
    return this.service.byId(this.data.id)!;
  }

  get residentName(): string {
    const r = this.service.resident(this.v.residentId);
    return r ? residentFullName(r) : this.v.residentId;
  }

  get approvalTone(): string {
    return APPROVAL_TONES[this.v.approval];
  }

  get statusTone(): string {
    return this.service.isMissed(this.v) ? 'warning' : VISIT_TONES[this.v.status];
  }

  get statusLabel(): string {
    return this.service.isMissed(this.v) ? 'Not Arrived' : this.v.status;
  }

  get canDecide(): boolean {
    return this.v.approval === 'Pending' && this.v.status === 'Expected' && !this.service.isMissed(this.v);
  }

  get checkInBlocker(): string {
    return this.service.checkInBlocker(this.v);
  }

  get canCancel(): boolean {
    return this.v.status === 'Expected' && !this.service.isMissed(this.v) && this.v.approval !== 'Pending';
  }

  /** Newest last, as a timeline reads top to bottom. */
  get history() {
    return this.v.history;
  }

  reveal(): void {
    try {
      this.revealed = this.service.revealId(this.v.id);
      this.revealError = '';
    } catch (err: any) {
      this.revealError = err?.message ?? 'Could not reveal the ID.';
    }
  }

  close(action?: VisitorViewAction): void {
    this.dialogRef.close(action);
  }
}
