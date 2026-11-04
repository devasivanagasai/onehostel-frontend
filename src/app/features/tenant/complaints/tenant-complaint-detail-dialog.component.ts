import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { STATUS_TONES } from '../../../core/models/complaints.models';
import { REASON_MIN, TENANT_CATEGORY_ICONS, TenantComplaintView, TenantComplaintsService } from '../../../core/services/tenant-complaints.service';
import { formatFileSize } from '../../../core/models/tenant-support.models';

export interface TenantComplaintDetailData {
  id: string;
}

@Component({
  selector: 'app-tenant-complaint-detail-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-complaint-detail-dialog.component.html',
  styleUrl: './tenant-complaints.component.scss',
})
export class TenantComplaintDetailDialogComponent {
  private readonly service = inject(TenantComplaintsService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<TenantComplaintDetailDialogComponent>);
  private readonly data = inject<TenantComplaintDetailData>(MAT_DIALOG_DATA);
  readonly fmt = inject(AppFormatService);

  readonly tones = STATUS_TONES;
  readonly icons = TENANT_CATEGORY_ICONS;
  readonly reasonMin = REASON_MIN;
  readonly formatFileSize = formatFileSize;

  c?: TenantComplaintView;
  loadError = '';

  comment = '';
  reopening = false;
  reason = '';
  error = '';
  busy = false;

  constructor() {
    this.refresh();
  }

  get tone(): string {
    return this.c ? (this.tones[this.c.status] ?? 'neutral') : 'neutral';
  }

  close(): void {
    this.dialogRef.close();
  }

  refresh(): void {
    try {
      this.c = this.service.get(this.data.id);
      this.loadError = '';
    } catch (e) {
      this.c = undefined;
      this.loadError = e instanceof Error ? e.message : 'Could not load this complaint.';
    }
  }

  private run(action: () => unknown, done: string): boolean {
    this.error = '';
    this.busy = true;
    try {
      action();
      this.refresh();
      this.snack.open(done, 'OK', { duration: 3000 });
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  sendComment(): void {
    if (!this.c) return;
    if (!this.comment.trim()) {
      this.error = 'Write a comment first.';
      return;
    }
    if (this.run(() => this.service.comment(this.data.id, this.comment), 'Comment added.')) this.comment = '';
  }

  confirm(): void {
    this.run(() => this.service.confirmResolved(this.data.id), 'Thanks. We have noted that the issue is resolved.');
  }

  startReopen(): void {
    this.reopening = true;
    this.error = '';
  }

  cancelReopen(): void {
    this.reopening = false;
    this.reason = '';
    this.error = '';
  }

  submitReopen(): void {
    if (this.reason.trim().length < REASON_MIN) {
      this.error = `Give a reason in at least ${REASON_MIN} characters.`;
      return;
    }
    if (this.run(() => this.service.reopen(this.data.id, this.reason), 'Complaint reopened.')) this.cancelReopen();
  }
}
