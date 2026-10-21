import { Component, Input, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HostelSettingsService } from './hostel-settings.service';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NotificationChannel } from './hostel-settings.models';

/** Notifications: event × channel matrix. Unavailable channels are locked; each event keeps one channel on. */
@Component({
  selector: 'app-hs-notifications-section',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatSlideToggleModule, MatTooltipModule],
  template: `
    <div class="nt-table" [formGroup]="group" role="table" aria-label="Notification preferences">
      <div class="nt-row nt-row--head" role="row">
        <span role="columnheader">Event</span>
        @for (c of channels; track c.key) {
          @let reason = blockedReason(c.key);
          <span role="columnheader" class="nt-ch" [class.is-off]="reason">
            <mat-icon fontSet="material-icons-outlined">{{ c.icon }}</mat-icon>{{ c.label }}
            @if (reason) { <small>{{ reason }}</small> }
          </span>
        }
      </div>
      @for (e of events; track e.key) {
        <div class="nt-row" role="row" [formGroupName]="e.key" [class.is-invalid]="group.get(e.key)?.invalid">
          <span role="cell" class="nt-event">
            <strong>{{ e.label }}</strong>
            @if (group.get(e.key)?.invalid) {
              <small class="nt-error">Keep at least one channel on</small>
            } @else {
              <small>{{ e.description }}</small>
            }
          </span>
          @for (c of channels; track c.key) {
            <span role="cell" class="nt-cell" [matTooltip]="blockedReason(c.key) ?? ''">
              <mat-slide-toggle [formControlName]="c.key" [attr.aria-label]="e.label + ' via ' + c.label" hideIcon></mat-slide-toggle>
            </span>
          }
        </div>
      }
    </div>
    <p class="nt-foot">
      <mat-icon fontSet="material-icons-outlined">info</mat-icon>
      Required: every event needs at least one channel. Channels are offered by the OneHostel platform and your plan; SMS and others can be added through a plan upgrade.
    </p>
  `,
  styleUrl: './notifications-section.component.scss',
})
export class NotificationsSectionComponent {
  private readonly service = inject(HostelSettingsService);

  @Input({ required: true }) group!: FormGroup;

  readonly channels = NOTIFICATION_CHANNELS;
  readonly events = NOTIFICATION_EVENTS;

  blockedReason(channel: NotificationChannel): string | null {
    return this.service.channelBlockedReason(channel);
  }
}
