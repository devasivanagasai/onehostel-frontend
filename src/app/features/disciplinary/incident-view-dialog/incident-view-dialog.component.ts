import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { DisciplinaryService } from '../../../core/services/disciplinary.service';
import { ACTION_MAX, Incident, IncidentEvent, NOTE_MIN, REVIEW_STATUSES, REVIEW_TONES, fileSizeLabel } from '../../../core/models/disciplinary.models';

/** Follow-up the list screen carries out after the dialog closes. */
export type IncidentViewAction = 'edit' | 'correct';

const EVENT_ICONS: Record<IncidentEvent['type'], string> = {
  created: 'add_circle',
  status: 'swap_horiz',
  edited: 'edit',
  corrected: 'rule',
  viewed: 'visibility',
};

/** Incident details (resident name and ID appear only here), review workflow and the append-only history. */
@Component({
  selector: 'app-incident-view-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './incident-view-dialog.component.html',
  styleUrl: './incident-view-dialog.component.scss',
})
export class IncidentViewDialogComponent {
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<IncidentViewDialogComponent, IncidentViewAction>);
  readonly service = inject(DisciplinaryService);
  readonly fmt = inject(AppFormatService);

  readonly steps = REVIEW_STATUSES;
  readonly tones = REVIEW_TONES;
  readonly icons = EVENT_ICONS;
  readonly noteMin = NOTE_MIN;
  readonly actionMax = ACTION_MAX;
  readonly sizeLabel = fileSizeLabel;

  /** Text for the next step: the action taken (Action Recorded) or the closing note (Closed). */
  note = '';
  error = '';

  constructor() {
    // One audit entry per open (the dialog is created once per open).
    this.service.recordView(this.data.id);
    this.note = this.i.actionTaken ?? '';
  }

  get i(): Incident {
    return this.service.byId(this.data.id)!;
  }

  get next() {
    return this.service.nextStatus(this.i.status);
  }

  /** Timeline, newest first. */
  get timeline(): IncidentEvent[] {
    return [...this.i.history].reverse();
  }

  get needsNote(): boolean {
    return this.next === 'Action Recorded' || this.next === 'Closed';
  }

  get noteLabel(): string {
    return this.next === 'Closed' ? `Closing note (at least ${NOTE_MIN} characters)` : 'Action taken';
  }

  advance(): void {
    const next = this.next;
    if (!next) return;
    try {
      this.service.advance(this.i.id, next, this.needsNote ? this.note : '');
      this.error = '';
      this.note = this.next === 'Closed' ? '' : (this.i.actionTaken ?? '');
    } catch (err: any) {
      this.error = err?.message ?? 'Could not update the status.';
    }
  }

  act(action: IncidentViewAction): void {
    this.dialogRef.close(action);
  }
}
