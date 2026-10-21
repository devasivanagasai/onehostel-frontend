import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppDialogComponent, AppDialogTone } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ComplaintsService } from '../complaints.service';
import {
  ATTACHMENT_MAX_COUNT,
  COMPLAINT_PRIORITIES,
  Complaint,
  ComplaintAttachment,
  ComplaintEventType,
  ComplaintPriority,
  ComplaintStatus,
  REOPEN_WINDOW_DAYS,
  CATEGORY_ICONS,
  STAFF,
  STATUS_TONES,
  isActive,
  staffById,
  staffLabel,
} from '../complaints.models';
import { isImage, readAttachments } from '../attachments';

export interface ComplaintViewDialogData {
  complaintId: string;
}

/** Inline step that needs text before it runs. */
type PendingStep = 'resolve' | 'reopen' | null;

const EVENT_ICONS: Record<ComplaintEventType, string> = {
  created: 'send',
  assigned: 'person',
  status: 'sync',
  note: 'handyman',
  resolved: 'task_alt',
  notified: 'notifications',
  priority: 'flag',
};

/** A history line split so the template can highlight its key parts. */
export type EventParts =
  | { kind: 'status'; from: string; to: string }
  | { kind: 'assigned'; name: string; role: string }
  | { kind: 'text'; text: string };

@Component({
  selector: 'app-complaint-view-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './complaint-view-dialog.component.html',
  styleUrl: './complaint-view-dialog.component.scss',
})
export class ComplaintViewDialogComponent {
  readonly complaints = inject(ComplaintsService);
  readonly fmt = inject(AppFormatService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<ComplaintViewDialogComponent>);
  readonly data = inject<ComplaintViewDialogData>(MAT_DIALOG_DATA);

  readonly staff = STAFF;
  readonly priorities = COMPLAINT_PRIORITIES;
  readonly reopenDays = REOPEN_WINDOW_DAYS;
  readonly maxFiles = ATTACHMENT_MAX_COUNT;
  readonly today = new Date().toISOString().slice(0, 10);
  readonly isImage = isImage;

  step: PendingStep = null;
  stepText = '';

  noteText = '';
  noteFiles: ComplaintAttachment[] = [];
  noteError = '';

  error = '';
  /** Full-size preview of a photo. */
  preview: ComplaintAttachment | null = null;

  get c(): Complaint {
    return this.complaints.byId(this.data.complaintId)!;
  }

  get active(): boolean {
    return isActive(this.c);
  }

  get assigneeName(): string {
    return staffById(this.c.assignedTo)?.name ?? 'Unassigned';
  }

  get assigneeRole(): string {
    return staffById(this.c.assignedTo)?.role ?? '';
  }

  get overdue(): boolean {
    return this.complaints.isOverdue(this.c);
  }

  /** Header tile colour: red for urgent complaints, amber otherwise. */
  get tone(): AppDialogTone {
    return this.c.priority === 'Urgent' ? 'red' : 'amber';
  }

  statusTone(status: ComplaintStatus): string {
    return STATUS_TONES[status];
  }

  eventIcon(type: ComplaintEventType): string {
    return EVENT_ICONS[type];
  }

  categoryIcon(category: string): string {
    return CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] ?? 'report_problem';
  }

  /** "Status changed Open → In Progress." / "Assigned to Ravi Kumar (Plumber)." → highlighted parts. */
  eventParts(text: string): EventParts {
    const status = /^Status changed (.+) → (.+?)\.?$/.exec(text);
    if (status) return { kind: 'status', from: status[1], to: status[2] };
    const assigned = /^Assigned to (.+) \((.+)\)\.?$/.exec(text);
    if (assigned) return { kind: 'assigned', name: assigned[1], role: assigned[2] };
    return { kind: 'text', text };
  }

  /** "Plumber" when the actor is a staff member, so the timeline reads "by Ravi Kumar • Plumber". */
  actorRole(name: string): string {
    return this.staff.find((s) => s.name === name)?.role ?? '';
  }

  // ---- Actions ---------------------------------------------------------------

  assign(staffId: string): void {
    this.run(() => {
      this.complaints.assign(this.c.id, staffId || undefined);
      this.toast(staffId ? `Assigned to ${staffLabel(staffId)}.` : 'Complaint unassigned.');
    });
  }

  setPriority(p: ComplaintPriority): void {
    this.run(() => this.complaints.setPriority(this.c.id, p));
  }

  setTarget(date: string): void {
    this.run(() => this.complaints.setTarget(this.c.id, date || undefined));
  }

  startWork(): void {
    this.run(() => {
      this.complaints.startWork(this.c.id);
      this.toast('Marked In Progress.');
    });
  }

  close(): void {
    this.run(() => {
      this.complaints.close(this.c.id);
      this.toast(`${this.c.id} closed. It stays searchable for reporting.`);
    });
  }

  openStep(step: Exclude<PendingStep, null>): void {
    this.step = step;
    this.stepText = '';
    this.error = '';
  }

  submitStep(): void {
    const step = this.step;
    this.run(() => {
      if (step === 'resolve') {
        this.complaints.resolve(this.c.id, this.stepText);
        this.toast('Resolved. The resident has been notified.');
      } else if (step === 'reopen') {
        this.complaints.reopen(this.c.id, this.stepText);
        this.toast('Complaint reopened.');
      }
      this.step = null;
    });
  }

  async onNoteFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const { added, error } = await readAttachments(input.files, this.noteFiles.length);
    input.value = '';
    this.noteFiles = [...this.noteFiles, ...added];
    this.noteError = error;
  }

  removeNoteFile(id: string): void {
    this.noteFiles = this.noteFiles.filter((f) => f.id !== id);
  }

  addNote(): void {
    this.run(() => {
      this.complaints.addNote(this.c.id, this.noteText, this.noteFiles);
      this.noteText = '';
      this.noteFiles = [];
      this.noteError = '';
      this.toast('Note added.');
    });
  }

  openAttachment(a: ComplaintAttachment): void {
    if (isImage(a)) {
      this.preview = a;
      return;
    }
    const link = document.createElement('a');
    link.href = a.url;
    link.download = a.name;
    link.click();
  }

  dismiss(): void {
    this.dialogRef.close();
  }

  private toast(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000 });
  }

  private run(fn: () => void): void {
    this.error = '';
    try {
      fn();
    } catch (err: any) {
      this.error = err?.message ?? 'Something went wrong.';
    }
  }
}
