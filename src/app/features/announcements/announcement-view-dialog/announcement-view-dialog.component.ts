import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { AnnouncementsService } from '../announcements.service';
import { ANNOUNCEMENT_STATUS_TONES, Announcement, AnnouncementStatus, CHANNEL_ICONS, CHANNEL_TONES, formatBytes, wasSent } from '../announcements.models';

export interface AnnouncementViewData {
  id: string;
}

/** Follow-up the list screen carries out after the dialog closes. */
export type AnnouncementViewAction = 'edit' | 'duplicate' | 'cancel' | 'delete';

const STATUS_ICONS: Record<AnnouncementStatus, string> = {
  Draft: 'edit_note',
  Scheduled: 'calendar_month',
  Published: 'check_circle',
  Expired: 'history',
  Cancelled: 'cancel',
};

@Component({
  selector: 'app-announcement-view-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './announcement-view-dialog.component.html',
  styleUrl: './announcement-view-dialog.component.scss',
})
export class AnnouncementViewDialogComponent {
  private readonly data = inject<AnnouncementViewData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AnnouncementViewDialogComponent, AnnouncementViewAction>);
  readonly service = inject(AnnouncementsService);
  readonly fmt = inject(AppFormatService);

  readonly channelIcons = CHANNEL_ICONS;
  readonly channelTones = CHANNEL_TONES;
  readonly formatBytes = formatBytes;

  readonly a: Announcement = this.service.byId(this.data.id)!;
  readonly status = this.service.status(this.a);
  readonly statusTone = ANNOUNCEMENT_STATUS_TONES[this.status];
  readonly sent = wasSent(this.status);
  readonly statusIcon = STATUS_ICONS[this.status];

  readonly recipients = this.service.recipients(this.a.audience);
  readonly delivery = this.service.delivery(this.a);
  private readonly readers = new Set(this.service.inAppReaders(this.a, this.recipients).map((r) => r.residentId));
  readonly recipientRows = this.recipients.map((r) => ({
    id: r.residentId,
    name: residentFullName(r),
    location: this.service.location(r.residentId),
    read: this.readers.has(r.residentId),
  }));
  readonly hasInApp = this.a.channels.includes('In-app');

  /** Why there are no delivery figures yet. */
  get pendingText(): string {
    switch (this.status) {
      case 'Draft':
        return 'Drafts are not sent to residents. Publish or schedule it to deliver.';
      case 'Scheduled':
        return `Goes out ${this.fmt.date(this.a.publishAt!, 'datetime')}. Delivery details appear once it is published.`;
      default:
        return `Cancelled before it was sent${this.a.cancelledAt ? ' on ' + this.fmt.date(this.a.cancelledAt, 'datetime') : ''}. Nothing was delivered.`;
    }
  }

  pct(part: number | null, whole: number): number {
    return part === null || !whole ? 0 : Math.round((part / whole) * 100);
  }

  close(action?: AnnouncementViewAction): void {
    this.dialogRef.close(action);
  }
}
