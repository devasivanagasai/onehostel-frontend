import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantRoomTransferService } from '../../../core/services/tenant-room-transfer.service';
import { RoomTransferRequest, TransferEligibility } from '../../../core/models/tenant-room-transfer.models';
import { RoomType } from '../../../core/models/rooms.models';
import { localDateIso } from '../../../shared/utils/local-date';
import { errMsg, fmtDate, fmtDateTime, toneOf } from '../guardians/tn-ui';

@Component({
  selector: 'app-tenant-room-transfer',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  styleUrl: './tenant-room-transfer.component.scss',
  template: `
    <div class="tn-page">
      @if (message) { <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div> }
      @if (actionError) { <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div> }

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading room transfer"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else {
        <section class="tn-card" aria-label="Current room">
          <h2>My current room</h2>
          @if (current) {
            <dl class="tn-kv">
              <div><dt>Room and bed</dt><dd>{{ current.label }}</dd></div>
              <div><dt>Room type</dt><dd>{{ current.roomType }}</dd></div>
              <div><dt>Since</dt><dd>{{ date(current.since) }}</dd></div>
            </dl>
          } @else {
            <p class="tn-sub" role="status">You do not have a bed at the moment.</p>
          }
          <p class="tn-sub">You cannot change your room yourself. A transfer only happens after the hostel office approves and completes it.</p>
        </section>

        <section class="tn-card" aria-label="Request a transfer">
          <h2>Request a room transfer</h2>
          @if (!gate.ok) {
            <div class="tn-banner tn-banner--warn" role="status"><mat-icon aria-hidden="true">block</mat-icon><div>{{ gate.reason }}</div></div>
          } @else {
            <form (ngSubmit)="submit()" class="tn-form" novalidate>
              <div class="tn-field">
                <label for="rt-type">Preferred room type (optional)</label>
                <select id="rt-type" name="type" [(ngModel)]="form.preferredRoomType" [attr.aria-invalid]="!!errors['preferredRoomType']">
                  <option value="">No preference</option>
                  @for (t of roomTypes; track t) { <option [value]="t">{{ t }}</option> }
                </select>
                @if (errors['preferredRoomType']) { <span class="tn-err" role="alert">{{ errors['preferredRoomType'] }}</span> }
              </div>
              <div class="tn-field">
                <label for="rt-date">Requested move date</label>
                <input id="rt-date" type="date" name="date" [(ngModel)]="form.requestedDate" [min]="today" [max]="maxDate" required [attr.aria-invalid]="!!errors['requestedDate']" />
                @if (errors['requestedDate']) { <span class="tn-err" role="alert">{{ errors['requestedDate'] }}</span> } @else { <span class="tn-hint">Today or up to 90 days ahead.</span> }
              </div>
              <div class="tn-field tn-wide">
                <label for="rt-reason">Reason ({{ limits.reasonMin }}-{{ limits.reasonMax }} characters)</label>
                <textarea id="rt-reason" name="reason" [(ngModel)]="form.reason" [maxlength]="limits.reasonMax" rows="3" required [attr.aria-invalid]="!!errors['reason']"></textarea>
                @if (errors['reason']) { <span class="tn-err" role="alert">{{ errors['reason'] }}</span> }
              </div>
              <div class="tn-field tn-wide">
                <label for="rt-note">Supporting note (optional, up to {{ limits.noteMax }})</label>
                <textarea id="rt-note" name="note" [(ngModel)]="form.note" [maxlength]="limits.noteMax" rows="2" [attr.aria-invalid]="!!errors['note']"></textarea>
                @if (errors['note']) { <span class="tn-err" role="alert">{{ errors['note'] }}</span> }
              </div>
              <div class="tn-wide"><button type="submit" class="tn-btn"><mat-icon aria-hidden="true">swap_horiz</mat-icon>Send request</button></div>
            </form>
          }
        </section>

        <section class="tn-card" aria-label="My requests">
          <h2>My requests</h2>
          @if (!requests.length) {
            <div class="tn-state" role="status"><mat-icon aria-hidden="true">swap_horiz</mat-icon><p>You have not made any transfer requests.</p></div>
          } @else {
            <ul class="tn-list">
              @for (r of requests; track r.id) {
                <li>
                  <div class="tn-row tn-row--between">
                    <strong>{{ r.id }} · from {{ r.fromLabel }}</strong>
                    <span class="tn-pill tn-pill--{{ tone(r.status) }}">{{ r.status }}</span>
                  </div>
                  <div class="tn-sub">Requested for {{ date(r.requestedDate) }}@if (r.preferredRoomType) { · prefers {{ r.preferredRoomType }} } · sent {{ dateTime(r.createdAt) }}</div>
                  <p style="margin:6px 0 0">{{ r.reason }}</p>
                  @if (r.note) { <div class="tn-sub">Note: {{ r.note }}</div> }
                  @if (r.decisionRemark) { <div class="tn-banner" style="margin-top:6px"><mat-icon aria-hidden="true">forum</mat-icon><div><strong>Hostel office:</strong> {{ r.decisionRemark }}</div></div> }
                  @if (r.toLabel) { <div class="tn-sub">Moved to {{ r.toLabel }} on {{ date(r.completedAt) }}</div> }
                  <details style="margin-top:6px"><summary class="tn-sub" style="cursor:pointer">Progress</summary>
                    <ul class="tn-list">@for (h of r.history; track $index) { <li class="tn-sub">{{ dateTime(h.at) }} · {{ h.by }} · {{ h.action }}@if (h.note) { ({{ h.note }}) }</li> }</ul>
                  </details>
                  @if (r.status === 'Submitted' || r.status === 'Under Review') {
                    <button type="button" class="tn-btn tn-btn--danger" style="margin-top:8px" (click)="cancel(r)">Cancel request</button>
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
})
export class TenantRoomTransferComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantRoomTransferService);
  readonly roomTypes = this.service.roomTypes;
  readonly limits = this.service.limits;
  readonly tone = toneOf;
  readonly date = fmtDate;
  readonly dateTime = fmtDateTime;
  readonly today = localDateIso();
  readonly maxDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + this.service.limits.maxDaysAhead);
    return localDateIso(d);
  })();

  requests: RoomTransferRequest[] = [];
  current: { label: string; roomType: RoomType; since?: string } | undefined;
  gate: TransferEligibility = { ok: true, reason: '' };
  form: { preferredRoomType: RoomType | ''; requestedDate: string; reason: string; note: string } = { preferredRoomType: '', requestedDate: '', reason: '', note: '' };
  errors: Record<string, string> = {};
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  private subs = new Subscription();

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subs.unsubscribe();
    this.subs = new Subscription();
    setTimeout(() => {
      try {
        this.subs.add(this.service.mine$.subscribe((r) => { this.requests = r; this.gate = this.service.eligibility(); }));
        this.subs.add(this.service.current$.subscribe((c) => { this.current = c; this.gate = this.service.eligibility(); }));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  submit(): void {
    this.message = '';
    this.actionError = '';
    this.errors = this.service.validate(this.form);
    if (Object.keys(this.errors).length) return;
    try {
      const r = this.service.submit(this.form);
      this.message = `Request ${r.id} was sent. You will be notified when the hostel office decides.`;
      this.form = { preferredRoomType: '', requestedDate: '', reason: '', note: '' };
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  cancel(r: RoomTransferRequest): void {
    this.message = '';
    this.actionError = '';
    try {
      this.service.cancel(r.id);
      this.message = `Request ${r.id} was cancelled.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }
}
