import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { localDateIso } from '../../../shared/utils/local-date';
import { BOOKING_WINDOW_DAYS, LaundryService, NO_SHOW_POLICY, TENANT_CANCEL_CUTOFF_HOURS, TenantBookingSummary, TenantLaundryReminder, TenantSlot } from '../../laundry/laundry.service';
import { BOOKING_TONES, LaundryBooking, LaundryUnit, addDays } from '../../laundry/laundry.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase, localMinute } from '../daily-kit/tenant-page.base';

type Tab = 'book' | 'mine' | 'reminders';

const PAYMENT_TONES: Record<string, string> = { 'Not Required': 'neutral', Unpaid: 'warning', Paid: 'success', Refunded: 'info' };

@Component({
  selector: 'app-tenant-laundry',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <div class="td-tabs" role="tablist" aria-label="Laundry sections">
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'book'" [attr.aria-selected]="tab === 'book'" (click)="tab = 'book'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">add_circle</mat-icon> Book a slot
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'mine'" [attr.aria-selected]="tab === 'mine'" (click)="tab = 'mine'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">event_note</mat-icon> My bookings <span class="td-count">{{ upcoming.length + past.length }}</span>
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'reminders'" [attr.aria-selected]="tab === 'reminders'" (click)="tab = 'reminders'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">notifications_active</mat-icon> Reminders <span class="td-count">{{ reminders.length }}</span>
        </button>
      </div>

      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading laundry services..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }
        @if (actionError && tab !== 'book') {
          <div class="td-banner td-banner--bad" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
        }

        <!-- ================= BOOK ================= -->
        @if (tab === 'book') {
          @if (!units.length) {
            <div class="td-card">
              <app-empty-state icon="local_laundry_service" message="No laundry services yet" hint="Your hostel has not set up any machines or laundry services."></app-empty-state>
            </div>
          } @else {
            <div class="td-split">
              <section class="td-card" aria-labelledby="ld-pick">
                <h3 id="ld-pick">1. Choose a machine or service</h3>
                <div class="td-grid" role="radiogroup" aria-label="Machine or service">
                  @for (u of units; track u.id) {
                    <button type="button" class="td-row" role="radio" [attr.aria-checked]="u.id === unitId" [class.is-on]="u.id === unitId"
                      [style.border-color]="u.id === unitId ? '#3f73cd' : ''" [style.background]="u.id === unitId ? '#eaf1fd' : ''"
                      style="text-align: left; cursor: pointer; font: inherit;" (click)="pickUnit(u.id)">
                      <span class="td-row__main">
                        <span class="td-row__title">{{ u.name }}
                          <span class="td-pill" [class.td-pill--warning]="u.state === 'Maintenance'" [class.td-pill--success]="u.state === 'Active'">{{ u.state === 'Active' ? 'Available to book' : 'Under maintenance' }}</span>
                        </span>
                        <span class="td-row__sub">{{ u.type }} &middot; {{ u.location }}</span>
                        <span class="td-row__meta">
                          <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">payments</mat-icon>{{ price(u) }}</span>
                          <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">schedule</mat-icon>{{ u.slotMinutes }} min &middot; {{ clock(u.openTime) }} &ndash; {{ clock(u.closeTime) }}</span>
                        </span>
                        @if (u.state === 'Maintenance') {
                          <span class="td-row__sub">{{ u.maintenanceNote || 'Back soon.' }} Slots are not bookable until it is fixed.</span>
                        }
                      </span>
                    </button>
                  }
                </div>
              </section>

              <section class="td-card" aria-labelledby="ld-slot">
                <h3 id="ld-slot">2. Pick a date and slot</h3>
                @if (unit; as u) {
                  <div class="td-form">
                    <div class="td-field">
                      <label for="ld-date">Date</label>
                      <input id="ld-date" type="date" [min]="today" [max]="maxDate" [ngModel]="date" (ngModelChange)="pickDate($event)" />
                      <span class="td-hint">Bookings open for the next {{ windowDays }} days.</span>
                    </div>
                    @if (u.priceUnit === 'per item') {
                      <div class="td-field">
                        <label for="ld-items">Number of items <span class="td-req" aria-hidden="true">*</span></label>
                        <input id="ld-items" type="number" min="1" step="1" inputmode="numeric" [ngModel]="items" (ngModelChange)="items = $event; summary = null"
                          [attr.aria-invalid]="!!errors['items']" />
                        @if (errors['items']) { <p class="td-err" role="alert">{{ errors['items'] }}</p> }
                      </div>
                    }
                  </div>

                  @if (u.state === 'Maintenance') {
                    <div class="td-banner td-banner--warn"><mat-icon>build</mat-icon><p>{{ u.name }} is under maintenance. No slots can be booked.</p></div>
                  } @else if (dateError) {
                    <div class="td-banner td-banner--warn" role="alert"><mat-icon>event_busy</mat-icon><p>{{ dateError }}</p></div>
                  } @else if (!slots.length) {
                    <div class="td-banner td-banner--warn"><mat-icon>event_busy</mat-icon><p>{{ u.name }} is closed on this day. Open: {{ daysText(u) }}.</p></div>
                  } @else {
                    @if (quota) {
                      <p class="td-hint" style="margin: 12px 0 6px;">You have used {{ quota.used }} of {{ quota.limit }} booking(s) for this {{ quota.period }}.</p>
                    }
                    <div class="td-chips" role="radiogroup" aria-label="Available slots" style="margin-top: 8px;">
                      @for (s of slots; track s.start) {
                        <button type="button" class="td-chip" role="radio" [attr.aria-checked]="slotStart === s.start" [class.is-on]="slotStart === s.start"
                          [disabled]="s.state !== 'Available'" (click)="pickSlot(s)">
                          {{ clock(s.start) }} &ndash; {{ clock(s.end) }}
                          <small>{{ slotLabel(s) }}</small>
                        </button>
                      }
                    </div>
                    @if (!hasFree) {
                      <div class="td-banner td-banner--warn" style="margin-top: 12px;"><mat-icon>event_busy</mat-icon><p>No free slots on this date. Try another day.</p></div>
                    }
                  }

                  @if (errors['slot']) { <p class="td-err" role="alert" style="margin-top: 8px;">{{ errors['slot'] }}</p> }
                  <div class="td-field td-field--wide" style="margin-top: 14px;">
                    <label for="ld-notes">Note for the staff (optional)</label>
                    <input id="ld-notes" type="text" maxlength="120" [(ngModel)]="notes" />
                  </div>
                  @if (actionError) {
                    <div class="td-banner td-banner--bad" role="alert" style="margin-top: 12px;"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
                  }
                  <div class="td-actions">
                    <app-button icon="fact_check" [disabled]="!slotStart" (clicked)="review()">Review booking</app-button>
                  </div>
                }
              </section>
            </div>

            @if (summary; as s) {
              <section class="td-card" aria-labelledby="ld-sum">
                <h3 id="ld-sum">3. Confirm your booking</h3>
                <dl class="td-kv">
                  <dt>Service</dt><dd>{{ s.unit.name }} ({{ s.unit.type }})</dd>
                  <dt>Location</dt><dd>{{ s.unit.location }}</dd>
                  <dt>When</dt><dd>{{ d(s.date) }}, {{ clock(s.start) }} &ndash; {{ clock(s.end) }} ({{ s.durationMinutes }} minutes)</dd>
                  <dt>Price</dt><dd>{{ s.amount > 0 ? money(s.amount) : 'Free' }} <span class="td-muted">&middot; payment status: {{ s.amount > 0 ? 'Unpaid until billed after your slot' : 'Not Required' }}</span></dd>
                  <dt>Result</dt><dd>{{ s.status === 'Confirmed' ? 'Confirmed straight away' : 'Requested - staff will confirm' }}</dd>
                  <dt>Free cancellation until</dt><dd>{{ dt(s.cancelCutoff) }}</dd>
                </dl>
                <ul class="td-hint" style="margin: 12px 0 0; padding-left: 18px;">
                  @for (r of s.rules; track r) { <li>{{ r }}</li> }
                </ul>
                <div class="td-actions">
                  <app-button variant="secondary" (clicked)="summary = null">Change</app-button>
                  <app-button icon="check" [loading]="busy" (clicked)="confirmBooking()">Confirm booking</app-button>
                </div>
              </section>
            }
          }
        }

        <!-- ================= MY BOOKINGS ================= -->
        @if (tab === 'mine') {
          <section class="td-card" aria-labelledby="ld-up">
            <h3 id="ld-up">Upcoming</h3>
            @if (!upcoming.length) {
              <app-empty-state icon="event_available" message="No upcoming bookings" hint="Book a slot from the first tab."></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (b of upcoming; track b.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: b }"></ng-container>
                }
              </ul>
            }
          </section>
          <section class="td-card" aria-labelledby="ld-past">
            <h3 id="ld-past">Past and cancelled</h3>
            @if (!past.length) {
              <app-empty-state icon="history" message="Nothing here yet" hint="Completed, cancelled and missed bookings appear here."></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (b of past; track b.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: b }"></ng-container>
                }
              </ul>
            }
          </section>
          <p class="td-hint">{{ noShowPolicy }}</p>
        }

        <ng-template #row let-b>
          <li class="td-row">
            <div class="td-row__main">
              <div class="td-row__title">{{ unitName(b) }} <span class="td-small td-muted">{{ b.id }}</span></div>
              <div class="td-row__sub">{{ d(b.date) }}, {{ clock(b.start) }} &ndash; {{ clock(b.end) }}{{ b.items ? ' · ' + b.items + ' items' : '' }}</div>
              <div class="td-row__meta">
                <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">payments</mat-icon>{{ b.amount > 0 ? money(b.amount) : 'Free' }}</span>
                @if (b.notes) { <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">notes</mat-icon>{{ b.notes }}</span> }
              </div>
              @if (b.status === 'Cancelled' && b.cancelReason) { <div class="td-row__sub">Reason: {{ b.cancelReason }}</div> }
              @if (b.status === 'No-show') { <div class="td-row__sub">Marked as a no-show. {{ noShowPolicy }}</div> }
              @if (b.status === 'Requested') { <div class="td-row__sub">Waiting for staff to confirm.</div> }
              @if (isOpen(b)) {
                <div class="td-row__sub">{{ blocker(b) ? blocker(b) : 'Free cancellation until ' + dt(cutoff(b)) + '.' }}</div>
              }
            </div>
            <div class="td-row__side">
              <span class="td-pill td-pill--{{ tone(b.status) }}">{{ b.status }}</span>
              <span class="td-pill td-pill--{{ payTone(payment(b)) }}" [attr.title]="'Payment status'">Payment: {{ payment(b) }}</span>
              @if (isOpen(b)) {
                <app-button variant="danger-outline" size="sm" icon="event_busy" [disabled]="!!blocker(b)" (clicked)="cancel(b)">Cancel booking</app-button>
              }
            </div>
          </li>
        </ng-template>

        <!-- ================= REMINDERS ================= -->
        @if (tab === 'reminders') {
          <section class="td-card" aria-labelledby="ld-rem">
            <h3 id="ld-rem">Reminders and notices</h3>
            <p class="td-card__sub">Upcoming bookings in the next 48 hours, and any booking the hostel had to cancel.</p>
            @if (!reminders.length) {
              <app-empty-state icon="notifications_none" message="No reminders" hint="You have no booking in the next 48 hours and no cancellation notices."></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (r of reminders; track r.bookingId + r.kind + r.at) {
                  <li class="td-banner" [class.td-banner--warn]="r.kind === 'Notice'">
                    <mat-icon fontSet="material-icons-outlined">{{ r.kind === 'Notice' ? 'info' : 'alarm' }}</mat-icon>
                    <p>{{ r.message }}</p>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </app-tenant-state>
    </div>
  `,
})
export class TenantLaundryComponent extends TenantPageBase {
  readonly service = inject(LaundryService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly noShowPolicy = NO_SHOW_POLICY;
  readonly cutoffHours = TENANT_CANCEL_CUTOFF_HOURS;
  readonly windowDays = BOOKING_WINDOW_DAYS;

  tab: Tab = 'book';
  units: LaundryUnit[] = [];
  unitId = '';
  today = localDateIso();
  maxDate = addDays(localDateIso(), BOOKING_WINDOW_DAYS);
  date = localDateIso();
  slots: TenantSlot[] = [];
  slotStart = '';
  items: number | null = null;
  notes = '';
  quota: { used: number; limit: number; period: 'day' | 'week' } | null = null;
  summary: TenantBookingSummary | null = null;
  errors: Record<string, string> = {};
  dateError = '';

  upcoming: LaundryBooking[] = [];
  past: LaundryBooking[] = [];
  reminders: TenantLaundryReminder[] = [];

  constructor() {
    super();
    this.watch(this.service.stats$);
    this.start();
  }

  get unit(): LaundryUnit | undefined {
    return this.units.find((u) => u.id === this.unitId);
  }

  get hasFree(): boolean {
    return this.slots.some((s) => s.state === 'Available');
  }

  protected refresh(): void {
    this.today = localDateIso();
    this.maxDate = addDays(this.today, BOOKING_WINDOW_DAYS);
    this.units = this.service.tenantUnits();
    if (!this.units.some((u) => u.id === this.unitId)) this.unitId = (this.units.find((u) => u.state === 'Active') ?? this.units[0])?.id ?? '';
    this.loadSlots();
    const now = localMinute();
    const mine = this.service.tenantBookings();
    this.upcoming = mine.filter((b) => (b.status === 'Requested' || b.status === 'Confirmed') && `${b.date}T${b.end}` >= now).reverse();
    this.past = mine.filter((b) => !this.upcoming.includes(b));
    this.reminders = this.service.tenantReminders();
  }

  private loadSlots(): void {
    this.slots = [];
    this.quota = null;
    this.dateError = '';
    if (!this.unitId) return;
    if (this.date < this.today || this.date > this.maxDate) {
      this.dateError = `Pick a date between today and ${this.d(this.maxDate)}.`;
      return;
    }
    this.slots = this.service.tenantSlots(this.unitId, this.date);
    this.quota = this.service.tenantQuota(this.unitId, this.date);
    if (this.slotStart && !this.slots.some((s) => s.start === this.slotStart && s.state === 'Available')) {
      this.slotStart = '';
      this.summary = null;
    }
  }

  pickUnit(id: string): void {
    this.unitId = id;
    this.slotStart = '';
    this.summary = null;
    this.errors = {};
    this.clearFeedback();
    this.loadSlots();
  }

  pickDate(value: string): void {
    this.date = value || this.today;
    this.slotStart = '';
    this.summary = null;
    this.clearFeedback();
    this.loadSlots();
  }

  pickSlot(s: TenantSlot): void {
    if (s.state !== 'Available') return;
    this.slotStart = s.start;
    this.summary = null;
    this.errors = {};
    this.clearFeedback();
  }

  slotLabel(s: TenantSlot): string {
    switch (s.state) {
      case 'Available': return '1 left';
      case 'Full': return 'Full';
      case 'Maintenance': return 'Maintenance';
      case 'Past': return 'Started';
      case 'Yours': return 'Your booking';
      default: return 'Clashes with your booking';
    }
  }

  review(): void {
    this.clearFeedback();
    this.errors = {};
    const u = this.unit;
    if (!u) return;
    if (!this.slotStart) this.errors['slot'] = 'Pick a slot.';
    if (u.priceUnit === 'per item' && !(Number.isInteger(this.items) && (this.items as number) >= 1)) this.errors['items'] = 'Enter the number of items as a whole number.';
    if (Object.keys(this.errors).length) return;
    try {
      this.summary = this.service.tenantBookingSummary({ unitId: u.id, date: this.date, start: this.slotStart, items: this.items ?? undefined });
    } catch (e) {
      this.failed(e);
    }
  }

  confirmBooking(): void {
    const s = this.summary;
    if (!s || this.busy) return;
    this.busy = true;
    try {
      const b = this.service.tenantBook({ unitId: s.unit.id, date: s.date, start: s.start, items: this.items ?? undefined, notes: this.notes });
      this.summary = null;
      this.slotStart = '';
      this.notes = '';
      this.items = null;
      this.run();
      this.tab = 'mine';
      this.done(`Booking ${b.id} is ${b.status.toLowerCase()}: ${s.unit.name}, ${this.d(b.date)} at ${this.clock(b.start)}.`);
    } catch (e) {
      this.failed(e);
      this.run();
    } finally {
      this.busy = false;
    }
  }

  cancel(b: LaundryBooking): void {
    this.clearFeedback();
    this.confirmDialog
      .confirm({
        title: 'Cancel this booking?',
        message: `${this.unitName(b)} on ${this.d(b.date)} at ${this.clock(b.start)} will be cancelled and the slot freed for others.`,
        confirmLabel: 'Cancel booking',
        cancelLabel: 'Keep booking',
        danger: true,
        details: [{ icon: 'payments', label: 'Cancellation fee', value: 'None - free before the cut-off' }],
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          this.service.tenantCancel(b.id);
          this.run();
          this.done(`Booking ${b.id} was cancelled.`);
        } catch (e) {
          this.failed(e);
          this.run();
        }
      });
  }

  unitName(b: LaundryBooking): string {
    return this.service.unit(b.unitId)?.name ?? b.unitId;
  }

  price(u: LaundryUnit): string {
    return u.price > 0 ? `${this.money(u.price)} ${u.priceUnit}` : 'Free';
  }

  daysText(u: LaundryUnit): string {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((_, i) => u.days.includes(i)).join(', ');
  }

  isOpen(b: LaundryBooking): boolean {
    return b.status === 'Requested' || b.status === 'Confirmed';
  }

  blocker(b: LaundryBooking): string {
    return this.service.tenantCancelBlocker(b);
  }

  cutoff(b: LaundryBooking): string {
    return this.service.cancelCutoff(b);
  }

  payment(b: LaundryBooking): string {
    return this.service.paymentStatus(b);
  }

  payTone(s: string): string {
    return PAYMENT_TONES[s] ?? 'neutral';
  }

  tone(s: string): string {
    return BOOKING_TONES[s as keyof typeof BOOKING_TONES] ?? 'neutral';
  }
}
