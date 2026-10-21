import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { switchMap, timer } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AnnouncementsService, HOSTEL_ID } from './announcements.service';
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_STATUS_TONES,
  AUDIENCE_OPTIONS,
  Announcement,
  AnnouncementStatus,
  CHANNELS,
  CHANNEL_ICONS,
  CHANNEL_TONES,
  expiryTime,
} from './announcements.models';
import {
  AnnouncementComposeData,
  AnnouncementComposeDialogComponent,
  AnnouncementComposeResult,
} from './announcement-compose-dialog/announcement-compose-dialog.component';
import {
  AnnouncementViewAction,
  AnnouncementViewData,
  AnnouncementViewDialogComponent,
} from './announcement-view-dialog/announcement-view-dialog.component';

interface AnnouncementFilters {
  search: string;
  status: string;
  channel: string;
  audience: string;
}

const DEFAULT_FILTERS: AnnouncementFilters = { search: '', status: 'All', channel: 'All', audience: 'All' };

/** Upcoming first, then drafts, then the rest newest first. */
const STATUS_RANK: Record<AnnouncementStatus, number> = { Scheduled: 0, Draft: 1, Published: 2, Expired: 2, Cancelled: 2 };

@Component({
  selector: 'app-announcements',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatTableModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './announcements.component.html',
  styleUrl: './announcements.component.scss',
})
export class AnnouncementsComponent {
  readonly service = inject(AnnouncementsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly columns = ['announcement', 'audience', 'channels', 'publish', 'status', 'createdBy', 'actions'];
  readonly statuses = ANNOUNCEMENT_STATUSES;
  readonly channels = CHANNELS;
  readonly audienceOptions = AUDIENCE_OPTIONS;

  filters: AnnouncementFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  /** Re-read every 30 s so scheduled / expiring announcements flip status while the page is open. */
  readonly stats$ = timer(0, 30_000).pipe(switchMap(() => this.service.stats$));

  get filtered(): Announcement[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.service.announcements
      .filter((a) => {
        if (a.hostelId !== HOSTEL_ID) return false;
        if (q && ![a.id, a.title, a.message, a.createdBy].join(' ').toLowerCase().includes(q)) return false;
        if (f.status !== 'All' && this.status(a) !== f.status) return false;
        if (f.channel !== 'All' && !a.channels.includes(f.channel as Announcement['channels'][number])) return false;
        if (f.audience !== 'All' && a.audience.type !== f.audience) return false;
        return true;
      })
      .sort((a, b) => STATUS_RANK[this.status(a)] - STATUS_RANK[this.status(b)] || this.compareDates(a, b));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.channel !== 'All' || f.audience !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Announcement[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- View helpers -----------------------------------------------------------

  status(a: Announcement): AnnouncementStatus {
    return this.service.status(a);
  }

  statusTone(a: Announcement): string {
    return ANNOUNCEMENT_STATUS_TONES[this.status(a)];
  }

  recipientCount(a: Announcement): number {
    return this.service.recipients(a.audience).length;
  }

  channelIcon(c: string): string {
    return CHANNEL_ICONS[c as keyof typeof CHANNEL_ICONS] ?? 'send';
  }

  channelTone(c: string): string {
    return CHANNEL_TONES[c as keyof typeof CHANNEL_TONES] ?? 'teal';
  }

  /** Teal for everyone, amber for rooms / room types, purple for hand-picked residents. */
  audienceTone(a: Announcement): string {
    return a.audience.type === 'All' ? 'teal' : a.audience.type === 'Residents' ? 'purple' : 'amber';
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  audienceIcon(a: Announcement): string {
    return AUDIENCE_OPTIONS.find((o) => o.value === a.audience.type)?.icon ?? 'groups';
  }

  /** Second line under the publish date. */
  publishHint(a: Announcement): string {
    const s = this.status(a);
    if (s === 'Scheduled') return 'Scheduled';
    if (s === 'Cancelled') return 'Cancelled';
    if (s === 'Expired') return `Expired ${this.fmt.date(a.expiryDate!)}`;
    if (a.expiryDate) {
      const days = Math.ceil((expiryTime(a.expiryDate) - Date.now()) / 86_400_000);
      return days <= 1 ? 'Expires today' : `Expires in ${days} days`;
    }
    return 'No expiry';
  }

  // ---- Actions ----------------------------------------------------------------

  openCompose(draft?: Announcement): void {
    this.dialog
      .open<AnnouncementComposeDialogComponent, AnnouncementComposeData, AnnouncementComposeResult>(AnnouncementComposeDialogComponent, {
        width: '1040px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
        data: { announcement: draft },
      })
      .afterClosed()
      .subscribe((res) => {
        if (!res) return;
        const a = res.announcement;
        const text =
          res.action === 'draft'
            ? `Draft ${a.id} saved. It won't be sent until you publish it.`
            : res.action === 'scheduled'
              ? `${a.id} scheduled for ${this.fmt.date(a.publishAt!, 'datetime')}.`
              : `${a.id} published to ${this.recipientCount(a)} resident(s).`;
        this.snackBar.open(text, 'View', { duration: 4500 }).onAction().subscribe(() => this.openView(a));
      });
  }

  openView(a: Announcement): void {
    this.dialog
      .open<AnnouncementViewDialogComponent, AnnouncementViewData, AnnouncementViewAction>(AnnouncementViewDialogComponent, {
        width: '880px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { id: a.id },
      })
      .afterClosed()
      .subscribe((action) => {
        if (action === 'edit') this.openCompose(a);
        if (action === 'duplicate') this.duplicate(a);
        if (action === 'cancel') this.cancelScheduled(a);
        if (action === 'delete') this.deleteDraft(a);
      });
  }

  cancelScheduled(a: Announcement): void {
    this.confirm
      .confirm({
        title: 'Cancel scheduled announcement?',
        message: `"${a.title}" will not be sent. You can duplicate it later to schedule it again.`,
        confirmLabel: 'Cancel Announcement',
        cancelLabel: 'Keep',
        danger: true,
        icon: 'event_busy',
        details: [{ icon: 'schedule', label: 'Scheduled for', value: this.fmt.date(a.publishAt!, 'datetime') }],
      })
      .subscribe((ok) => ok && this.run(() => this.service.cancel(a.id), `${a.id} cancelled.`));
  }

  deleteDraft(a: Announcement): void {
    this.confirm
      .confirm({ title: 'Delete draft?', message: `"${a.title}" will be removed permanently.`, confirmLabel: 'Delete', danger: true, icon: 'delete' })
      .subscribe((ok) => ok && this.run(() => this.service.delete(a.id), 'Draft deleted.'));
  }

  duplicate(a: Announcement): void {
    try {
      const copy = this.service.duplicate(a.id);
      this.snackBar.open(`Copied as draft ${copy.id}.`, 'Edit', { duration: 4500 }).onAction().subscribe(() => this.openCompose(copy));
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Could not duplicate the announcement.', 'Close', { duration: 4500 });
    }
  }

  private run(action: () => unknown, success: string): void {
    try {
      action();
      this.snackBar.open(success, 'Close', { duration: 3500 });
    } catch (err: any) {
      this.snackBar.open(err?.message ?? 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }

  /** Scheduled: soonest first. Everything else: most recent publish / edit first. */
  private compareDates(a: Announcement, b: Announcement): number {
    const key = (x: Announcement) => (x.status === 'Draft' ? x.updatedAt : x.publishAt ?? x.updatedAt);
    return this.status(a) === 'Scheduled' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a));
  }
}
