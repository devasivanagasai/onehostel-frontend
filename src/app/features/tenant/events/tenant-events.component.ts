import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { TenantEventView, TenantEventsService } from '../../../core/services/tenant-events.service';
import { EVENT_STATUS_TONES, RSVP_CHOICES, RSVP_TONES, RsvpChoice } from '../../../core/models/tenant-events.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase } from '../daily-kit/tenant-page.base';

type Tab = 'upcoming' | 'past';

@Component({
  selector: 'app-tenant-events',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <div class="td-tabs" role="tablist" aria-label="Event sections">
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'upcoming'" [attr.aria-selected]="tab === 'upcoming'" (click)="tab = 'upcoming'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">event_upcoming</mat-icon> Upcoming <span class="td-count">{{ upcoming.length }}</span>
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'past'" [attr.aria-selected]="tab === 'past'" (click)="tab = 'past'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">history</mat-icon> Past and cancelled <span class="td-count">{{ past.length }}</span>
        </button>
      </div>

      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading events..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }
        @if (actionError) {
          <div class="td-banner td-banner--bad" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
        }

        <section aria-label="Events">
          @if (shown.length === 0) {
            <div class="td-card">
              <app-empty-state icon="event" [message]="tab === 'upcoming' ? 'No upcoming events' : 'No past events'"
                [hint]="tab === 'upcoming' ? 'Events published by the hostel will appear here.' : 'Finished and cancelled events appear here.'"></app-empty-state>
            </div>
          } @else {
            <ul class="td-list">
              @for (e of shown; track e.id) {
                <li class="td-card">
                  <div class="td-head">
                    <div>
                      <h2 style="font-size: 16px;">{{ e.name }}</h2>
                      <p>{{ dt(e.startAt) }} to {{ sameDay(e) ? fmt.date(e.endAt, 'time') : dt(e.endAt) }}</p>
                    </div>
                    <span class="td-pill td-pill--{{ statusTone(e.status) }}">{{ e.ongoing ? 'Happening now' : e.status }}</span>
                  </div>
                  <p style="margin: 10px 0 0;">{{ e.description }}</p>
                  <div class="td-row__meta">
                    <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">place</mat-icon>{{ e.venue }}</span>
                    <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">person</mat-icon>Organizer: {{ e.organizer }}</span>
                    @if (e.capacity !== undefined) {
                      <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">groups</mat-icon>{{ e.goingCount }} going &middot; {{ e.full ? 'Full' : e.spotsLeft + ' spot(s) left' }}</span>
                    }
                  </div>
                  @if (e.status === 'Cancelled' && e.cancelReason) {
                    <div class="td-banner td-banner--bad" style="margin-top: 10px;"><mat-icon>event_busy</mat-icon><p>Cancelled: {{ e.cancelReason }}</p></div>
                  }
                  <hr class="td-sep" />
                  <div>
                    <div class="td-small" style="margin-bottom: 8px;">
                      <strong>Registration:</strong>
                      @if (!e.registrationOpen) { Not required for this event. }
                      @else if (e.status !== 'Upcoming') { Closed. }
                      @else { {{ e.rsvpBlocker ? 'Closed' : 'Open' }} &middot; deadline {{ dt(e.deadline) }} }
                    </div>
                    @if (e.myRsvp; as r) {
                      <div class="td-small" style="margin-bottom: 8px;">Your RSVP: <span class="td-pill td-pill--{{ rsvpTone(r.choice) }}">{{ r.choice }}</span> <span class="td-muted">updated {{ dt(r.at) }}</span></div>
                    } @else if (e.registrationOpen) {
                      <div class="td-small td-muted" style="margin-bottom: 8px;">You have not answered yet.</div>
                    }
                    @if (e.registrationOpen && e.status === 'Upcoming') {
                      @if (e.rsvpBlocker) {
                        <p class="td-hint" style="margin: 0 0 8px;">{{ e.rsvpBlocker }}</p>
                      }
                      <div class="td-chips" role="group" [attr.aria-label]="'RSVP for ' + e.name">
                        @for (c of choices; track c) {
                          <button type="button" class="td-chip" [class.is-on]="e.myRsvp?.choice === c" [attr.aria-pressed]="e.myRsvp?.choice === c"
                            [disabled]="busy || !canChoose(e, c)" [attr.title]="choiceHint(e, c)" (click)="rsvp(e, c)">
                            {{ c }}
                            @if (c === 'Going' && e.full && e.myRsvp?.choice !== 'Going') { <small>Event full</small> }
                          </button>
                        }
                      </div>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      </app-tenant-state>
    </div>
  `,
})
export class TenantEventsComponent extends TenantPageBase {
  readonly service = inject(TenantEventsService);

  readonly choices = RSVP_CHOICES;

  tab: Tab = 'upcoming';
  upcoming: TenantEventView[] = [];
  past: TenantEventView[] = [];

  constructor() {
    super();
    this.watch(this.service.state$);
    this.start();
  }

  get shown(): TenantEventView[] {
    return this.tab === 'upcoming' ? this.upcoming : this.past;
  }

  protected refresh(): void {
    const { upcoming, past } = this.service.tenantEvents();
    this.upcoming = upcoming;
    this.past = past;
  }

  sameDay(e: TenantEventView): boolean {
    return e.startAt.slice(0, 10) === e.endAt.slice(0, 10);
  }

  statusTone(s: string): string {
    return EVENT_STATUS_TONES[s as keyof typeof EVENT_STATUS_TONES] ?? 'neutral';
  }

  rsvpTone(c: string): string {
    return RSVP_TONES[c as keyof typeof RSVP_TONES] ?? 'neutral';
  }

  /** Whether the button can be used: not blocked by status / deadline, and "Going" only while there is room. */
  canChoose(e: TenantEventView, c: RsvpChoice): boolean {
    return !this.service.rsvpBlocker(e, c) && e.myRsvp?.choice !== c;
  }

  choiceHint(e: TenantEventView, c: RsvpChoice): string {
    return this.service.rsvpBlocker(e, c) || (e.myRsvp?.choice === c ? 'Your current answer' : `Answer ${c}`);
  }

  rsvp(e: TenantEventView, c: RsvpChoice): void {
    if (this.busy) return;
    this.clearFeedback();
    this.busy = true;
    try {
      this.service.rsvp(e.id, c);
      this.run();
      this.done(`RSVP saved: ${c} for ${e.name}.`);
    } catch (err) {
      this.failed(err);
      this.run();
    } finally {
      this.busy = false;
    }
  }
}
