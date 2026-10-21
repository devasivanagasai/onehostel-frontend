import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { ParcelsService } from '../parcels.service';
import { NOTIFICATION_TONES, PICKUP_TONES, Parcel, ParcelNotice } from '../parcels.models';

/** Follow-up the list screen carries out after the dialog closes. */
export type ParcelViewAction = 'collect' | 'return' | 'remind';

@Component({
  selector: 'app-parcel-view-dialog',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './parcel-view-dialog.component.html',
  styleUrl: './parcel-view-dialog.component.scss',
})
export class ParcelViewDialogComponent {
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ParcelViewDialogComponent, ParcelViewAction>);
  readonly service = inject(ParcelsService);
  readonly fmt = inject(AppFormatService);

  readonly p: Parcel = this.service.byId(this.data.id)!;
  readonly residentName = (() => {
    const r = this.service.resident(this.p.residentId);
    return r ? residentFullName(r) : this.p.residentId;
  })();
  readonly location = this.service.location(this.p.residentId);
  readonly notification = this.service.notificationStatus(this.p);
  readonly notificationTone = NOTIFICATION_TONES[this.notification];
  readonly pickupTone = PICKUP_TONES[this.p.status];
  readonly age = this.service.ageDays(this.p);
  readonly overdue = this.service.isOverdue(this.p);
  readonly reminderBlocker = this.service.reminderBlocker(this.p);
  /** Newest first. */
  readonly notices = [...this.p.notices].reverse();

  noticeState(n: ParcelNotice): { label: string; tone: string } {
    if (n.status === 'Failed') return { label: 'Failed', tone: 'danger' };
    const read = !!n.readAt && new Date(n.readAt).getTime() <= Date.now();
    return read ? { label: 'Read', tone: 'success' } : { label: 'Sent', tone: 'info' };
  }

  close(action?: ParcelViewAction): void {
    this.dialogRef.close(action);
  }
}
