import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { TenantSupportService } from '../../../core/services/tenant-support.service';
import { DESCRIPTION_MAX, SUPPORT_STATUS_LABELS, SUPPORT_STATUS_TONES, SupportTicket, formatFileSize } from '../../../core/models/tenant-support.models';

@Component({
  selector: 'app-tenant-support-detail-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-support-detail-dialog.component.html',
  styleUrl: './tenant-support.component.scss',
})
export class TenantSupportDetailDialogComponent {
  private readonly service = inject(TenantSupportService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<TenantSupportDetailDialogComponent>);
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  readonly fmt = inject(AppFormatService);

  readonly labels = SUPPORT_STATUS_LABELS;
  readonly tones = SUPPORT_STATUS_TONES;
  readonly max = DESCRIPTION_MAX;
  readonly formatFileSize = formatFileSize;

  t?: SupportTicket;
  loadError = '';
  reply = '';
  error = '';
  busy = false;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    try {
      this.t = this.service.get(this.data.id);
      this.loadError = '';
    } catch (e) {
      this.t = undefined;
      this.loadError = e instanceof Error ? e.message : 'Could not load this request.';
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

  send(): void {
    if (!this.reply.trim()) {
      this.error = 'Write a message first.';
      return;
    }
    if (this.run(() => this.service.replyAsTenant(this.data.id, this.reply), 'Reply sent.')) this.reply = '';
  }

  closeTicket(): void {
    this.run(() => this.service.close(this.data.id), 'Request closed.');
  }

  close(): void {
    this.dialogRef.close();
  }
}
