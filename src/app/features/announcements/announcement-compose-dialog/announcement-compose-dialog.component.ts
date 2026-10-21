import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppFormatService } from '../../../core/services/app-format.service';
import { RoomType } from '../../rooms-management/rooms.models';
import { residentFullName } from '../../residents/residents.models';
import { AnnouncementsService, HOSTEL_NAME } from '../announcements.service';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  AUDIENCE_OPTIONS,
  Announcement,
  AnnouncementAttachment,
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementInput,
  AudienceType,
  CHANNELS,
  CHANNEL_ICONS,
  MESSAGE_MAX,
  TITLE_MAX,
  expiryTime,
  formatBytes,
  localIso,
} from '../announcements.models';

export interface AnnouncementComposeData {
  /** Draft being edited; omit for a new announcement. */
  announcement?: Announcement;
}

/** Closes with the saved announcement. */
export interface AnnouncementComposeResult {
  announcement: Announcement;
  action: 'draft' | 'published' | 'scheduled';
}

@Component({
  selector: 'app-announcement-compose-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatTooltipModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './announcement-compose-dialog.component.html',
  styleUrl: './announcement-compose-dialog.component.scss',
})
export class AnnouncementComposeDialogComponent {
  private readonly data = inject<AnnouncementComposeData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(MatDialogRef<AnnouncementComposeDialogComponent, AnnouncementComposeResult>);
  private readonly confirm = inject(ConfirmDialogService);
  readonly service = inject(AnnouncementsService);
  readonly fmt = inject(AppFormatService);

  readonly titleMax = TITLE_MAX;
  readonly messageMax = MESSAGE_MAX;
  readonly attachmentAccept = ATTACHMENT_EXTENSIONS;
  readonly audienceOptions = AUDIENCE_OPTIONS;
  readonly channels = CHANNELS;
  readonly channelIcons = CHANNEL_ICONS;
  readonly hostelName = HOSTEL_NAME;
  readonly formatBytes = formatBytes;

  readonly rooms = this.service.hostelRooms;
  readonly roomTypes = [...new Set(this.rooms.map((r) => r.roomType))];
  readonly residents = this.service.reachableResidents.map((r) => ({
    id: r.residentId,
    name: residentFullName(r),
    location: this.service.location(r.residentId),
  }));

  private readonly existing = this.data?.announcement;
  readonly isEdit = !!this.existing;

  readonly form = inject(FormBuilder).nonNullable.group({
    title: [this.existing?.title ?? '', [Validators.required, Validators.maxLength(TITLE_MAX)]],
    message: [this.existing?.message ?? '', [Validators.required, Validators.maxLength(MESSAGE_MAX)]],
    publishMode: [(this.existing?.publishAt ? 'schedule' : 'now') as 'now' | 'schedule'],
    publishAt: [this.existing?.publishAt?.slice(0, 16) ?? ''],
    expiryDate: [this.existing?.expiryDate ?? ''],
  });

  // Selections live outside the form: they're toggled from chip / checkbox lists.
  audienceType: AudienceType = this.existing?.audience.type ?? 'All';
  roomIds: string[] = [...(this.existing?.audience.roomIds ?? [])];
  selectedRoomTypes: RoomType[] = [...(this.existing?.audience.roomTypes ?? [])];
  residentIds: string[] = [...(this.existing?.audience.residentIds ?? [])];
  selectedChannels: AnnouncementChannel[] = this.existing?.channels.filter((c) => this.service.channelAvailable(c)) ?? ['In-app', 'Push'];
  attachment?: AnnouncementAttachment = this.existing?.attachment;
  attachmentError = '';
  residentSearch = '';

  /** 'publish' after Publish/Schedule was tried, 'draft' after Save Draft — controls which errors show. */
  attempted: '' | 'draft' | 'publish' = '';
  saving = false;
  saveError = '';

  readonly minPublishAt = localIso().slice(0, 16);

  get scheduled(): boolean {
    return this.form.controls.publishMode.value === 'schedule';
  }

  get audience(): AnnouncementAudience {
    return { type: this.audienceType, roomIds: this.roomIds, roomTypes: this.selectedRoomTypes, residentIds: this.residentIds };
  }

  get recipientCount(): number {
    return this.service.recipients(this.audience).length;
  }

  get filteredResidents() {
    const q = this.residentSearch.trim().toLowerCase();
    return q ? this.residents.filter((r) => `${r.name} ${r.id} ${r.location}`.toLowerCase().includes(q)) : this.residents;
  }

  roomOccupants(roomId: string): number {
    return this.service.recipients({ type: 'Rooms', roomIds: [roomId], roomTypes: [], residentIds: [] }).length;
  }

  // ---- Validation (shown once an action was tried) ----------------------------

  get titleError(): string {
    const c = this.form.controls.title;
    if (!this.attempted && !c.touched) return '';
    if (c.hasError('required') || !c.value.trim()) return 'Title is required';
    return c.hasError('maxlength') ? `Keep it under ${TITLE_MAX} characters` : '';
  }

  get messageError(): string {
    const c = this.form.controls.message;
    if (c.hasError('maxlength')) return `Message can't exceed ${MESSAGE_MAX} characters`;
    return this.attempted === 'publish' && !c.value.trim() ? 'Message is required' : '';
  }

  get audienceError(): string {
    if (this.attempted !== 'publish') return '';
    const empty =
      (this.audienceType === 'Rooms' && !this.roomIds.length) ||
      (this.audienceType === 'RoomTypes' && !this.selectedRoomTypes.length) ||
      (this.audienceType === 'Residents' && !this.residentIds.length);
    if (empty) return 'Select at least one';
    return this.recipientCount ? '' : 'No current residents in this audience';
  }

  get channelError(): string {
    return this.attempted === 'publish' && !this.selectedChannels.length ? 'Pick at least one channel' : '';
  }

  get publishAtError(): string {
    if (this.attempted !== 'publish' || !this.scheduled) return '';
    const v = this.form.controls.publishAt.value;
    if (!v) return 'Pick a date and time';
    return new Date(v).getTime() <= Date.now() ? 'Must be in the future' : '';
  }

  get expiryError(): string {
    const v = this.form.controls.expiryDate.value;
    if (!v) return '';
    const publishAt = this.scheduled && this.form.controls.publishAt.value ? new Date(this.form.controls.publishAt.value).getTime() : Date.now();
    return expiryTime(v) <= publishAt ? 'Must follow the publish date' : '';
  }

  /** Earliest allowed expiry date (the publish day). */
  get minExpiry(): string {
    return (this.scheduled && this.form.controls.publishAt.value ? this.form.controls.publishAt.value : this.minPublishAt).slice(0, 10);
  }

  // ---- Selection helpers ------------------------------------------------------

  setAudience(type: AudienceType): void {
    this.audienceType = type;
  }

  toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  toggleChannel(c: AnnouncementChannel): void {
    if (!this.service.channelAvailable(c)) return;
    this.selectedChannels = this.toggle(this.selectedChannels, c);
  }

  selectShownResidents(): void {
    this.residentIds = [...new Set([...this.residentIds, ...this.filteredResidents.map((r) => r.id)])];
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!ATTACHMENT_TYPES.includes(file.type)) {
      this.attachmentError = 'Only PDF, JPG or PNG files are allowed';
    } else if (file.size > ATTACHMENT_MAX_BYTES) {
      this.attachmentError = `File is ${formatBytes(file.size)} — the limit is 5 MB`;
    } else {
      this.attachmentError = '';
      this.attachment = { name: file.name, size: file.size, type: file.type };
    }
  }

  removeAttachment(): void {
    this.attachment = undefined;
    this.attachmentError = '';
  }

  /** Publish time shown in the preview. */
  get previewTime(): string {
    const v = this.form.controls.publishAt.value;
    return this.scheduled && v ? this.fmt.date(v, 'datetime') : 'Just now';
  }

  // ---- Actions ----------------------------------------------------------------

  saveDraft(): void {
    this.attempted = 'draft';
    if (this.titleError || this.messageError) return;
    this.finish(() => this.service.saveDraft(this.input(), this.existing?.id), 'draft');
  }

  publish(): void {
    this.attempted = 'publish';
    this.form.markAllAsTouched();
    if (this.titleError || this.messageError || this.audienceError || this.channelError || this.publishAtError || this.expiryError) return;
    if (this.scheduled) {
      this.finish(() => this.service.publish(this.input(), this.existing?.id), 'scheduled');
      return;
    }
    const n = this.recipientCount;
    this.confirm
      .confirm({
        title: 'Publish now?',
        message: `"${this.form.controls.title.value.trim()}" will be sent to ${n} resident${n === 1 ? '' : 's'} right away.`,
        confirmLabel: 'Publish Now',
        tone: 'success',
        icon: 'campaign',
        details: [
          { icon: 'groups', label: 'Audience', value: this.service.audienceLabel(this.audience) },
          { icon: 'send', label: 'Channels', value: this.selectedChannels.join(', ') },
        ],
      })
      .subscribe((ok) => ok && this.finish(() => this.service.publish(this.input(), this.existing?.id), 'published'));
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private finish(run: () => Announcement, action: AnnouncementComposeResult['action']): void {
    this.saving = true;
    this.saveError = '';
    try {
      this.dialogRef.close({ announcement: run(), action });
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the announcement.';
      this.saving = false;
    }
  }

  private input(): AnnouncementInput {
    const v = this.form.getRawValue();
    const audience: AnnouncementAudience = {
      type: this.audienceType,
      roomIds: this.audienceType === 'Rooms' ? this.roomIds : [],
      roomTypes: this.audienceType === 'RoomTypes' ? this.selectedRoomTypes : [],
      residentIds: this.audienceType === 'Residents' ? this.residentIds : [],
    };
    return {
      title: v.title,
      message: v.message,
      audience,
      channels: this.selectedChannels,
      publishAt: v.publishMode === 'schedule' && v.publishAt ? `${v.publishAt}:00` : undefined,
      expiryDate: v.expiryDate || undefined,
      attachment: this.attachment,
    };
  }
}
