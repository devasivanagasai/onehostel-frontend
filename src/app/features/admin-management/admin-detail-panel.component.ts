import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { shouldCloseOnEscape } from '../../shared/utils/panel-escape';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HostelAdmin, LogoutType, adminFullName, formatDuration, sessionMinutes } from './admin.models';
import { COUNTRY_OPTIONS } from '../../core/models/system-settings.models';
import { ADMIN_ACTION_META, AdminAction, AdminService, availableActions } from './admin.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { auditAction, auditEventLabel } from '../../core/models/audit.models';
import { REPORT_HOSTELS } from '../reports/report.models';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppButtonComponent, AppButtonVariant } from '../../shared/components/button/app-button.component';

export type AdminPanelTab = 'details' | 'activity' | 'edit';

interface ActivityItem {
  timestamp: string;
  kind: 'login' | 'logout' | 'account';
  icon: string;
  tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral';
  title: string;
  /** Sign-ins/outs: "Chrome · Windows". */
  device?: string;
  /** Sign-ins/outs: client IP. */
  ip?: string;
  /** Sign-outs: how long the session lasted, e.g. "1 h 35 min". */
  duration?: string;
  /** Account changes: who made the change. */
  by?: string;
  /** Account changes: "Field: old → new" lines. */
  changes?: string[];
}

const LOGOUT_TITLES: Record<LogoutType, string> = {
  Manual: 'Signed out',
  'Session timeout': 'Signed out — session timed out',
  'Ended by SuperAdmin': 'Signed out by Admin',
};

interface ActivityDay {
  /** "Today", "Yesterday" or "Sat, 27 Sep 2026". */
  label: string;
  items: ActivityItem[];
}

@Component({
  selector: 'app-admin-detail-panel',
  standalone: true,
  imports: [
    AppDatePipe,
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTooltipModule,
    AppButtonComponent,
  ],
  template: `
    <div class="panel-backdrop" *ngIf="isOpen" (click)="closePanel.emit()"></div>

    <div class="side-panel-drawer" [class.side-panel-drawer--open]="isOpen">
      @if (admin; as a) {
        <!-- Header: avatar · name + status · ID and role -->
        <div class="panel-header">
          <div class="identity">
            <div class="avatar">{{ initials(a) }}</div>
            <div class="identity__text">
              <div class="identity__line">
                <h2 class="panel-title">{{ name(a) }}</h2>
                <span class="status-pill status-pill--{{ a.status.toLowerCase() }}">
                  @if (a.status === 'Locked') {
                    <mat-icon>lock</mat-icon>
                  } @else {
                    <span class="status-pill__dot"></span>
                  }
                  {{ a.status }}
                </span>
              </div>
              <div class="panel-subtitle">{{ a.adminId }} <span class="sep">·</span> {{ a.role }}</div>
            </div>
          </div>
          <app-button variant="icon" icon="close" class="close-btn" ariaLabel="Close panel" (clicked)="closePanel.emit()"></app-button>
        </div>

        <!-- Account actions (above the tabs) -->
        @if (tab !== 'edit') {
          <div class="action-bar">
            @if (showEdit) {
              <app-button icon="edit_square" (clicked)="startEdit()">Edit</app-button>
            }
            @for (action of actions(a.status); track action) {
              <app-button [variant]="actionStyle(action)" [icon]="meta[action].icon" (clicked)="run(a, action)">
                {{ action === 'unlock' ? 'Unlock Account' : meta[action].label }}
              </app-button>
            }
          </div>

          <!-- Tabs -->
          <div class="tabs" role="tablist">
            <button type="button" role="tab" class="tab" [class.tab--active]="tab === 'details'" [attr.aria-selected]="tab === 'details'" (click)="tab = 'details'">
              <mat-icon fontSet="material-icons-outlined">person</mat-icon>
              Details
            </button>
            <button type="button" role="tab" class="tab" [class.tab--active]="tab === 'activity'" [attr.aria-selected]="tab === 'activity'" (click)="tab = 'activity'">
              <mat-icon>monitor_heart</mat-icon>
              Activity <span class="tab__count">{{ activity.length }}</span>
            </button>
          </div>
        }

        <div class="panel-body" [class.panel-body--cards]="tab !== 'edit'" #panelBody>
          <!-- ============ DETAILS ============ -->
          @if (tab === 'details') {
            @if (a.status === 'Locked') {
              <div class="alert alert--danger">
                <mat-icon fontSet="material-icons-outlined">warning_amber</mat-icon>
                <div>
                  <div class="alert__title">Account locked{{ a.lockedAt ? ' on ' + (a.lockedAt | appDate: 'datetime') + '.' : '' }}</div>
                  <div>{{ a.lockReason || 'This account cannot sign in until it is unlocked.' }}</div>
                </div>
              </div>
            }
            @if (!a.lastLogin && a.status === 'Active') {
              <div class="alert alert--info">
                <mat-icon>schedule</mat-icon>
                <div>Has not signed in yet. The temporary password from onboarding is still active.</div>
              </div>
            }

            <div class="info-cards">
              <section class="info-card">
                <span class="info-card__icon"><mat-icon fontSet="material-icons-outlined">person</mat-icon></span>
                <div class="info-card__content">
                  <h3 class="info-card__title">Personal</h3>
                  <dl class="detail-grid detail-grid--single">
                    <div><dt>Hostel Owner ID</dt><dd>{{ a.adminId }}</dd></div>
                    <div><dt>Name</dt><dd>{{ name(a) }}</dd></div>
                    <div><dt>Email</dt><dd><a [href]="'mailto:' + a.email">{{ a.email }}</a></dd></div>
                    <div><dt>Mobile</dt><dd>{{ a.mobileCode }} {{ a.mobile }}</dd></div>
                  </dl>
                </div>
              </section>

              <section class="info-card">
                <span class="info-card__icon"><mat-icon fontSet="material-icons-outlined">shield</mat-icon></span>
                <div class="info-card__content">
                  <h3 class="info-card__title">Account</h3>
                  <dl class="detail-grid">
                    <div><dt>Username</dt><dd>{{ a.username }}</dd></div>
                    <div><dt>Created Date</dt><dd>{{ a.createdDate | appDate }}</dd></div>
                    <div><dt>Role</dt><dd>{{ a.role }}</dd></div>
                    <div><dt>Last Login</dt><dd>{{ a.lastLogin ? (a.lastLogin | appDate: 'datetime') : 'Never' }}</dd></div>
                    <div>
                      <dt>Status</dt>
                      <dd><span class="status-pill status-pill--sm status-pill--{{ a.status.toLowerCase() }}">{{ a.status }}</span></dd>
                    </div>
                    <div>
                      <dt>Last Password Change</dt>
                      <dd>
                        @if (!a.lastPasswordChange) {
                          <span class="stale">Never — temporary password</span>
                        } @else if (passwordAgeDays(a) > 90) {
                          <span class="stale">{{ passwordAgeDays(a) }} days ago</span>
                        } @else {
                          {{ a.lastPasswordChange | appDate }}
                        }
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section class="info-card">
                <span class="info-card__icon"><mat-icon fontSet="material-icons-outlined">apartment</mat-icon></span>
                <div class="info-card__content">
                  <h3 class="info-card__title">Hostel</h3>
                  <dl class="detail-grid">
                    <div><dt>Hostel ID</dt><dd>{{ a.hostelId }}</dd></div>
                    <div><dt>Name</dt><dd>{{ a.hostelName }}</dd></div>
                    <div><dt>Type</dt><dd>{{ hostelType(a) }}</dd></div>
                  </dl>
                </div>
              </section>
            </div>
          }

          <!-- ============ ACTIVITY ============ -->
          @if (tab === 'activity') {
            @if (activity.length === 0) {
              <div class="activity-empty">
                <mat-icon>history_toggle_off</mat-icon>
                <div class="activity-empty__title">No activity recorded yet</div>
                <div class="activity-empty__hint">Sign-ins and account changes will appear here.</div>
              </div>
            } @else {
              <!-- Timeline: day label, then time · icon on the line · event card -->
              <div class="timeline">
                @for (day of activityDays; track day.label) {
                  <div class="timeline__day">{{ day.label }}</div>
                  <ol class="timeline__list">
                    @for (item of day.items; track $index) {
                      <li class="timeline__item timeline__item--{{ item.tone }}">
                        <time class="timeline__time" [attr.datetime]="item.timestamp">{{ item.timestamp | appDate: 'time' }}</time>
                        <span class="timeline__dot"><mat-icon>{{ item.icon }}</mat-icon></span>
                        <div class="timeline__card">
                          <div class="timeline__title">{{ item.title }}</div>

                          @if (item.kind === 'login' || item.kind === 'logout') {
                            <div class="timeline__chips">
                              <span class="chip">
                                <mat-icon>{{ deviceIcon(item.device ?? '') }}</mat-icon>{{ item.device }}
                              </span>
                              <span class="chip"><span class="chip__label">IP:</span> {{ item.ip }}</span>
                              @if (item.duration) {
                                <span class="chip"><span class="chip__label">Session:</span> {{ item.duration }}</span>
                              }
                            </div>
                          } @else {
                            <div class="timeline__by">by <strong>{{ item.by }}</strong></div>
                            @if (item.changes?.length) {
                              <ul class="timeline__changes">
                                @for (c of item.changes; track $index) {
                                  <li>{{ c }}</li>
                                }
                              </ul>
                            }
                          }
                        </div>
                      </li>
                    }
                  </ol>
                }
              </div>
            }
          }

          <!-- ============ EDIT ============ -->
          @if (tab === 'edit') {
            <form [formGroup]="form" (ngSubmit)="save()" id="adminEditForm" class="edit-form">
              <div class="field-group">
                <label class="field-label">Email <span class="required-star">*</span></label>
                <mat-form-field appearance="outline" class="full-width">
                  <input matInput type="email" formControlName="email" />
                  <mat-error>Enter a valid email address</mat-error>
                </mat-form-field>
              </div>

              <div class="field-group">
                <label class="field-label" for="admin-mobile">Mobile <span class="required-star">*</span></label>
                <!-- One field: country code select + number -->
                <mat-form-field appearance="outline" class="full-width mobile-field">
                  <!-- Stop clicks reaching mat-form-field: its container click moves focus to the
                       number input, which closed the native list before a code could be chosen. -->
                  <select
                    matPrefix
                    class="cc-select"
                    formControlName="mobileCode"
                    aria-label="Country code"
                    (mousedown)="$event.stopPropagation()"
                    (click)="$event.stopPropagation()"
                  >
                    @for (c of countryCodes; track c.dialCode) {
                      <option [value]="c.dialCode" [attr.aria-label]="c.name + ' ' + c.dialCode">{{ c.dialCode }}</option>
                    }
                  </select>
                  <input id="admin-mobile" matInput formControlName="mobile" inputmode="numeric" maxlength="10" placeholder="10-digit number" />
                  <mat-error>Enter a 10-digit mobile number</mat-error>
                </mat-form-field>
              </div>

              <div class="readonly-box">
                <div class="readonly-box__header">
                  <span class="readonly-box__badge"><mat-icon>lock</mat-icon></span>
                  <div>
                    <div class="readonly-box__title">Locked fields</div>
                    <div class="readonly-box__subtitle">These details can't be changed after onboarding</div>
                  </div>
                </div>

                <div class="readonly-box__fields">
                  <div class="readonly-field">
                    <span class="readonly-field__label">First Name</span>
                    <span class="readonly-field__value">
                      <mat-icon>person</mat-icon>
                      {{ a.firstName }}
                    </span>
                  </div>
                  <div class="readonly-field">
                    <span class="readonly-field__label">Last Name</span>
                    <span class="readonly-field__value">
                      <mat-icon>person</mat-icon>
                      {{ a.lastName || '—' }}
                    </span>
                  </div>
                  <div class="readonly-field">
                    <span class="readonly-field__label">Role</span>
                    <span class="readonly-field__value">
                      <mat-icon>badge</mat-icon>
                      {{ a.role }}
                    </span>
                  </div>
                  <div class="readonly-field">
                    <span class="readonly-field__label">Username</span>
                    <span class="readonly-field__value mono">
                      <mat-icon>alternate_email</mat-icon>
                      {{ a.username }}
                    </span>
                  </div>
                  <div class="readonly-field">
                    <span class="readonly-field__label">Hostel</span>
                    <span class="readonly-field__value">
                      <mat-icon>apartment</mat-icon>
                      {{ a.hostelName }}
                    </span>
                  </div>
                </div>

                <div class="readonly-box__hint">
                  <mat-icon>lock_reset</mat-icon>
                  <span>Need new login details? Use <strong>Reset Password</strong> to issue new credentials.</span>
                </div>
              </div>
            </form>
          }
        </div>

        <!-- Footer (edit mode only; view-mode actions sit at the top) -->
        @if (tab === 'edit') {
          <div class="panel-footer">
            <app-button variant="secondary" (clicked)="cancelEdit()">Cancel</app-button>
            <app-button type="submit" form="adminEditForm" [disabled]="form.invalid || form.pristine">Update</app-button>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .panel-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.12);
      z-index: 1050;
      animation: fadeIn 0.2s ease-out forwards;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .side-panel-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 680px;
      max-width: 100vw;
      height: 100vh;
      background: #ffffff;
      z-index: 1060;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .side-panel-drawer--open {
      transform: translateX(0);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 22px 24px 18px;
      flex-shrink: 0;
    }

    .identity {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }

    .identity__text {
      min-width: 0;
    }

    .identity__line {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .avatar {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #dbeafe, #bfdbfe);
      color: #1d4ed8;
      font-weight: 700;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px #ffffff, 0 0 0 4px #e2e8f0;
    }

    .panel-title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .panel-subtitle {
      margin-top: 4px;
      font-size: 14px;
      color: #475569;

      .sep {
        margin: 0 4px;
        color: #94a3b8;
      }
    }

    .close-btn {
      flex-shrink: 0;
      align-self: flex-start;
    }

    /* Status tag (header + Account card) */
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .status-pill__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-pill--sm {
      padding: 2px 8px;
      font-size: 12px;
    }

    .status-pill--active { background: #dcfce7; color: #16a34a; }
    .status-pill--inactive { background: #f1f5f9; color: #64748b; }
    .status-pill--locked { background: #fee2e2; color: #dc2626; }

    /* Account actions */
    .action-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      padding: 0 24px 18px;
      flex-shrink: 0;
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 8px;
      padding: 0 24px;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 12px 14px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      color: #475569;
      font: inherit;
      font-size: 14.5px;
      font-weight: 500;
      cursor: pointer;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        color: #0f172a;
      }
    }

    .tab--active {
      color: #2563eb;
      font-weight: 600;
      border-bottom-color: #2563eb;

      &:hover {
        color: #2563eb;
      }
    }

    .tab__count {
      font-size: 11px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 10px;
      background: #eff6ff;
      color: #2563eb;
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 18px 24px 24px;
    }

    .alert {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 18px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 16px;

      mat-icon {
        flex-shrink: 0;
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
    }

    .alert__title {
      font-size: 14px;
      font-weight: 700;
    }

    .alert--danger {
      background: #fdecec;
      color: #dc2626;
    }

    .alert--info {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      color: #075985;
    }

    .panel-body--cards {
      background: #f8fafc;
    }

    /* Detail cards: round icon on the left, title + label/value rows */
    .info-cards {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .info-card {
      display: flex;
      gap: 14px;
      padding: 16px 18px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 0 0 1px #eef2f7;
    }

    .info-card__icon {
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      border-radius: 50%;
      background: #eff6ff;
      color: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 19px;
        width: 19px;
        height: 19px;
      }
    }

    .info-card__content {
      flex: 1;
      min-width: 0;
    }

    .info-card__title {
      margin: 6px 0 12px;
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 24px;
      margin: 0;

      > div {
        display: grid;
        grid-template-columns: 110px minmax(0, 1fr);
        align-items: center;
        gap: 12px;
      }

      dt {
        font-size: 13px;
        color: #64748b;
      }

      dd {
        margin: 0;
        font-size: 13.5px;
        font-weight: 500;
        color: #0f172a;
        word-break: break-word;
      }

      a {
        color: #0f172a;
        text-decoration: none;

        &:hover {
          color: #2563eb;
        }
      }
    }

    .detail-grid--single {
      grid-template-columns: minmax(0, 1fr);

      > div {
        grid-template-columns: 110px minmax(0, 1fr);
      }
    }

    .stale {
      font-weight: 500;
      color: #ea580c;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }

    /* ---- Activity ---- */
    .activity-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 16px;
      text-align: center;
      background: #ffffff;
      border: 1px dashed #e2e8f0;
      border-radius: 12px;

      mat-icon {
        margin-bottom: 10px;
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: #94a3b8;
      }
    }

    .activity-empty__title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
    }

    .activity-empty__hint {
      margin-top: 2px;
      font-size: 12.5px;
      color: #64748b;
    }

    .timeline__day {
      display: inline-block;
      margin: 4px 0 12px;
      padding: 3px 10px;
      border-radius: 6px;
      background: #e8f0ff;
      color: #1d4ed8;
      font-size: 12.5px;
      font-weight: 600;
    }

    .timeline__list {
      list-style: none;
      margin: 0 0 14px;
      padding: 0;
    }

    /* time | icon on the line | card */
    .timeline__item {
      --tone: #94a3b8;
      --tone-bg: #f1f5f9;
      display: grid;
      grid-template-columns: 74px 34px minmax(0, 1fr);
      align-items: center;
      column-gap: 14px;
      position: relative;
      padding-bottom: 10px;

      /* Connector line through the icons */
      &::before {
        content: '';
        position: absolute;
        left: calc(74px + 14px + 16px);
        top: 0;
        bottom: 0;
        width: 2px;
        background: #e2e8f0;
      }

      &:first-child::before {
        top: 50%;
      }

      &:last-child::before {
        bottom: 50%;
      }

      &:only-child::before {
        display: none;
      }
    }

    .timeline__item--success { --tone: #16a34a; --tone-bg: #dcfce7; }
    .timeline__item--danger { --tone: #dc2626; --tone-bg: #fee2e2; }
    .timeline__item--info { --tone: #2563eb; --tone-bg: #dbeafe; }
    .timeline__item--warning { --tone: #ea580c; --tone-bg: #ffedd5; }
    .timeline__item--neutral { --tone: #64748b; --tone-bg: #f1f5f9; }

    .timeline__time {
      font-size: 13px;
      color: #334155;
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .timeline__dot {
      position: relative;
      z-index: 1;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid var(--tone);
      color: var(--tone);
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
      }
    }

    .timeline__card {
      min-width: 0;
      padding: 10px 14px;
      background: #ffffff;
      border-radius: 10px;
      border-right: 3px solid var(--tone);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px #eef2f7;
    }

    .timeline__item--danger .timeline__card {
      background: #fffafa;
    }

    .timeline__title {
      font-size: 13.5px;
      font-weight: 600;
      color: #0f172a;
    }

    .timeline__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      font-size: 11.5px;
      font-weight: 500;

      mat-icon {
        font-size: 13px;
        width: 13px;
        height: 13px;
        color: #64748b;
      }
    }

    .chip__label {
      color: #64748b;
    }

    .timeline__by {
      margin-top: 3px;
      font-size: 12px;
      color: #64748b;

      strong {
        color: #334155;
        font-weight: 600;
      }
    }

    .timeline__changes {
      margin: 6px 0 0;
      padding: 8px 10px 8px 26px;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
      font-size: 12px;
      line-height: 1.5;
      color: #475569;
    }

    /* Edit */
    .edit-form {
      display: flex;
      flex-direction: column;
    }

    .field-group {
      display: flex;
      flex-direction: column;
    }

    .field-label {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 6px;
    }

    .required-star {
      color: #ef4444;
    }

    /* Mobile: country code + number inside one outlined field (same 44px box as Email) */
    .mobile-field ::ng-deep {
      .mat-mdc-form-field-icon-prefix {
        align-self: stretch;
        display: flex;
        align-items: center;
        padding: 0 !important;
      }

      .mat-mdc-form-field-infix {
        flex: 1;
      }

      input.mat-mdc-input-element {
        font-size: 14px;
        line-height: 20px;
        color: #0f172a;
        letter-spacing: 0.02em;
        font-variant-numeric: tabular-nums;
      }
    }

    .cc-select {
      /* Plain text look, no native arrow — just the code, then a divider. */
      appearance: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      display: block;
      /* Fixed width so the number never shifts when switching +1 ↔ +971. */
      width: 68px;
      height: 22px;
      margin: 0 12px 0 0;
      padding: 0 4px;
      border: none;
      border-right: 1px solid #cbd5e1;
      border-radius: 0;
      background: transparent;
      color: #0f172a;
      font-family: inherit;
      font-size: 14px;
      line-height: 22px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      /* Centre the code in its box; selects need text-align-last as well. */
      text-align: center;
      text-align-last: center;
      cursor: pointer;
      outline: none;

      &:hover {
        color: #0d9488;
      }

      &:focus-visible {
        color: #0d9488;
      }
    }

    .full-width {
      width: 100%;

      ::ng-deep {
        .mat-mdc-text-field-wrapper {
          background-color: #ffffff !important;
          border-radius: 8px !important;
          padding: 0 14px !important;
          height: 44px !important;
        }

        .mat-mdc-form-field-flex {
          height: 44px !important;
          align-items: center !important;
        }

        .mat-mdc-form-field-infix {
          padding: 6px 0 !important;
          min-height: 0 !important;
          border-top: none !important;
          display: flex;
          align-items: center;
          font-size: 14px;
        }

        .mdc-notched-outline__leading,
        .mdc-notched-outline__notch,
        .mdc-notched-outline__trailing {
          border-color: #cbd5e1 !important;
          border-width: 1px !important;
        }
      }
    }

    .readonly-box {
      border-radius: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-size: 13px;
      color: #334155;
      line-height: 1.5;
      overflow: hidden;
    }

    .readonly-box__header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
    }

    .readonly-box__badge {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
      }
    }

    .readonly-box__title {
      font-size: 13.5px;
      font-weight: 700;
      color: #0f172a;
    }

    .readonly-box__subtitle {
      font-size: 12px;
      color: #64748b;
    }

    .readonly-box__fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 0 14px 12px;
    }

    @media (max-width: 480px) {
      .readonly-box__fields {
        grid-template-columns: 1fr;
      }
    }

    .readonly-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .readonly-field__label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
    }

    .readonly-field__value {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 38px;
      padding: 0 10px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px dashed #cbd5e1;
      color: #334155;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: not-allowed;

      mat-icon {
        flex-shrink: 0;
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #94a3b8;
      }
    }

    .readonly-box__hint {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid #e2e8f0;
      background: #eff6ff;
      color: #475569;
      font-size: 12.5px;

      mat-icon {
        flex-shrink: 0;
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #0057e7;
      }

      strong {
        color: #0f172a;
      }
    }

    /* Footer */
    .panel-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid #e2e8f0;
      background: #f8fafc;
      flex-shrink: 0;
    }

    @media (max-width: 520px) {
      .detail-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class AdminDetailPanelComponent implements OnChanges {
  /** Currency, date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  @Input() isOpen = false;
  @Input() adminId?: string;
  @Input() initialTab: AdminPanelTab = 'details';
  /** Shows an Edit button on the View screen (Admin Management). */
  @Input() showEdit = false;

  /** True when Edit was opened from the View screen, so Cancel/Update return there instead of closing. */
  private editFromView = false;
  @Output() closePanel = new EventEmitter<void>();

  @ViewChild('panelBody') panelBody?: ElementRef<HTMLElement>;

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isOpen && shouldCloseOnEscape(event)) this.closePanel.emit();
  }

  tab: AdminPanelTab = 'details';
  readonly meta = ADMIN_ACTION_META;
  /** Same country list as Settings → General, so codes match across the app. */
  readonly countryCodes = COUNTRY_OPTIONS;
  readonly name = adminFullName;
  readonly actions = availableActions;

  form: FormGroup = this.buildForm();

  constructor(
    private fb: FormBuilder,
    private adminService: AdminService,
    private auditLog: AuditLogService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] && this.isOpen) || changes['adminId'] || changes['initialTab']) {
      this.tab = this.initialTab;
      this.editFromView = false;
      if (this.tab === 'edit') this.form = this.buildForm();
      setTimeout(() => {
        if (this.panelBody) this.panelBody.nativeElement.scrollTop = 0;
      }, 0);
    }
  }

  /** Always read live from the service so status changes show immediately. */
  get admin(): HostelAdmin | undefined {
    return this.adminId ? this.adminService.byId(this.adminId) : undefined;
  }

  initials(a: HostelAdmin): string {
    return `${a.firstName.charAt(0)}${a.lastName.charAt(0)}`.toUpperCase();
  }

  hostelType(a: HostelAdmin): string {
    return REPORT_HOSTELS.find((h) => h.hostelId === a.hostelId)?.hostelType ?? '—';
  }

  passwordAgeDays(a: HostelAdmin): number {
    const since = a.lastPasswordChange ?? a.createdDate;
    return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  }

  /** Sign-ins from the admin's login history merged with Admin actions on the account. */
  get activity(): ActivityItem[] {
    const a = this.admin;
    if (!a) return [];

    const logins: ActivityItem[] = a.loginHistory.map((l) => ({
      timestamp: l.timestamp,
      kind: 'login',
      icon: l.status === 'Success' ? 'login' : 'gpp_bad',
      tone: l.status === 'Success' ? 'success' : 'danger',
      title: l.status === 'Success' ? 'Signed in' : `Failed sign-in${l.reason ? ' — ' + l.reason : ''}`,
      device: l.device,
      ip: l.ipAddress,
    }));

    // Each completed session also produces a sign-out entry.
    const logouts: ActivityItem[] = a.loginHistory
      .filter((l) => l.status === 'Success' && l.logoutAt)
      .map((l) => ({
        timestamp: l.logoutAt!,
        kind: 'logout',
        icon: l.logoutType === 'Session timeout' ? 'timer_off' : 'logout',
        tone: 'neutral',
        title: LOGOUT_TITLES[l.logoutType ?? 'Manual'],
        device: l.device,
        ip: l.ipAddress,
        duration: formatDuration(sessionMinutes(l.timestamp, l.logoutAt!)),
      }));

    const accountEvents: ActivityItem[] = this.auditLog.logs
      .filter((l) => l.entity === a.username)
      .map((l) => ({
        timestamp: l.timestamp,
        kind: 'account',
        icon:
          { Create: 'person_add', Update: 'edit', Activate: 'check_circle', Deactivate: 'block', Lock: 'lock', Unlock: 'lock_open' }[
            auditAction(l)
          ] ?? 'lock_reset',
        tone: l.status === 'Failed' ? 'danger' : ['Lock', 'Deactivate'].includes(auditAction(l)) ? 'warning' : 'info',
        title: `${auditEventLabel(l.event)}${l.status === 'Failed' ? ' (failed)' : ''}`,
        by: l.user,
        changes: l.changes?.map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`),
      }));

    return [...logins, ...logouts, ...accountEvents].sort((x, y) => y.timestamp.localeCompare(x.timestamp));
  }

  /** Activity grouped by calendar day, newest day first. */
  get activityDays(): ActivityDay[] {
    const days: ActivityDay[] = [];
    let currentKey = '';
    for (const item of this.activity) {
      const key = item.timestamp.slice(0, 10);
      if (key !== currentKey) {
        currentKey = key;
        days.push({ label: this.dayLabel(item.timestamp), items: [] });
      }
      days[days.length - 1].items.push(item);
    }
    return days;
  }

  /** Phone/tablet sign-ins get a phone icon; everything else a laptop. */
  deviceIcon(device: string): string {
    return /iPhone|iPad|Android|Mobile/i.test(device) ? 'smartphone' : 'laptop';
  }

  private dayLabel(iso: string): string {
    const day = new Date(iso.slice(0, 10) + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return this.fmt.date(day, 'dayDate');
  }

  /** Button colour: green for Unlock/Activate, red outline for Lock/Deactivate, plain outline otherwise. */
  actionStyle(action: AdminAction): AppButtonVariant {
    if (action === 'unlock' || action === 'activate') return 'success';
    return this.meta[action].danger ? 'danger-outline' : 'secondary';
  }

  run(a: HostelAdmin, action: AdminAction): void {
    this.adminService.perform(a, action).subscribe();
  }

  // ---- Edit ----

  private buildForm(): FormGroup {
    const a = this.adminId ? this.adminService?.byId(this.adminId) : undefined;
    // Name, role, username and hostel are fixed after onboarding — only contact details are editable.
    return this.fb.group({
      email: [a?.email ?? '', [Validators.required, Validators.email]],
      mobileCode: [a?.mobileCode ?? '+91', Validators.required],
      mobile: [a?.mobile ?? '', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    });
  }

  /** Edit button on the View screen: switches the panel to the Edit form. */
  startEdit(): void {
    this.form = this.buildForm();
    this.editFromView = true;
    this.tab = 'edit';
    setTimeout(() => {
      if (this.panelBody) this.panelBody.nativeElement.scrollTop = 0;
    }, 0);
  }

  /** From the View screen's Edit button, Cancel goes back to View; from the list's row action, it returns to the list. */
  cancelEdit(): void {
    if (this.editFromView) {
      this.editFromView = false;
      this.tab = 'details';
      return;
    }
    this.closePanel.emit();
  }

  save(): void {
    const current = this.adminId ? this.adminService.byId(this.adminId) : undefined;
    if (!this.adminId || !current || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.adminService.update(this.adminId, {
      // Names are locked; keep the admin's existing values.
      firstName: current.firstName,
      lastName: current.lastName,
      email: v.email.trim(),
      mobileCode: v.mobileCode,
      mobile: v.mobile,
      role: current.role, // locked
    });
    this.editFromView = false;
    this.tab = 'details';
  }
}
