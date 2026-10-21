import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AttendanceService } from '../attendance.service';
import { AttendanceChange, AttendanceRecord, METHOD_ICONS, METHOD_LABELS, STATUS_TONES } from '../attendance.models';

const ACTION_ICONS: Record<AttendanceChange['action'], string> = {
  Marked: 'how_to_reg',
  'Late entry': 'history_toggle_off',
  'Checked in': 'login',
  'Checked out': 'logout',
  Corrected: 'edit_calendar',
};

/** Audit trail of one attendance record, newest first. */
@Component({
  selector: 'app-attendance-history-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './attendance-history-dialog.component.html',
  styleUrl: './attendance-history-dialog.component.scss',
})
export class AttendanceHistoryDialogComponent {
  private readonly data = inject<{ id: string; name: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AttendanceHistoryDialogComponent>);
  private readonly service = inject(AttendanceService);
  readonly fmt = inject(AppFormatService);

  readonly name = this.data.name;
  readonly record: AttendanceRecord = this.service.byId(this.data.id)!;
  readonly tone = STATUS_TONES[this.record.status];
  readonly entries = [...this.record.history].reverse();
  readonly actionIcons = ACTION_ICONS;
  readonly methodIcons = METHOD_ICONS;
  readonly methodLabels = METHOD_LABELS;

  close(): void {
    this.dialogRef.close();
  }
}
