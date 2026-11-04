import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { localDateIso } from '../../../shared/utils/local-date';
import {
  AttendanceCorrectionRequest,
  AttendanceService,
  CORRECTION_REASON_MAX,
  CORRECTION_REASON_MIN,
  CORRECTION_WINDOW_DAYS,
  TenantAttendanceRow,
  TenantAttendanceSummary,
} from '../../attendance/attendance.service';
import { METHOD_LABELS, STATUS_TONES } from '../../attendance/attendance.models';
import { periodLabel } from '../../mess/mess.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase } from '../daily-kit/tenant-page.base';

const CORRECTION_TONES: Record<string, string> = { Open: 'warning', Accepted: 'success', Declined: 'danger', Withdrawn: 'neutral' };

@Component({
  selector: 'app-tenant-attendance',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading your attendance..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }

        <div class="td-filters">
          <label for="at-month" class="td-label" style="font-size: 13px; font-weight: 600;">Month</label>
          <select id="at-month" [ngModel]="month" (ngModelChange)="setMonth($event)">
            @for (m of months; track m) { <option [value]="m">{{ monthLabel(m) }}</option> }
          </select>
          <span class="td-hint">You can view the current month and the last 12 months.</span>
        </div>

        <section class="td-grid" aria-label="Monthly summary" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));">
          @for (s of summaryItems; track s.label) {
            <div class="td-card" style="padding: 14px 16px;">
              <div class="td-small td-muted">{{ s.label }}</div>
              <div style="font-size: 26px; font-weight: 700;">{{ s.value }}</div>
            </div>
          }
        </section>

        <section class="td-card" aria-labelledby="at-hist">
          <h3 id="at-hist">Attendance for {{ monthLabel(month) }}</h3>
          <p class="td-card__sub">This is the official record kept by the hostel. You cannot edit it, but you can ask for a correction.</p>
          @if (!rows.length) {
            <app-empty-state icon="fact_check" message="No days to show" hint="There are no attendance days in this month yet."></app-empty-state>
          } @else {
            <div class="td-table-wrap">
              <table class="td-table">
                <caption class="sr-only">Attendance history</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th><th scope="col">Status</th><th scope="col">Check-in</th><th scope="col">Check-out</th>
                    <th scope="col">Recorded by</th><th scope="col">Approved leave (not proof of absence)</th><th scope="col">Query</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows; track r.date) {
                    <tr>
                      <th scope="row" class="nowrap">{{ fmt.date(r.date, 'dayDate') }}</th>
                      <td><span class="td-pill td-pill--{{ tone(r.status) }}">{{ r.status }}</span></td>
                      <td class="nowrap">{{ r.checkIn ? fmt.date(r.checkIn, 'time') : '-' }}@if (r.sessions.length > 1) { <span class="td-small td-muted"> ({{ r.sessions.length }} stays)</span> }</td>
                      <td class="nowrap">{{ r.checkOut ? fmt.date(r.checkOut, 'time') : (r.checkIn ? 'Still in' : '-') }}</td>
                      <td>{{ r.method ? methodLabel(r.method) : '-' }}</td>
                      <td>
                        @if (r.leave; as l) {
                          <span class="td-pill td-pill--warning">{{ l.type }} {{ l.id }}</span>
                          <div class="td-small td-muted">{{ r.physicallyOut ? 'Gate records show you were out all day' : (l.movement ? 'Movement: ' + l.movement : 'No exit recorded') }}</div>
                        } @else { <span class="td-muted">-</span> }
                      </td>
                      <td>
                        @if (r.openCorrection; as c) {
                          <span class="td-pill td-pill--warning">Query {{ c.id }} open</span>
                        } @else if (canQuery(r)) {
                          <app-button variant="text" size="sm" icon="help_outline" (clicked)="queryDate(r.date)">Request correction</app-button>
                        } @else { <span class="td-muted">-</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <div class="td-split">
          <section class="td-card" aria-labelledby="at-corr" #corrCard>
            <h3 id="at-corr">Request a correction</h3>
            <p class="td-card__sub">If a day looks wrong, tell the hostel office. Only staff can change the record. Available for the last {{ windowDays }} days; one open request per date.</p>
            <form class="td-form" (ngSubmit)="submitCorrection()" novalidate>
              <div class="td-field td-field--wide">
                <label for="at-cdate">Date <span class="td-req" aria-hidden="true">*</span></label>
                <select id="at-cdate" name="date" [(ngModel)]="corrDate" [attr.aria-invalid]="!!corrErrors['date']">
                  <option value="">Select a date</option>
                  @for (o of dateOptions; track o.date) { <option [value]="o.date" [disabled]="o.open">{{ fmt.date(o.date, 'dayDate') }}{{ o.open ? ' (query already open)' : '' }}</option> }
                </select>
                @if (corrErrors['date']) { <p class="td-err" role="alert">{{ corrErrors['date'] }}</p> }
              </div>
              <div class="td-field td-field--wide">
                <label for="at-creason">What is wrong? <span class="td-req" aria-hidden="true">*</span></label>
                <textarea id="at-creason" name="reason" [maxlength]="reasonMax" [(ngModel)]="corrReason" [attr.aria-invalid]="!!corrErrors['reason']"></textarea>
                <span class="td-hint">At least {{ reasonMin }} characters &middot; {{ corrReason.trim().length }}/{{ reasonMax }}</span>
                @if (corrErrors['reason']) { <p class="td-err" role="alert">{{ corrErrors['reason'] }}</p> }
              </div>
              @if (actionError) {
                <div class="td-banner td-banner--bad" style="grid-column: 1 / -1;" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
              }
              <div class="td-actions" style="grid-column: 1 / -1;">
                <app-button type="submit" icon="send" [loading]="busy">Send request</app-button>
              </div>
            </form>
          </section>

          <section class="td-card" aria-labelledby="at-mine">
            <h3 id="at-mine">My correction requests</h3>
            @if (!corrections.length) {
              <app-empty-state icon="rule" message="No correction requests" hint="Requests you send will be listed here with the hostel's answer."></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (c of corrections; track c.id) {
                  <li class="td-row">
                    <div class="td-row__main">
                      <div class="td-row__title">{{ fmt.date(c.date, 'dayDate') }} <span class="td-small td-muted">{{ c.id }}</span></div>
                      <div class="td-row__sub">{{ c.reason }}</div>
                      <div class="td-row__meta">
                        <span>Record said: {{ c.recordedStatus }}</span>
                        <span>Sent {{ dt(c.createdAt) }}</span>
                      </div>
                      @if (c.status !== 'Open' && c.status !== 'Withdrawn') {
                        <div class="td-row__sub"><strong>{{ c.status === 'Accepted' ? 'Accepted' : 'Declined' }}</strong>{{ c.decidedBy ? ' by ' + c.decidedBy : '' }}{{ c.decidedAt ? ', ' + dt(c.decidedAt) : '' }}{{ c.decisionNote ? ': ' + c.decisionNote : '' }}</div>
                      }
                    </div>
                    <div class="td-row__side">
                      <span class="td-pill td-pill--{{ corrTone(c.status) }}">{{ c.status }}</span>
                      @if (c.status === 'Open') { <app-button variant="danger-outline" size="sm" icon="undo" (clicked)="withdraw(c)">Withdraw</app-button> }
                    </div>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </app-tenant-state>
    </div>
  `,
})
export class TenantAttendanceComponent extends TenantPageBase {
  readonly service = inject(AttendanceService);
  @ViewChild('corrCard', { read: ElementRef }) corrCard?: ElementRef<HTMLElement>;

  readonly windowDays = CORRECTION_WINDOW_DAYS;
  readonly reasonMin = CORRECTION_REASON_MIN;
  readonly reasonMax = CORRECTION_REASON_MAX;

  months: string[] = [];
  month = localDateIso().slice(0, 7);
  rows: TenantAttendanceRow[] = [];
  summary: TenantAttendanceSummary = { Present: 0, Absent: 0, 'On Leave': 0, 'Not Expected': 0, Unknown: 0 };
  summaryItems: { label: string; value: number }[] = [];
  corrections: AttendanceCorrectionRequest[] = [];
  dateOptions: { date: string; open: boolean }[] = [];
  corrDate = '';
  corrReason = '';
  corrErrors: Record<string, string> = {};

  constructor() {
    super();
    this.watch(this.service.records$, this.service.corrections$);
    this.start();
  }

  protected refresh(): void {
    this.months = this.service.tenantMonths();
    if (!this.months.includes(this.month)) this.month = this.months[0];
    this.rows = this.service.tenantHistory(this.month);
    this.summary = this.service.tenantSummary(this.rows);
    this.summaryItems = [
      { label: 'Present', value: this.summary.Present },
      { label: 'Absent', value: this.summary.Absent },
      { label: 'On Leave', value: this.summary['On Leave'] },
      { label: 'Not Expected', value: this.summary['Not Expected'] },
      { label: 'Unknown (not recorded)', value: this.summary.Unknown },
    ];
    this.corrections = this.service.tenantCorrections();
    const open = new Set(this.corrections.filter((c) => c.status === 'Open').map((c) => c.date));
    const today = new Date();
    this.dateOptions = Array.from({ length: CORRECTION_WINDOW_DAYS + 1 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const date = localDateIso(d);
      return { date, open: open.has(date) };
    });
  }

  setMonth(m: string): void {
    this.month = m;
    this.clearFeedback();
    this.run();
  }

  monthLabel(m: string): string {
    return periodLabel(m);
  }

  tone(s: string): string {
    return STATUS_TONES[s as keyof typeof STATUS_TONES] ?? 'neutral';
  }

  corrTone(s: string): string {
    return CORRECTION_TONES[s] ?? 'neutral';
  }

  methodLabel(m: keyof typeof METHOD_LABELS): string {
    return METHOD_LABELS[m];
  }

  /** Whether a correction can be requested for the day (inside the window, expected, nothing open). */
  canQuery(r: TenantAttendanceRow): boolean {
    return r.status !== 'Not Expected' && !this.service.correctionError(r.date, 'x'.repeat(CORRECTION_REASON_MIN));
  }

  queryDate(date: string): void {
    this.corrDate = date;
    this.corrErrors = {};
    this.clearFeedback();
    this.corrCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  submitCorrection(): void {
    if (this.busy) return;
    this.clearFeedback();
    this.corrErrors = {};
    if (!this.corrDate) this.corrErrors['date'] = 'Select a date';
    const reason = this.corrReason.trim();
    if (reason.length < this.reasonMin) this.corrErrors['reason'] = `Give a reason of at least ${this.reasonMin} characters`;
    if (Object.keys(this.corrErrors).length) return;
    this.busy = true;
    try {
      const c = this.service.createCorrectionRequest({ date: this.corrDate, reason: this.corrReason });
      this.corrDate = '';
      this.corrReason = '';
      this.run();
      this.done(`Request ${c.id} sent. The hostel office will review ${this.d(c.date)}.`);
    } catch (e) {
      this.failed(e);
    } finally {
      this.busy = false;
    }
  }

  withdraw(c: AttendanceCorrectionRequest): void {
    this.clearFeedback();
    try {
      this.service.withdrawCorrectionRequest(c.id);
      this.run();
      this.done(`Request ${c.id} was withdrawn.`);
    } catch (e) {
      this.failed(e);
      this.run();
    }
  }
}
