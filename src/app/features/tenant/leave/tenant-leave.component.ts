import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { LeaveOutpassService, LeaveMovement, TenantLeaveInput } from '../../../core/services/leave-outpass.service';
import { APPROVAL_TONES, LEAVE_TYPES, LeaveContact, LeavePolicy, LeaveRequest, LeaveType, REASON_MAX, durationLabel, time } from '../../../core/models/leave-outpass.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase, localMinute } from '../daily-kit/tenant-page.base';

type Tab = 'new' | 'current' | 'previous';

@Component({
  selector: 'app-tenant-leave',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <div class="td-tabs" role="tablist" aria-label="Leave sections">
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'new'" [attr.aria-selected]="tab === 'new'" (click)="tab = 'new'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">edit_calendar</mat-icon> New request
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'current'" [attr.aria-selected]="tab === 'current'" (click)="tab = 'current'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">pending_actions</mat-icon> Current <span class="td-count">{{ current.length }}</span>
        </button>
        <button type="button" role="tab" class="td-tab" [class.is-active]="tab === 'previous'" [attr.aria-selected]="tab === 'previous'" (click)="tab = 'previous'; clearFeedback()">
          <mat-icon fontSet="material-icons-outlined">history</mat-icon> Previous <span class="td-count">{{ previous.length }}</span>
        </button>
      </div>

      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading your requests..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }

        @if (tab === 'new') {
          <div class="td-split">
            <section class="td-card" aria-labelledby="lv-form">
              <h3 id="lv-form">Request leave or an outpass</h3>
              <form class="td-form" (ngSubmit)="submit()" novalidate>
                <div class="td-field td-field--wide">
                  <span class="td-label" id="lv-type">Request type <span class="td-req" aria-hidden="true">*</span></span>
                  <div class="td-chips" role="radiogroup" aria-labelledby="lv-type">
                    @for (t of types; track t) {
                      <button type="button" class="td-chip" role="radio" [attr.aria-checked]="form.type === t" [class.is-on]="form.type === t" (click)="setType(t)">
                        {{ t }}
                        <small>{{ t === 'Leave' ? 'Overnight or longer' : 'Same day, up to ' + policy.outpassMaxHours + ' hours' }}</small>
                      </button>
                    }
                  </div>
                </div>
                <div class="td-field td-field--wide">
                  <label for="lv-reason">Reason <span class="td-req" aria-hidden="true">*</span></label>
                  <textarea id="lv-reason" name="reason" [maxlength]="reasonMax" [(ngModel)]="form.reason" (ngModelChange)="recheck()" [attr.aria-invalid]="!!errors['reason']"></textarea>
                  <span class="td-hint">{{ form.reason.length }}/{{ reasonMax }}</span>
                  @if (errors['reason']) { <p class="td-err" role="alert">{{ errors['reason'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="lv-dep">Departure <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="lv-dep" name="depart" type="datetime-local" [min]="nowMin" [(ngModel)]="form.departAt" (ngModelChange)="recheck()" [attr.aria-invalid]="!!errors['depart']" />
                  @if (errors['depart']) { <p class="td-err" role="alert">{{ errors['depart'] }}</p> }
                </div>
                <div class="td-field">
                  <label for="lv-ret">Expected return <span class="td-req" aria-hidden="true">*</span></label>
                  <input id="lv-ret" name="return" type="datetime-local" [min]="form.departAt || nowMin" [(ngModel)]="form.returnAt" (ngModelChange)="recheck()" [attr.aria-invalid]="!!errors['return']" />
                  @if (errors['return']) { <p class="td-err" role="alert">{{ errors['return'] }}</p> }
                </div>
                <div class="td-field td-field--wide">
                  <label for="lv-dest">Destination @if (destRequired) { <span class="td-req" aria-hidden="true">*</span> } @else { (optional) }</label>
                  <input id="lv-dest" name="destination" type="text" maxlength="120" [(ngModel)]="form.destination" (ngModelChange)="recheck()" [attr.aria-invalid]="!!errors['destination']" />
                  @if (errors['destination']) { <p class="td-err" role="alert">{{ errors['destination'] }}</p> }
                </div>
                <div class="td-field td-field--wide">
                  <label for="lv-contact">Contact during leave</label>
                  @if (contacts.length) {
                    <select id="lv-contact" name="contact" [(ngModel)]="form.contactSource">
                      @for (c of contacts; track c.source) { <option [value]="c.source">{{ c.name }} ({{ c.source === 'Guardian' ? (c.relationship || 'Guardian') : 'Emergency contact' }}) &middot; {{ c.mobile }}</option> }
                    </select>
                    <span class="td-hint">Contacts come from your profile. To change them, ask the hostel office.</span>
                  } @else {
                    <p class="td-err" role="alert">{{ errors['contact'] || 'No emergency contact on your profile. Ask the hostel office to add one.' }}</p>
                  }
                </div>
                <div class="td-field td-field--wide">
                  <label for="lv-doc">Supporting document (optional)</label>
                  <input id="lv-doc" type="file" accept=".pdf,.png,.jpg,.jpeg" (change)="pickFile($event)" />
                  <span class="td-hint">PDF, PNG or JPG up to 5 MB. Only the file name is kept in this demo.</span>
                  @if (errors['document']) { <p class="td-err" role="alert">{{ errors['document'] }}</p> }
                </div>

                @if (summary) {
                  <div class="td-banner td-field--wide" style="grid-column: 1 / -1;" role="status">
                    <mat-icon>summarize</mat-icon>
                    <p><strong>Summary:</strong> {{ form.type }} from {{ dtLocal(form.departAt) }} to {{ dtLocal(form.returnAt) }} ({{ summary }}).
                      {{ form.destination.trim() ? 'Destination: ' + form.destination.trim() + '.' : '' }} It will be sent to the hostel for approval.</p>
                  </div>
                }
                @if (errors['overlap']) {
                  <div class="td-banner td-banner--warn" style="grid-column: 1 / -1;" role="alert"><mat-icon>event_busy</mat-icon><p>{{ errors['overlap'] }}</p></div>
                }
                @if (actionError) {
                  <div class="td-banner td-banner--bad" style="grid-column: 1 / -1;" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
                }
                <div class="td-actions" style="grid-column: 1 / -1;">
                  <app-button variant="secondary" (clicked)="resetForm()">Clear</app-button>
                  <app-button type="submit" icon="send" [loading]="busy">Submit request</app-button>
                </div>
              </form>
            </section>

            <section class="td-card" aria-labelledby="lv-rules">
              <h3 id="lv-rules">How it works</h3>
              <ul class="td-hint" style="margin: 8px 0 0; padding-left: 18px; line-height: 1.7;">
                <li>Staff approve or reject your request. You cannot approve it yourself.</li>
                <li>An outpass can be at most {{ policy.outpassMaxHours }} hours. Use Leave for longer.</li>
                <li>You cannot have two pending or approved requests that overlap.</li>
                <li>Approval is not the same as leaving. Security records when you actually leave and return, and that is shown separately.</li>
                <li>After approval you cannot edit a request. Cancel it and submit a new one.</li>
                <li>If you return late, it is flagged as an overdue return. This does not assume any wrongdoing.</li>
              </ul>
            </section>
          </div>
        }

        @if (tab !== 'new') {
          @if (actionError) {
            <div class="td-banner td-banner--bad" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
          }
          <section class="td-card" [attr.aria-label]="tab === 'current' ? 'Current requests' : 'Previous requests'">
            @if (shown.length === 0) {
              <app-empty-state icon="exit_to_app" [message]="tab === 'current' ? 'No current requests' : 'No previous requests'"
                [hint]="tab === 'current' ? 'Pending requests and approved ones that have not finished appear here.' : 'Rejected, cancelled and completed requests appear here.'"></app-empty-state>
            } @else {
              <ul class="td-list">
                @for (r of shown; track r.id) {
                  <li class="td-row">
                    <div class="td-row__main">
                      <div class="td-row__title">{{ r.type }} <span class="td-small td-muted">{{ r.id }}</span></div>
                      <div class="td-row__sub">{{ r.reason }}</div>
                      <div class="td-row__meta">
                        <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">logout</mat-icon>{{ dt(r.departAt) }}</span>
                        <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">login</mat-icon>{{ dt(r.returnAt) }}</span>
                        <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">timelapse</mat-icon>{{ duration(r) }}</span>
                        @if (r.destination) { <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">place</mat-icon>{{ r.destination }}</span> }
                        @if (r.supportingDocument) { <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>{{ r.supportingDocument }}</span> }
                      </div>
                      <dl class="td-kv" style="margin-top: 10px;">
                        <dt>Decision</dt>
                        <dd>
                          <span class="td-pill td-pill--{{ approvalTone(r.status) }}">{{ r.status }}</span>
                          @if (r.decidedAt) { <span class="td-small td-muted"> {{ dt(r.decidedAt) }}</span> }
                          @if (r.decidedBy) { <span class="td-small td-muted"> by {{ r.decidedBy }}</span> }
                          @if (r.status === 'Pending') { <span class="td-small td-muted"> Waiting for the hostel to decide</span> }
                        </dd>
                        @if (r.decisionReason) { <dt>Remarks</dt><dd>{{ r.decisionReason }}</dd> }
                        @if (r.status === 'Cancelled') { <dt>Cancelled</dt><dd>{{ r.cancelledAt ? dt(r.cancelledAt) : '' }}{{ r.cancelReason ? ' · ' + r.cancelReason : '' }}</dd> }
                        @if (r.status === 'Approved') {
                          <dt>Movement</dt>
                          <dd>
                            @if (move(r); as m) {
                              <span class="td-pill td-pill--{{ moveTone(m) }}">{{ m }}</span>
                            } @else {
                              <span class="td-pill td-pill--neutral">Not tracked</span>
                            }
                            <span class="td-small td-muted"> recorded by security, separate from approval</span>
                            <div class="td-small" style="margin-top: 4px;">
                              Left: {{ r.exitAt ? dt(r.exitAt) : 'not recorded' }} &middot; Returned: {{ r.returnedAt ? dt(r.returnedAt) : 'not recorded' }}
                            </div>
                            @if (move(r) === 'Overdue return') { <div class="td-small" style="color: #b45309; margin-top: 4px;">Your return time has passed and no return is recorded. Please check in with the hostel office.</div> }
                            @if (move(r) === 'No-show') { <div class="td-small" style="margin-top: 4px;">The approved period ended and no exit was recorded, so you did not use this approval.</div> }
                          </dd>
                        }
                      </dl>
                      @if (cancelling === r.id) {
                        <div class="td-field" style="margin-top: 10px; max-width: 420px;">
                          <label [attr.for]="'lv-cr-' + r.id">Reason for cancelling (optional)</label>
                          <input [id]="'lv-cr-' + r.id" type="text" maxlength="120" [(ngModel)]="cancelReason" name="cr-{{ r.id }}" />
                          <div class="td-actions" style="justify-content: flex-start;">
                            <app-button size="sm" variant="danger" [loading]="busy" (clicked)="confirmCancel(r)">Cancel request</app-button>
                            <app-button size="sm" variant="secondary" (clicked)="cancelling = ''">Keep it</app-button>
                          </div>
                        </div>
                      }
                    </div>
                    <div class="td-row__side">
                      @if (service.canCancel(r) && cancelling !== r.id) {
                        <app-button variant="danger-outline" size="sm" icon="close" (clicked)="cancelling = r.id; cancelReason = ''">Cancel request</app-button>
                        @if (r.status === 'Approved') { <span class="td-small td-muted" style="max-width: 180px; text-align: right;">To change an approved request, cancel it and submit a new one.</span> }
                      }
                      @if (r.status === 'Approved') {
                        <app-button variant="outline" size="sm" icon="download" (clicked)="download(r)">Download record</app-button>
                        <app-button variant="text" size="sm" icon="print" (clicked)="print(r)">Print</app-button>
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
export class TenantLeaveComponent extends TenantPageBase {
  readonly service = inject(LeaveOutpassService);

  readonly types = LEAVE_TYPES;
  readonly reasonMax = REASON_MAX;

  tab: Tab = 'new';
  policy: LeavePolicy = this.service.policy;
  contacts: LeaveContact[] = [];
  nowMin = localMinute();
  form = this.blank();
  errors: Record<string, string> = {};
  submitted = false;
  summary = '';
  file: File | null = null;

  current: LeaveRequest[] = [];
  previous: LeaveRequest[] = [];
  cancelling = '';
  cancelReason = '';

  constructor() {
    super();
    this.watch(this.service.requests$, this.service.policy$);
    this.start();
  }

  private blank() {
    return { type: 'Leave' as LeaveType, reason: '', departAt: '', returnAt: '', destination: '', contactSource: '' as LeaveContact['source'] | '', };
  }

  get destRequired(): boolean {
    return this.policy.destinationRequired[this.form.type];
  }

  get shown(): LeaveRequest[] {
    return this.tab === 'current' ? this.current : this.previous;
  }

  protected refresh(): void {
    this.policy = this.service.policy;
    this.nowMin = localMinute();
    this.contacts = this.service.tenantContacts();
    if (!this.form.contactSource && this.contacts.length) this.form.contactSource = this.contacts[0].source;
    const mine = this.service.tenantRequests();
    const now = Date.now();
    const isCurrent = (r: LeaveRequest): boolean => r.status === 'Pending' || (r.status === 'Approved' && !r.returnedAt && time(r.returnAt) >= now - 24 * 3_600_000);
    this.current = mine.filter(isCurrent);
    this.previous = mine.filter((r) => !isCurrent(r));
    this.recheck();
  }

  private input(): TenantLeaveInput {
    const f = this.form;
    return {
      type: f.type,
      reason: f.reason,
      departAt: f.departAt,
      returnAt: f.returnAt,
      destination: f.destination,
      contactSource: f.contactSource || undefined,
      supportingDocument: this.file?.name,
    };
  }

  setType(t: LeaveType): void {
    this.form.type = t;
    this.recheck();
  }

  /** Validation as the Tenant types (errors show only after the first submit, except dates and overlap). */
  recheck(): void {
    const f = this.form;
    this.summary = f.departAt && f.returnAt && time(f.returnAt) > time(f.departAt) ? durationLabel(f.departAt, f.returnAt) : '';
    const all = this.service.tenantCheck(this.input());
    const live: Record<string, string> = {};
    if (f.departAt && all.depart) live['depart'] = all.depart;
    if (f.returnAt && all.return) live['return'] = all.return;
    if (all.overlap) live['overlap'] = all.overlap;
    if (all.document) live['document'] = all.document;
    if (this.submitted) {
      if (all.reason) live['reason'] = all.reason;
      if (all.destination) live['destination'] = all.destination;
      if (all.depart) live['depart'] = all.depart;
      if (all.return) live['return'] = all.return;
      if (all.contact) live['contact'] = all.contact;
    }
    this.errors = live;
  }

  pickFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    if (f && f.size > 5 * 1024 * 1024) {
      this.file = null;
      input.value = '';
      this.errors = { ...this.errors, document: 'The file is larger than 5 MB' };
      return;
    }
    this.file = f;
    this.recheck();
  }

  resetForm(): void {
    this.form = this.blank();
    if (this.contacts.length) this.form.contactSource = this.contacts[0].source;
    this.file = null;
    this.submitted = false;
    this.errors = {};
    this.summary = '';
    this.clearFeedback();
  }

  submit(): void {
    if (this.busy) return;
    this.clearFeedback();
    this.submitted = true;
    this.recheck();
    if (Object.keys(this.errors).length) {
      this.actionError = 'Fix the highlighted fields and try again.';
      return;
    }
    this.busy = true;
    try {
      const r = this.service.tenantCreate(this.input());
      this.resetForm();
      this.run();
      this.tab = 'current';
      this.done(`${r.type} request ${r.id} submitted. It is waiting for approval.`);
    } catch (e) {
      this.failed(e);
    } finally {
      this.busy = false;
    }
  }

  confirmCancel(r: LeaveRequest): void {
    if (this.busy) return;
    this.busy = true;
    try {
      this.service.tenantCancel(r.id, this.cancelReason);
      this.cancelling = '';
      this.run();
      this.done(`Request ${r.id} was cancelled.`);
    } catch (e) {
      this.failed(e);
      this.run();
    } finally {
      this.busy = false;
    }
  }

  move(r: LeaveRequest): LeaveMovement | null {
    return this.service.movement(r);
  }

  moveTone(m: LeaveMovement): string {
    return this.service.movementTone(m);
  }

  approvalTone(s: string): string {
    return APPROVAL_TONES[s as keyof typeof APPROVAL_TONES] ?? 'neutral';
  }

  duration(r: LeaveRequest): string {
    return durationLabel(r.departAt, r.returnAt);
  }

  dtLocal(v: string): string {
    return v ? this.dt(v) : '';
  }

  download(r: LeaveRequest): void {
    try {
      const html = this.service.tenantApprovalRecordHtml(r.id);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.type.toLowerCase()}-approval-${r.id}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.done(`Approval record for ${r.id} downloaded.`);
    } catch (e) {
      this.failed(e);
    }
  }

  print(r: LeaveRequest): void {
    try {
      const html = this.service.tenantApprovalRecordHtml(r.id);
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setTimeout(() => frame.remove(), 2000);
      };
      frame.srcdoc = html;
      document.body.appendChild(frame);
    } catch (e) {
      this.failed(e);
    }
  }
}
