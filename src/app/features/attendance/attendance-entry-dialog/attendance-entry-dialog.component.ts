import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent, AppDialogTone } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { LeaveOutpassService } from '../../leave-outpass/leave-outpass.service';
import { AttendanceService } from '../attendance.service';
import {
  AttendanceMethod,
  AttendanceRecord,
  AttendanceRow,
  AttendanceSession,
  METHOD_ICONS,
  METHOD_LABELS,
  RECORDED_STATUSES,
  RecordedStatus,
  SessionError,
} from '../attendance.models';

export type EntryMode = 'checkin' | 'checkout' | 'edit';

export interface AttendanceEntryData {
  residentId: string;
  date: string;
  mode: EntryMode;
  /** Status picked from the row's segmented control. */
  status?: RecordedStatus;
}

/** Editable copy of a stay, times as HH:mm on the selected date. */
interface SessionDraft {
  in: string;
  out: string;
  inMethod: AttendanceMethod;
  outMethod?: AttendanceMethod;
}

const STATUS_ICONS: Record<RecordedStatus, string> = { Present: 'check_circle', Absent: 'cancel', 'On Leave': 'luggage' };

@Component({
  selector: 'app-attendance-entry-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './attendance-entry-dialog.component.html',
  styleUrl: './attendance-entry-dialog.component.scss',
})
export class AttendanceEntryDialogComponent {
  private readonly data = inject<AttendanceEntryData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AttendanceEntryDialogComponent, AttendanceRecord>);
  readonly service = inject(AttendanceService);
  readonly leaveService = inject(LeaveOutpassService);
  readonly fmt = inject(AppFormatService);

  readonly mode = this.data.mode;
  readonly date = this.data.date;
  readonly row: AttendanceRow = this.service.rows(this.date).find((r) => r.resident.residentId === this.data.residentId)!;
  readonly record = this.row.record;
  readonly statuses = RECORDED_STATUSES;
  readonly statusIcons = STATUS_ICONS;
  readonly methodLabels = METHOD_LABELS;
  readonly methodIcons = METHOD_ICONS;
  readonly methods = this.service.manualMethods;
  readonly isToday = this.date === this.service.today;
  readonly leaveMovement = this.row.leave ? this.leaveService.movement(this.row.leave) : null;

  /** Correcting a saved record, or any entry on a past date, needs a reason (and permission). */
  readonly needsReason = this.service.needsReason(this.date, this.mode === 'edit' && !!this.record);

  status: RecordedStatus = this.data.status ?? this.record?.status ?? 'Present';
  method: AttendanceMethod = this.methods[0];
  remarks = this.record?.remarks ?? '';
  reason = '';
  /** Time for check-in / check-out: now today, blank on a past date. */
  when = this.isToday ? this.nowHm() : '';
  sessions: SessionDraft[] = (this.record?.sessions ?? []).map((s) => ({ in: s.in.slice(11, 16), out: s.out?.slice(11, 16) ?? '', inMethod: s.inMethod, outMethod: s.outMethod }));

  attempted = false;
  saving = false;
  saveError = '';

  get title(): string {
    if (this.mode === 'checkin') return 'Check In';
    if (this.mode === 'checkout') return 'Check Out';
    return this.record ? 'Correct Attendance' : this.isToday ? 'Mark Attendance' : 'Late Entry';
  }

  get icon(): string {
    return this.mode === 'checkin' ? 'login' : this.mode === 'checkout' ? 'logout' : this.record ? 'edit_calendar' : 'how_to_reg';
  }

  get tone(): AppDialogTone {
    return this.mode === 'edit' && this.record ? 'amber' : 'teal';
  }

  get openSession(): AttendanceSession | undefined {
    return this.record?.sessions.find((s) => !s.out);
  }

  // ---- Validation --------------------------------------------------------------

  private iso(hm: string): string {
    return hm ? `${this.date}T${hm}:00` : '';
  }

  /** Stays as they would be saved. */
  private get draft(): AttendanceSession[] {
    if (this.mode === 'edit') {
      return this.sessions.map((s) => ({ in: this.iso(s.in), inMethod: s.inMethod, out: this.iso(s.out) || undefined, outMethod: s.out ? s.outMethod ?? this.method : undefined }));
    }
    const list = (this.record?.sessions ?? []).map((s) => ({ ...s }));
    if (this.mode === 'checkin') list.push({ in: this.iso(this.when), inMethod: this.method });
    else {
      const open = list.find((s) => !s.out);
      if (open) open.out = this.iso(this.when);
    }
    return list;
  }

  get sessionErrors(): SessionError[] {
    return this.service.sessionErrors(this.date, this.draft);
  }

  /** Inline error for the single time on check-in / check-out. */
  get whenError(): string {
    if (this.mode === 'checkin' && this.openSession) return `Already checked in at ${this.fmt.date(this.openSession.in, 'time')} — check out first`;
    if (this.mode === 'checkout' && !this.openSession) return 'Not checked in — nothing to check out';
    if (this.mode === 'checkin' && this.record?.status === 'Absent') return 'Marked Absent — correct the status first';
    if (!this.when) return this.attempted ? 'Enter the time' : '';
    const errs = this.sessionErrors;
    if (this.mode === 'checkin') return errs[errs.length - 1]?.in ?? '';
    return errs[this.record!.sessions.findIndex((s) => !s.out)]?.out ?? '';
  }

  get statusError(): string {
    return this.mode === 'edit' && this.status === 'Absent' && this.sessions.length ? 'Remove the check-in times to mark Absent' : '';
  }

  get reasonError(): string {
    return this.attempted && this.needsReason && !this.reason.trim() ? 'A reason is required for this change' : '';
  }

  get hasSessionErrors(): boolean {
    return this.mode === 'edit' && this.sessionErrors.some((e) => e.in || e.out);
  }

  // ---- Editing stays ----------------------------------------------------------

  addSession(): void {
    this.sessions = [...this.sessions, { in: '', out: '', inMethod: this.method }];
  }

  removeSession(i: number): void {
    this.sessions = this.sessions.filter((_, idx) => idx !== i);
  }

  // ---- Save -------------------------------------------------------------------

  save(): void {
    this.attempted = true;
    if (!this.service.canCorrect && this.needsReason) {
      this.saveError = 'You do not have permission to correct attendance.';
      return;
    }
    if (this.reasonError || this.statusError || this.hasSessionErrors || (this.mode !== 'edit' && this.whenError)) return;
    this.saving = true;
    this.saveError = '';
    try {
      const id = this.row.resident.residentId;
      const rec =
        this.mode === 'checkin' ? this.service.checkIn(id, this.date, this.iso(this.when), this.method, this.reason)
        : this.mode === 'checkout' ? this.service.checkOut(id, this.date, this.iso(this.when), this.method, this.reason)
        : this.service.save(id, this.date, { status: this.status, sessions: this.draft, remarks: this.remarks }, this.method, this.reason);
      this.dialogRef.close(rec);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save attendance.';
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  private nowHm(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
