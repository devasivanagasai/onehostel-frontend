import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { shouldCloseOnEscape } from '../../shared/utils/panel-escape';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AuditLog, auditAction, auditEventLabel, auditModule } from '../../core/models/audit.models';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

/** Centred "Audit Log Details" dialog, opened from the Audit Logs list. */
@Component({
  selector: 'app-audit-log-detail-panel',
  standalone: true,
  imports: [AppDatePipe, CommonModule, MatIconModule, AppButtonComponent],
  template: `
    @if (isOpen && log; as l) {
      <div class="al-backdrop" (click)="closePanel.emit()"></div>

      <div class="al-modal" role="dialog" aria-modal="true" aria-labelledby="al-title">
        <header class="al-header">
          <h2 class="al-title" id="al-title">Audit Log Details — {{ l.logId }}</h2>
          <app-button variant="icon" icon="close" ariaLabel="Close" (clicked)="closePanel.emit()"></app-button>
        </header>

        <div class="al-body">
          <!-- Summary banner -->
          <section class="hero" [class.hero--failed]="failed">
            <span class="hero__badge">
              <mat-icon>{{ failed ? 'close' : 'check' }}</mat-icon>
            </span>
            <div class="hero__text">
              <div class="hero__top">
                <span class="hero__event">{{ eventLabel(l.event) }}</span>
                <span class="hero__status">
                  <mat-icon fontSet="material-icons-outlined">{{ failed ? 'cancel' : 'check_circle' }}</mat-icon>
                  {{ l.status }}
                </span>
              </div>
              <div class="hero__user">{{ l.user }}</div>
            </div>
          </section>

          <!-- Event details -->
          <section class="card" [class.card--failed]="failed">
            <h3 class="card__title">
              <span class="tile tile--sm"><mat-icon fontSet="material-icons-outlined">article</mat-icon></span>
              Event Details
            </h3>

            <div class="details">
              <dl class="details__col">
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">calendar_month</mat-icon></span>Date &amp; Time</dt>
                  <dd>{{ l.timestamp | appDate: 'datetimeSeconds' }}</dd>
                </div>
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">person</mat-icon></span>User</dt>
                  <dd>{{ l.user }}</dd>
                </div>
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">layers</mat-icon></span>Module</dt>
                  <dd>{{ module(l) }}</dd>
                </div>
                <div>
                  <dt><span class="tile tile--blue"><mat-icon fontSet="material-icons-outlined">bolt</mat-icon></span>Action</dt>
                  <dd><span class="action-chip">{{ action(l) }}</span></dd>
                </div>
              </dl>

              <div class="details__divider" aria-hidden="true"></div>

              <dl class="details__col">
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">label</mat-icon></span>Entity</dt>
                  <dd>{{ l.entity }}</dd>
                </div>
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">language</mat-icon></span>IP Address</dt>
                  <dd>{{ l.ipAddress }}</dd>
                </div>
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">tag</mat-icon></span>Log ID</dt>
                  <dd>{{ l.logId }}</dd>
                </div>
                <div>
                  <dt><span class="tile"><mat-icon fontSet="material-icons-outlined">event_note</mat-icon></span>Event</dt>
                  <dd>{{ eventLabel(l.event) }}</dd>
                </div>
              </dl>
            </div>
          </section>

          @if (l.details) {
            <section class="card card--plain">
              <h3 class="card__title">
                <span class="tile tile--sm"><mat-icon fontSet="material-icons-outlined">notes</mat-icon></span>
                Details
              </h3>
              <p class="details-text">{{ l.details }}</p>
            </section>
          }

          @if (l.changes?.length) {
            <section class="card card--plain">
              <h3 class="card__title">
                <span class="tile tile--sm"><mat-icon>difference</mat-icon></span>
                Changes
                <span class="count-pill">{{ l.changes!.length }} {{ l.changes!.length === 1 ? 'change' : 'changes' }}</span>
              </h3>
              <ul class="changes">
                @for (c of l.changes; track $index) {
                  <li class="change">
                    <div class="change__field">{{ c.field }}</div>
                    <div class="change__values">
                      <span class="old-value" [attr.aria-label]="'Old value: ' + c.oldValue">{{ c.oldValue }}</span>
                      <mat-icon class="change__arrow" aria-hidden="true">arrow_forward</mat-icon>
                      <span class="new-value" [attr.aria-label]="'New value: ' + c.newValue">{{ c.newValue }}</span>
                    </div>
                  </li>
                }
              </ul>
            </section>
          }

          <div class="readonly-note">
            <span class="readonly-note__icon"><mat-icon fontSet="material-icons-outlined">lock</mat-icon></span>
            Audit entries are read-only and cannot be edited or deleted.
          </div>
        </div>

        <footer class="al-footer">
          <app-button variant="secondary" icon="download" (clicked)="downloadLog(l)">Download Log</app-button>
          <app-button (clicked)="closePanel.emit()">Close</app-button>
        </footer>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }

    /* Below the CDK overlay (z-index 1000) so tooltips stay on top. */
    .al-backdrop {
      position: fixed;
      inset: 0;
      z-index: 990;
      background: rgba(15, 23, 42, 0.45);
      animation: al-fade 0.18s ease-out;
    }

    .al-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 991;
      width: min(1000px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
      overflow: hidden;
      animation: al-pop 0.2s ease-out;
    }

    @keyframes al-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes al-pop {
      from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    .al-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 28px 12px;
      flex-shrink: 0;
    }

    .al-title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #1e293b;
    }

    .al-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 28px 8px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .al-footer {
      display: flex;
      justify-content: flex-end;
      gap: 14px;
      padding: 16px 28px 22px;
      flex-shrink: 0;
    }

    /* ---- Summary banner ---- */
    .hero {
      --tone: #16a34a;
      display: flex;
      align-items: center;
      gap: 22px;
      padding: 20px 28px;
      border-radius: 12px;
      background: #effaf3;
      border: 1px solid #bfe8cf;
    }

    .hero--failed {
      --tone: #dc2626;
      background: #fdf1f1;
      border-color: #f6caca;
    }

    .hero__badge {
      width: 64px;
      height: 64px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--tone);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.7), 0 6px 16px rgba(15, 23, 42, 0.12);
    }

    .hero__badge mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
    }

    .hero__top {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }

    .hero__event {
      font-size: 26px;
      font-weight: 700;
      color: #0f172a;
    }

    .hero__status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.7);
      color: var(--tone);
      font-size: 15px;
      font-weight: 600;
    }

    .hero__status mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .hero__user {
      margin-top: 4px;
      font-size: 16px;
      color: #64748b;
    }

    /* ---- Cards ---- */
    .card {
      --tone: #16a34a;
      padding: 20px 24px;
      background: #ffffff;
      border-radius: 12px;
      border-left: 4px solid var(--tone);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07), 0 0 0 1px #eef2f7;
    }

    .card--failed {
      --tone: #dc2626;
    }

    .card--plain {
      border-left: none;
    }

    .card__title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      font-size: 17px;
      font-weight: 600;
      color: #0f172a;
    }

    .tile {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 10px;
      background: #effaf3;
      color: #16a34a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .tile mat-icon {
      font-size: 21px;
      width: 21px;
      height: 21px;
    }

    .tile--sm {
      width: 28px;
      height: 28px;
      border-radius: 8px;
    }

    .tile--sm mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .tile--blue {
      background: #eef4ff;
      color: #2563eb;
    }

    .card--failed .tile:not(.tile--blue) {
      background: #fdf1f1;
      color: #dc2626;
    }

    .details {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
      gap: 28px;
    }

    .details__divider {
      background: #eef2f7;
    }

    .details__col {
      margin: 0;
    }

    .details__col > div {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #eef2f7;
    }

    .details__col > div:last-child {
      border-bottom: none;
    }

    .details__col dt {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 15px;
      color: #64748b;
    }

    .details__col dd {
      margin: 0;
      font-size: 15px;
      font-weight: 500;
      color: #0f172a;
      word-break: break-word;
    }

    .action-chip {
      display: inline-block;
      padding: 5px 14px;
      border-radius: 8px;
      background: #eef4ff;
      color: #2563eb;
      font-weight: 600;
    }

    .details-text {
      margin: 0;
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }

    .count-pill {
      margin-left: auto;
      padding: 2px 10px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
    }

    .changes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .change {
      padding: 10px 14px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
    }

    .change__field {
      margin-bottom: 6px;
      font-size: 12.5px;
      font-weight: 600;
      color: #475569;
    }

    .change__values {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 13.5px;
    }

    .old-value {
      padding: 2px 8px;
      border-radius: 6px;
      background: #fee2e2;
      color: #b91c1c;
      text-decoration: line-through;
    }

    .new-value {
      padding: 2px 8px;
      border-radius: 6px;
      background: #dcfce7;
      color: #15803d;
      font-weight: 600;
    }

    .change__arrow {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #94a3b8;
    }

    .readonly-note {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      background: #f1f6ff;
      color: #1d4ed8;
      font-size: 14.5px;
    }

    .readonly-note__icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #e0eaff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .readonly-note__icon mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    @media (max-width: 760px) {
      .details {
        grid-template-columns: 1fr;
      }

      .details__divider {
        display: none;
      }

      .details__col > div {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class AuditLogDetailPanelComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() log?: AuditLog;
  @Output() closePanel = new EventEmitter<void>();

  readonly module = auditModule;
  readonly action = auditAction;
  readonly eventLabel = auditEventLabel;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fmt = inject(AppFormatService);

  get failed(): boolean {
    return this.log?.status === 'Failed';
  }

  ngOnInit(): void {
    // The page area is its own stacking context; on <body> the dialog sits above the side menu.
    document.body.appendChild(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isOpen && shouldCloseOnEscape(event)) this.closePanel.emit();
  }

  /** Saves this entry as a small text file (read-only record for sharing or filing). */
  downloadLog(l: AuditLog): void {
    const lines = [
      `Audit Log ${l.logId}`,
      '',
      `Date & Time : ${this.fmt.date(l.timestamp, 'datetimeSeconds')}`,
      `Event       : ${auditEventLabel(l.event)}`,
      `Module      : ${auditModule(l)}`,
      `Action      : ${auditAction(l)}`,
      `User        : ${l.user}`,
      `Entity      : ${l.entity}`,
      `IP Address  : ${l.ipAddress}`,
      `Status      : ${l.status}`,
      ...(l.details ? ['', `Details     : ${l.details}`] : []),
      ...(l.changes?.length ? ['', 'Changes:', ...l.changes.map((c) => `  - ${c.field}: ${c.oldValue} -> ${c.newValue}`)] : []),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${l.logId}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
