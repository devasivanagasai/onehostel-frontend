import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { localDateIso } from '../../../shared/utils/local-date';
import { TenantContextService } from '../../../core/services/tenant-context.service';
import { TenantVisitorInput, TenantVisitorView, VisitorsService } from '../../visitors/visitors.service';
import { APPROVAL_TONES, ID_TYPES, MOBILE_PATTERN, PURPOSES, VISIT_TONES, VisitorIdType, VisitorPolicy, clock } from '../../visitors/visitors.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase } from '../daily-kit/tenant-page.base';

type Tab = 'new' | 'current' | 'history';
type RequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Checked In' | 'Checked Out';

const REQUEST_STATUSES: RequestStatus[] = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Checked In', 'Checked Out'];
const REQUEST_TONES: Record<RequestStatus, string> = { Pending: 'warning', Approved: 'success', Rejected: 'danger', Cancelled: 'neutral', 'Checked In': 'info', 'Checked Out': 'neutral' };

/** The request status named in the FRD, worked out from the approval decision and the recorded movement. */
export function requestStatus(v: TenantVisitorView): RequestStatus {
  if (v.status === 'Checked In') return 'Checked In';
  if (v.status === 'Checked Out') return 'Checked Out';
  if (v.status === 'Cancelled') return v.approval === 'Rejected' ? 'Rejected' : 'Cancelled';
  return v.approval === 'Pending' ? 'Pending' : 'Approved';
}

@Component({
  selector: 'app-tenant-visitors',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <div class="td-tabs" role="tablist" aria-label="Visitor sections">
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'new'" [attr.aria-selected]="tab === 'new'" (click)="tab = 'new'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">person_add</mat-icon> New request
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'current'" [attr.aria-selected]="tab === 'current'" (click)="tab = 'current'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">pending_actions</mat-icon> Current <span class="td-count">{{ current.length }}</span>
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'history'" [attr.aria-selected]="tab === 'history'" (click)="tab = 'history'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">history</mat-icon> History <span class="td-count">{{ history.length }}</span>
        </button>
      </div>

      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading visitor requests..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }

        @if (tab === 'new') {
          <div class="td-split">
            <section class="td-card" aria-labelledby="vs-form">
              <h3 id="vs-form">Visitor details</h3>
              @if (!policy.visitorsAllowed) {
                <div class="td-banner td-banner--bad" role="alert"><mat-icon>block</mat-icon><p>Visitors are not allowed under the current hostel rules, so new requests are switched off.</p></div>
              }
              <form class="td-form" (ngSubmit)="submit()" novalidate>
                <div class="td-field">
                  <label for="vs-name">Visitor name <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="vs-name" name="name" type="text" maxlength="80" autocomplete="off" [(ngModel)]="form.name" [attr.aria-invalid]="!!errors['name']" [attr.aria-describedby]="errors['name'] ? 'vs-name-e' : null" />
                  @if (errors['name']) { <p id="vs-name-e" class="td-err" role="alert">{{ errors['name'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="vs-mobile">Mobile number {{ policy.idRequired ? '' : '(optional)' }}@if (policy.idRequired) { <span class="td-req" aria-hidden="true">*</span> }</label>
                  <input id="vs-mobile" name="mobile" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digits" [(ngModel)]="form.mobile" [attr.aria-invalid]="!!errors['mobile']" />
                  @if (errors['mobile']) { <p class="td-err" role="alert">{{ errors['mobile'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="vs-date">Visit date <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="vs-date" name="date" type="date" [min]="today" [(ngModel)]="form.date" [attr.aria-invalid]="!!errors['date']" />
                  @if (errors['date']) { <p class="td-err" role="alert">{{ errors['date'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="vs-arr">Expected arrival <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="vs-arr" name="arrival" type="time" [(ngModel)]="form.arrival" [attr.aria-invalid]="!!errors['arrival']" />
                  @if (errors['arrival']) { <p class="td-err" role="alert">{{ errors['arrival'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="vs-dep">Expected departure (optional)</label>
                  <input id="vs-dep" name="departure" type="time" [(ngModel)]="form.departure" [attr.aria-invalid]="!!errors['departure']" />
                  @if (errors['departure']) { <p class="td-err" role="alert">{{ errors['departure'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="vs-count">Number of visitors <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="vs-count" name="count" type="number" min="1" step="1" inputmode="numeric" [(ngModel)]="form.count" [attr.aria-invalid]="!!errors['count']" />
                  <span class="td-hint">At most {{ policy.maxVisitors }} per visit.</span>
                  @if (errors['count']) { <p class="td-err" role="alert">{{ errors['count'] }}</p> }
                </div>
                <div class="td-field td-field--wide">
                  <label for="vs-purpose">Purpose of visit <span class="td-req" aria-hidden="true">*</span></label>
                  <select id="vs-purpose" name="purpose" [(ngModel)]="form.purpose" [attr.aria-invalid]="!!errors['purpose']">
                    <option value="">Select a purpose</option>
                    @for (p of purposes; track p) { <option [value]="p">{{ p }}</option> }
                  </select>
                  @if (errors['purpose']) { <p class="td-err" role="alert">{{ errors['purpose'] }}</p> }
                </div>
                @if (policy.idRequired) {
                  <div class="td-field">
                    <label for="vs-idt">Visitor ID type <span class="td-req" aria-hidden="true">*</span></label>
                    <select id="vs-idt" name="idType" [(ngModel)]="form.idType" [attr.aria-invalid]="!!errors['idType']">
                      <option value="">Select an ID type</option>
                      @for (t of idTypes; track t) { <option [value]="t">{{ t }}</option> }
                    </select>
                    @if (errors['idType']) { <p class="td-err" role="alert">{{ errors['idType'] }}</p> }
                  </div>
                  <div class="td-field">
                    <label for="vs-idr">ID number <span class="td-req" aria-hidden="true">*</span></label>
                    <input id="vs-idr" name="idRef" type="text" maxlength="30" autocomplete="off" [(ngModel)]="form.idReference" [attr.aria-invalid]="!!errors['idReference']" />
                    <span class="td-hint">Kept private; staff see it masked.</span>
                    @if (errors['idReference']) { <p class="td-err" role="alert">{{ errors['idReference'] }}</p> }
                  </div>
                }
                @if (actionError) {
                  <div class="td-banner td-banner--bad td-field--wide" role="alert" style="grid-column: 1 / -1;"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
                }
                <div class="td-actions" style="grid-column: 1 / -1;">
                  <app-button variant="secondary" (clicked)="resetForm()">Clear</app-button>
                  <app-button type="submit" icon="send" [loading]="busy" [disabled]="!policy.visitorsAllowed">Submit request</app-button>
                </div>
              </form>
            </section>

            <section class="td-card" aria-labelledby="vs-rules">
              <h3 id="vs-rules">Visiting rules</h3>
              <ul class="td-hint" style="margin: 8px 0 0; padding-left: 18px; line-height: 1.7;">
                <li>Visiting hours: <strong>{{ clock(policy.visitingFrom) }} &ndash; {{ clock(policy.visitingTo) }}</strong> every day.</li>
                <li>Up to <strong>{{ policy.maxVisitors }}</strong> visitor(s) per visit.</li>
                <li>{{ approvalRequired ? 'Every request must be approved by the hostel before the visit.' : 'No approval is needed, but security still checks every visitor on arrival.' }}</li>
                <li>{{ policy.idRequired ? 'Visitors must carry a valid photo ID and mobile number.' : 'Visitors should carry a photo ID.' }}</li>
                <li>Approval is not entry: security records when your visitor actually arrives and leaves.</li>
                <li>You cannot approve your own request. You can cancel a request until the visitor has arrived.</li>
              </ul>
            </section>
          </div>
        }

        @if (tab !== 'new') {
          <div class="td-filters">
            <label class="sr-only" for="vs-filter">Filter by request status</label>
            <select id="vs-filter" [(ngModel)]="statusFilter" (ngModelChange)="apply()">
              <option value="All">All statuses</option>
              @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
            </select>
            <label class="sr-only" for="vs-search">Search visitors</label>
            <input id="vs-search" type="search" placeholder="Search visitor or ID" [(ngModel)]="search" (ngModelChange)="apply()" />
          </div>
          <section class="td-card" [attr.aria-label]="tab === 'current' ? 'Current requests' : 'Request history'">
            @if (shown.length === 0) {
              <app-empty-state
                [icon]="all.length ? 'search_off' : 'badge'"
                [message]="all.length ? 'No requests match' : (tab === 'current' ? 'No current requests' : 'No past requests')"
                [hint]="all.length ? 'Try a different status or search.' : 'Raise a request from the New request tab.'"
                [clearable]="statusFilter !== 'All' || !!search"
                (clear)="statusFilter = 'All'; search = ''; apply()"></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (v of shown; track v.id) {
                  <li class="td-row">
                    <div class="td-row__main">
                      <div class="td-row__title">{{ v.name }} <span class="td-small td-muted">{{ v.id }}</span></div>
                      <div class="td-row__sub">{{ v.purpose }} &middot; {{ v.count }} visitor(s){{ v.mobile ? ' · ' + v.mobile : '' }}</div>
                      <div class="td-row__meta">
                        <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">event</mat-icon>{{ dt(v.expectedAt) }}{{ v.expectedDepartureAt ? ' to ' + clock(v.expectedDepartureAt.slice(11, 16)) : '' }}</span>
                        @if (v.idMasked) { <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">badge</mat-icon>{{ v.idMasked }}</span> }
                      </div>
                      <div class="td-row__sub"><strong>{{ v.stage }}</strong></div>
                      <dl class="td-kv" style="margin-top: 8px;">
                        <dt>Approval</dt>
                        <dd>
                          <span class="td-pill td-pill--{{ approvalTone(v.approval) }}">{{ v.approval }}</span>
                          @if (v.approvalAt) { <span class="td-muted td-small"> {{ dt(v.approvalAt) }}</span> }
                          @if (v.approvalReason) { <span class="td-small"> &middot; {{ v.approvalReason }}</span> }
                        </dd>
                        <dt>Arrival</dt>
                        <dd>
                          <span class="td-pill td-pill--{{ visitTone(v.status) }}">{{ entryLabel(v) }}</span>
                          @if (v.checkInAt) { <span class="td-muted td-small"> in {{ dt(v.checkInAt) }}</span> }
                          @if (v.checkOutAt) { <span class="td-muted td-small"> &middot; out {{ dt(v.checkOutAt) }}</span> }
                        </dd>
                        @if (v.cancelReason) { <dt>Cancel reason</dt><dd>{{ v.cancelReason }}</dd> }
                      </dl>
                      @if (expanded === v.id) {
                        <ul class="td-timeline" aria-label="Request history">
                          @for (t of v.timeline; track $index) {
                            <li><span class="t-at">{{ dt(t.at) }}</span>{{ t.action }}{{ t.note ? ': ' + t.note : '' }}</li>
                          }
                        </ul>
                      }
                      @if (cancelling === v.id) {
                        <div class="td-field" style="margin-top: 10px; max-width: 420px;">
                          <label [attr.for]="'vs-cr-' + v.id">Reason for cancelling <span class="td-req" aria-hidden="true">*</span></label>
                          <input [id]="'vs-cr-' + v.id" type="text" maxlength="120" [(ngModel)]="cancelReason" name="cr-{{ v.id }}" />
                          @if (cancelError) { <p class="td-err" role="alert">{{ cancelError }}</p> }
                          <div class="td-actions" style="justify-content: flex-start;">
                            <app-button size="sm" variant="danger" [loading]="busy" (clicked)="confirmCancel(v)">Cancel request</app-button>
                            <app-button size="sm" variant="secondary" (clicked)="cancelling = ''">Keep it</app-button>
                          </div>
                        </div>
                      }
                    </div>
                    <div class="td-row__side">
                      <span class="td-pill td-pill--{{ reqTone(v) }}">{{ reqStatus(v) }}</span>
                      <app-button variant="text" size="sm" [icon]="expanded === v.id ? 'expand_less' : 'expand_more'" (clicked)="expanded = expanded === v.id ? '' : v.id">{{ expanded === v.id ? 'Hide' : 'History' }}</app-button>
                      @if (v.canCancel && cancelling !== v.id) {
                        <app-button variant="danger-outline" size="sm" icon="close" (clicked)="startCancel(v)">Cancel request</app-button>
                      }
                    </div>
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
export class TenantVisitorsComponent extends TenantPageBase {
  readonly service = inject(VisitorsService);
  private readonly tenant = inject(TenantContextService);

  readonly purposes = PURPOSES;
  readonly idTypes = ID_TYPES;
  readonly statuses = REQUEST_STATUSES;

  tab: Tab = 'new';
  policy: VisitorPolicy = this.service.policy;
  approvalRequired = true;
  today = localDateIso();

  form = this.blank();
  errors: Record<string, string> = {};

  all: TenantVisitorView[] = [];
  current: TenantVisitorView[] = [];
  history: TenantVisitorView[] = [];
  shown: TenantVisitorView[] = [];
  statusFilter = 'All';
  search = '';
  expanded = '';
  cancelling = '';
  cancelReason = '';
  cancelError = '';

  constructor() {
    super();
    this.watch(this.service.visitors$, this.service.rules$);
    this.start();
  }

  private blank() {
    return { name: '', mobile: '', date: localDateIso(), arrival: '', departure: '', count: 1 as number | null, purpose: '', idType: '' as VisitorIdType | '', idReference: '' };
  }

  protected refresh(): void {
    if (!this.tenant.residentId) throw new Error('Sign in as a Tenant to see your visitor requests.');
    const rules = this.service.tenantRules();
    this.policy = rules.policy;
    this.approvalRequired = rules.approvalRequired;
    this.today = localDateIso();
    this.all = this.service.tenantVisitors();
    this.current = this.all.filter((v) => v.status === 'Checked In' || (v.status === 'Expected' && !this.isPast(v)));
    this.history = this.all.filter((v) => !this.current.includes(v));
    this.apply();
  }

  private isPast(v: TenantVisitorView): boolean {
    return v.status === 'Expected' && v.expectedAt.slice(0, 10) < localDateIso();
  }

  apply(): void {
    const base = this.tab === 'history' ? this.history : this.current;
    const q = this.search.trim().toLowerCase();
    this.shown = base.filter((v) => (this.statusFilter === 'All' || requestStatus(v) === this.statusFilter) && (!q || `${v.name} ${v.id}`.toLowerCase().includes(q)));
  }

  /** Re-filter when the tab changes. */
  override clearFeedback(): void {
    super.clearFeedback();
    this.apply();
  }

  resetForm(): void {
    this.form = this.blank();
    this.errors = {};
    this.clearFeedback();
  }

  /** Field-level checks for quick feedback; the service re-checks everything on submit. */
  private validate(): Record<string, string> {
    const f = this.form;
    const p = this.policy;
    const e: Record<string, string> = {};
    if (!f.name.trim()) e['name'] = 'Visitor name is required';
    const mobile = f.mobile.trim();
    if (mobile && !MOBILE_PATTERN.test(mobile)) e['mobile'] = 'Enter a valid 10-digit mobile number';
    else if (!mobile && p.idRequired) e['mobile'] = 'Mobile number is required';
    if (!f.date) e['date'] = 'Pick the visit date';
    else if (f.date < this.today) e['date'] = 'The visit date cannot be in the past';
    if (!f.arrival) e['arrival'] = 'Pick the expected arrival time';
    else if (f.date && !e['date']) {
      if (new Date(`${f.date}T${f.arrival}:00`).getTime() < Date.now() - 15 * 60_000) e['arrival'] = 'Arrival cannot be in the past';
      else if (f.arrival < p.visitingFrom || f.arrival > p.visitingTo) e['arrival'] = `Visits are only allowed ${clock(p.visitingFrom)} to ${clock(p.visitingTo)}`;
    }
    if (f.departure) {
      if (f.arrival && f.departure <= f.arrival) e['departure'] = 'Departure must be after arrival';
      else if (f.departure > p.visitingTo) e['departure'] = `Departure must be by ${clock(p.visitingTo)}`;
    }
    if (!f.purpose) e['purpose'] = 'Select a purpose';
    const n = Number(f.count);
    if (f.count === null || !Number.isInteger(n) || n < 1) e['count'] = 'Enter a whole number of at least 1';
    else if (n > p.maxVisitors) e['count'] = `At most ${p.maxVisitors} visitor(s) are allowed per visit`;
    if (p.idRequired) {
      if (!f.idType) e['idType'] = 'Select an ID type';
      if (!f.idReference.trim()) e['idReference'] = 'Enter the ID number';
    }
    return e;
  }

  submit(): void {
    if (this.busy) return;
    this.clearFeedback();
    this.errors = this.validate();
    if (Object.keys(this.errors).length) {
      this.actionError = 'Fix the highlighted fields and try again.';
      return;
    }
    this.busy = true;
    try {
      const f = this.form;
      const input: TenantVisitorInput = {
        name: f.name,
        mobile: f.mobile,
        expectedAt: `${f.date}T${f.arrival}`,
        expectedDepartureAt: f.departure ? `${f.date}T${f.departure}` : undefined,
        purpose: f.purpose,
        count: Number(f.count),
        idType: f.idType || undefined,
        idReference: f.idReference,
      };
      const v = this.service.tenantRequest(input);
      this.form = this.blank();
      this.errors = {};
      this.run();
      this.tab = 'current';
      this.apply();
      this.done(`Request ${v.id} submitted. ${v.approval === 'Pending' ? 'It is waiting for approval.' : 'No approval is needed.'}`);
    } catch (e) {
      this.failed(e);
    } finally {
      this.busy = false;
    }
  }

  startCancel(v: TenantVisitorView): void {
    this.cancelling = v.id;
    this.cancelReason = '';
    this.cancelError = '';
  }

  confirmCancel(v: TenantVisitorView): void {
    if (this.busy) return;
    if (!this.cancelReason.trim()) {
      this.cancelError = 'Give a reason for cancelling';
      return;
    }
    this.busy = true;
    try {
      this.service.tenantCancel(v.id, this.cancelReason);
      this.cancelling = '';
      this.run();
      this.done(`Request ${v.id} was cancelled.`);
    } catch (e) {
      this.cancelError = e instanceof Error ? e.message : 'Could not cancel.';
    } finally {
      this.busy = false;
    }
  }

  reqStatus(v: TenantVisitorView): RequestStatus {
    return requestStatus(v);
  }

  reqTone(v: TenantVisitorView): string {
    return REQUEST_TONES[requestStatus(v)];
  }

  approvalTone(s: string): string {
    return APPROVAL_TONES[s as keyof typeof APPROVAL_TONES] ?? 'neutral';
  }

  visitTone(s: string): string {
    return VISIT_TONES[s as keyof typeof VISIT_TONES] ?? 'neutral';
  }

  /** Physical movement only; approval is shown separately. */
  entryLabel(v: TenantVisitorView): string {
    if (v.status === 'Expected') return 'Not arrived yet';
    return v.status;
  }
}
