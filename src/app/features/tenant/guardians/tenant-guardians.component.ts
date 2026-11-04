import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { MyGuardianView, GuardianRemovalRequest, REMOVAL_REASON_MAX, REMOVAL_REASON_MIN, TenantGuardianAccessService } from '../../../core/services/tenant-guardian-access.service';
import { ConsentChannel } from '../../../core/models/guardians.models';
import { errMsg, fmtDate, fmtDateTime, toneOf } from './tn-ui';

@Component({
  selector: 'app-tenant-guardians',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  styleUrl: './tenant-guardians.component.scss',
  template: `
    <div class="tn-page">
      <div class="tn-banner" role="note">
        <mat-icon aria-hidden="true">info</mat-icon>
        <div>
          Guardians sign in <strong>separately</strong> to their own view. They only ever see information about <strong>you</strong>, within the access listed below.
          They never see other residents, your complaint details or any disciplinary records.
        </div>
      </div>

      @if (message) {
        <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div>
      }
      @if (actionError) {
        <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div>
      }

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading guardians"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon>
          <p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else if (!guardians.length) {
        <div class="tn-card tn-state" role="status">
          <mat-icon aria-hidden="true">family_restroom</mat-icon>
          <p><strong>No guardian is linked to your account</strong></p>
          <p class="tn-sub">Your hostel office adds guardians. Contact them if a parent or guardian should receive your alerts.</p>
        </div>
      } @else {
        <div class="tn-grid">
          @for (g of guardians; track g.id) {
            <section class="tn-card" [attr.aria-label]="'Guardian ' + g.name">
              <div class="tn-row tn-row--between">
                <div>
                  <h2>{{ g.name }} @if (g.primary) { <span class="tn-pill tn-pill--info">Primary</span> }</h2>
                  <div class="tn-sub">{{ g.relationship }}</div>
                </div>
                <span class="tn-pill tn-pill--{{ tone(g.access.state) }}">Access {{ g.access.state }}</span>
              </div>
              @if (g.access.state === 'Revoked') {
                <p class="tn-sub" role="status">{{ g.access.reason }}</p>
              }
              <dl class="tn-kv">
                <div><dt>Verification</dt><dd><span class="tn-pill tn-pill--{{ tone(g.verification) }}">{{ g.verification }}</span></dd></div>
                <div><dt>Contact on record</dt><dd>{{ g.maskedMobile || g.maskedEmail || '—' }}</dd></div>
                <div><dt>Notified by</dt><dd>{{ g.consent }}</dd></div>
                <div><dt>Consent recorded</dt><dd>{{ date(g.consentDate) }}</dd></div>
              </dl>

              <h3 style="margin-top:14px">What this guardian can see</h3>
              <div class="tn-chip-row">
                @for (s of g.scope; track s) { <span class="tn-pill">{{ s }}</span> }
              </div>

              <h3 style="margin-top:14px">Alerts they receive</h3>
              <ul class="tn-list">
                @for (a of g.alerts; track a.kind) {
                  <li class="tn-row tn-row--between">
                    <span>{{ a.kind }}</span>
                    @if (a.willReceive) { <span class="tn-pill tn-pill--success">Will be alerted</span> }
                    @else { <span class="tn-pill" [attr.title]="a.blocker">Not alerted · {{ a.blocker }}</span> }
                  </li>
                }
              </ul>

              <div class="tn-field" style="margin-top:14px">
                <label [for]="'consent-' + g.id">Notify this guardian by</label>
                <div class="tn-row">
                  <select [id]="'consent-' + g.id" [ngModel]="draftConsent[g.id] ?? g.consent" (ngModelChange)="draftConsent[g.id] = $event" [attr.aria-describedby]="'consent-hint-' + g.id">
                    @for (c of channels; track c) { <option [value]="c">{{ c === 'None' ? 'None (no alerts)' : c }}</option> }
                  </select>
                  <button type="button" class="tn-btn" [disabled]="(draftConsent[g.id] ?? g.consent) === g.consent" (click)="saveConsent(g)">Save choice</button>
                </div>
                <span class="tn-hint" [id]="'consent-hint-' + g.id">Your choice is recorded with today's date.</span>
              </div>

              <div style="margin-top:14px">
                @if (g.pendingRemoval) {
                  <div class="tn-banner tn-banner--warn" role="status"><mat-icon aria-hidden="true">hourglass_top</mat-icon><div>Removal requested on {{ dateTime(g.pendingRemoval.createdAt) }}. Waiting for the hostel office.</div></div>
                } @else if (removing === g.id) {
                  <form (ngSubmit)="submitRemoval(g)" class="tn-form" novalidate>
                    <div class="tn-field tn-wide">
                      <label [for]="'rm-' + g.id">Why should this guardian be removed? ({{ min }}-{{ max }} characters)</label>
                      <textarea [id]="'rm-' + g.id" name="reason" [(ngModel)]="reason" [maxlength]="max" [attr.aria-invalid]="!!reasonError" rows="3"></textarea>
                      @if (reasonError) { <span class="tn-err" role="alert">{{ reasonError }}</span> }
                    </div>
                    <div class="tn-row tn-wide">
                      <button type="submit" class="tn-btn">Send request</button>
                      <button type="button" class="tn-btn tn-btn--ghost" (click)="cancelRemoval()">Cancel</button>
                    </div>
                  </form>
                } @else {
                  <button type="button" class="tn-btn tn-btn--danger" (click)="startRemoval(g.id)"><mat-icon aria-hidden="true">person_remove</mat-icon>Request to remove guardian</button>
                }
              </div>
            </section>
          }
        </div>

        @if (requests.length) {
          <section class="tn-card">
            <h2>My removal requests</h2>
            <ul class="tn-list">
              @for (r of requests; track r.id) {
                <li>
                  <div class="tn-row tn-row--between">
                    <strong>{{ r.guardianName }}</strong>
                    <span class="tn-pill tn-pill--{{ tone(r.status) }}">{{ r.status }}</span>
                  </div>
                  <div class="tn-sub">{{ dateTime(r.createdAt) }} · {{ r.reason }}</div>
                  @if (r.decisionNote) { <div class="tn-sub">Hostel office: {{ r.decisionNote }}</div> }
                  @if (r.status === 'Pending') { <button type="button" class="tn-btn tn-btn--ghost" style="margin-top:6px" (click)="withdraw(r)">Withdraw request</button> }
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
})
export class TenantGuardiansComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantGuardianAccessService);
  readonly channels = this.service.consentChannels;
  readonly min = REMOVAL_REASON_MIN;
  readonly max = REMOVAL_REASON_MAX;
  readonly tone = toneOf;
  readonly date = fmtDate;
  readonly dateTime = fmtDateTime;

  guardians: MyGuardianView[] = [];
  requests: GuardianRemovalRequest[] = [];
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  draftConsent: Partial<Record<string, ConsentChannel>> = {};
  removing = '';
  reason = '';
  reasonError = '';
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
        this.subs.add(this.service.mine$.subscribe((g) => (this.guardians = g)));
        this.subs.add(this.service.myRequests$.subscribe((r) => (this.requests = r)));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  saveConsent(g: MyGuardianView): void {
    this.reset();
    try {
      const next = this.draftConsent[g.id];
      if (!next) return;
      this.service.changeConsent(g.id, next);
      delete this.draftConsent[g.id];
      this.message = `${g.name} will now be notified by ${next === 'None' ? 'no channel (alerts off)' : next}.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  startRemoval(id: string): void {
    this.reset();
    this.removing = id;
    this.reason = '';
    this.reasonError = '';
  }

  cancelRemoval(): void {
    this.removing = '';
    this.reasonError = '';
  }

  submitRemoval(g: MyGuardianView): void {
    this.reasonError = '';
    try {
      this.service.requestRemoval(g.id, this.reason);
      this.removing = '';
      this.message = `Your request to remove ${g.name} was sent to the hostel office.`;
    } catch (e) {
      this.reasonError = errMsg(e);
    }
  }

  withdraw(r: GuardianRemovalRequest): void {
    this.reset();
    try {
      this.service.withdrawRequest(r.id);
      this.message = 'Request withdrawn.';
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  private reset(): void {
    this.message = '';
    this.actionError = '';
  }
}
