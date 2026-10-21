import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { shouldCloseOnEscape } from '../../shared/utils/panel-escape';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HostelSubscription,
  PaymentMethod,
  PaymentTransaction,
  hasInvoice,
  nextExpiryDate,
  subscriptionsFor,
} from './subscription-payment.models';
import { InvoiceService } from './invoice.service';
import { AmountDue, SubscriptionPaymentService } from './subscription-payment.service';
import { AppFormatService } from '../../core/services/app-format.service';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { statusTone } from '../../shared/constants/status.constants';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-subscription-detail-panel',
  standalone: true,
  imports: [AppDatePipe, AppCurrencyPipe, CommonModule, MatIconModule, MatTooltipModule, AppButtonComponent],
  template: `
    @if (isOpen && subscription; as sub) {
      <div class="sd-backdrop" (click)="closePanel.emit()"></div>

      <div class="sd-modal" role="dialog" aria-modal="true" aria-labelledby="sd-title">
        <!-- Header -->
        <header class="sd-header">
          <h2 class="sd-title" id="sd-title">Subscription Details — {{ sub.subscriptionId }}</h2>
          <app-button variant="icon" icon="close" ariaLabel="Close" (clicked)="closePanel.emit()"></app-button>
        </header>

        <div class="sd-body" #panelBody>
          <!-- Hostel, plan and current period -->
          <section class="hero">
            <div class="hero__identity">
              <span class="hero__icon"><mat-icon>apartment</mat-icon></span>
              <div class="hero__text">
                <div class="hero__name">{{ sub.hostelName }}</div>
                <div class="hero__plan">
                  <span class="hero__plan-name">{{ sub.planName }}</span>
                  <span class="hero__sep" aria-hidden="true">•</span>
                  {{ sub.billingCycle }}
                </div>
                <span class="status-badge status-badge--{{ tone(sub.status) }}">{{ sub.status }}</span>
              </div>
            </div>

            <div class="hero__period">
              <div class="hero__dates">
                <div class="hero__date">
                  <span class="hero__date-label">Start Date</span>
                  <span class="hero__date-value"><mat-icon fontSet="material-icons-outlined">calendar_today</mat-icon>{{ sub.startDate | appDate }}</span>
                </div>
                <div class="hero__date">
                  <span class="hero__date-label">Expiry Date</span>
                  <span class="hero__date-value"><mat-icon fontSet="material-icons-outlined">event</mat-icon>{{ sub.expiryDate | appDate }}</span>
                </div>
                <div class="hero__remaining hero__remaining--{{ periodTone }}">
                  @if (daysRemaining > 0) {
                    <strong>{{ daysRemaining }}</strong> {{ daysRemaining === 1 ? 'day' : 'days' }} remaining
                  } @else {
                    {{ periodCaption }}
                  }
                </div>
              </div>

              <div
                class="hero__bar"
                role="progressbar"
                aria-label="Subscription period elapsed"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="periodElapsedPercent | number: '1.0-0'"
              >
                <div class="hero__fill hero__fill--{{ periodTone }}" [style.width.%]="periodElapsedPercent"></div>
              </div>
              <div class="hero__bar-labels">
                <span>{{ sub.startDate | appDate }}</span>
                <span>{{ sub.expiryDate | appDate }}</span>
              </div>
            </div>
          </section>

          <div class="sd-grid">
            <!-- Plan & Billing -->
            <section class="card">
              <h3 class="card__title"><mat-icon fontSet="material-icons-outlined">credit_card</mat-icon> Plan &amp; Billing</h3>
              <dl class="rows">
                <div><dt>Total Paid</dt><dd>{{ totalPaid | appCurrency: '1.2-2' }}</dd></div>
                <div><dt>Last Payment</dt><dd>{{ lastPayment ? (lastPayment.paymentDate | appDate) : '—' }}</dd></div>
                <div><dt>Plan</dt><dd class="link-text">{{ sub.planName }}</dd></div>
                <div><dt>Billing Cycle</dt><dd>{{ sub.billingCycle }}</dd></div>
                <div>
                  <dt>Amount</dt>
                  <dd>{{ sub.amount > 0 ? (sub.amount | appCurrency: '1.0-2') + ' ' + gstHint : 'Free' }}</dd>
                </div>
                <div>
                  <dt>Payment Status</dt>
                  <dd><span class="status-badge status-badge--{{ tone(sub.paymentStatus) }}">{{ sub.paymentStatus }}</span></dd>
                </div>
              </dl>
            </section>

            <!-- Next payment (with any late fee from System Defaults → Fees) -->
            <section class="card">
              <h3 class="card__title"><mat-icon fontSet="material-icons-outlined">calendar_month</mat-icon> Next Payment</h3>
              @if (amountDue; as due) {
                <div class="due__label">{{ due.daysLate > 0 ? 'Overdue — payable now' : 'Payable Now' }}</div>
                <div class="due__amount" [class.due__amount--late]="due.daysLate > 0">{{ due.payable | appCurrency: '1.2-2' }}</div>

                <dl class="rows rows--compact">
                  <div><dt>{{ due.taxRate > 0 ? 'Plan Amount' : 'Plan' }}</dt><dd>{{ due.amount | appCurrency: '1.2-2' }}</dd></div>
                  @if (due.taxRate > 0) {
                    <div><dt>GST ({{ due.taxRate }}%)</dt><dd>{{ due.tax | appCurrency: '1.2-2' }}</dd></div>
                  }
                  @if (due.lateFee > 0) {
                    <div class="rows__late"><dt>Late payment fee</dt><dd>{{ due.lateFee | appCurrency: '1.2-2' }}</dd></div>
                  }
                  <div class="rows__due">
                    <dt>Due Date</dt>
                    <dd class="link-text"><mat-icon fontSet="material-icons-outlined">event</mat-icon>{{ due.dueDate | appDate }}</dd>
                  </div>
                </dl>

                @if (lateFeeRule; as rule) {
                  <p class="note" [class.note--warn]="due.daysLate > 0">
                    <mat-icon>info</mat-icon>
                    @if (due.lateFee > 0) {
                      Late fee applied: {{ rule }}.
                    } @else if (due.daysLate > 0) {
                      Overdue by {{ due.daysLate }} day{{ due.daysLate === 1 ? '' : 's' }} — still within the grace period. Late fee: {{ rule }}.
                    } @else {
                      A late fee of {{ rule }} applies to overdue payments.
                    }
                  </p>
                }
              } @else {
                <div class="due-empty">
                  <mat-icon>task_alt</mat-icon>
                  <span>No payment due for this subscription.</span>
                </div>
              }
            </section>

            <!-- Payment history: year · timeline dot · payment card -->
            <section class="card card--history">
              <h3 class="card__title"><mat-icon>history</mat-icon> Payment History</h3>

              @if (payments.length === 0) {
                <div class="due-empty">
                  <mat-icon>receipt_long</mat-icon>
                  <span>No payments yet. Payments for this subscription will appear here.</span>
                </div>
              } @else {
                <ol class="timeline">
                  @for (group of paymentYears; track group.year) {
                    @for (p of group.items; track p.transactionId; let first = $first) {
                      <li class="timeline__item">
                        <span class="timeline__year">
                          @if (first) {
                            <span class="year-chip">{{ group.year }}</span>
                          }
                        </span>
                        <span class="timeline__dot" aria-hidden="true"></span>

                        <div class="pay-card">
                          <div class="pay-card__main">
                            <div class="pay-card__top">
                              <span class="pay-card__amount">{{ p.totalAmount | appCurrency: '1.2-2' }}</span>
                              <span class="status-badge status-badge--{{ tone(p.paymentStatus) }}">{{ p.paymentStatus }}</span>
                              @if (p.lateFee) {
                                <span class="late-chip" [matTooltip]="p.daysLate + ' days late'">+ late fee {{ p.lateFee | appCurrency: '1.0-2' }}</span>
                              }
                            </div>
                            <div class="pay-card__sub">{{ p.planName }} • {{ p.billingCycle }}</div>
                            <div class="pay-card__sub">{{ p.paymentDate | appDate }} to {{ periodEnd(p) | appDate }}</div>
                            @if (p.subscriptionId !== sub.subscriptionId) {
                              <div class="pay-card__older" matTooltip="Earlier subscription for this hostel">{{ p.subscriptionId }}</div>
                            }
                          </div>

                          <div class="pay-card__meta">
                            <span>{{ p.paymentDate | appDate }}</span>
                            <span>{{ p.paymentGateway || p.paymentMethod }}</span>
                          </div>

                          <div class="pay-card__actions">
                            @if (hasInvoice(p)) {
                              <button type="button" class="action-link" (click)="invoices.viewInvoice(p)">
                                <span class="action-link__icon"><mat-icon>visibility</mat-icon></span>
                                View Receipt
                              </button>
                              <button type="button" class="action-link" (click)="invoices.downloadReceipt(p)">
                                <span class="action-link__icon"><mat-icon>download</mat-icon></span>
                                Download
                              </button>
                            } @else {
                              <span class="pay-card__no-receipt">No receipt</span>
                            }
                          </div>
                        </div>
                      </li>
                    }
                  }
                </ol>
              }
            </section>
          </div>
        </div>

        <footer class="sd-footer">
          <app-button variant="secondary" (clicked)="closePanel.emit()">Close</app-button>
        </footer>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }

    /* Sits below the CDK overlay (z-index 1000) so tooltips and the invoice dialog open on top. */
    .sd-backdrop {
      position: fixed;
      inset: 0;
      z-index: 990;
      background: rgba(15, 23, 42, 0.45);
      animation: sd-fade 0.18s ease-out;
    }

    .sd-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 991;
      width: min(1240px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
      overflow: hidden;
      animation: sd-pop 0.2s ease-out;
    }

    @keyframes sd-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes sd-pop {
      from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    .sd-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid #eef2f7;
      flex-shrink: 0;
    }

    .sd-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
    }

    .sd-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px 24px;
      background: #f8fafc;
    }

    .sd-footer {
      display: flex;
      justify-content: flex-end;
      padding: 14px 24px;
      border-top: 1px solid #eef2f7;
      background: #ffffff;
      flex-shrink: 0;
    }

    /* ---- Hero: hostel + period ---- */
    .hero {
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
      gap: 32px;
      align-items: center;
      padding: 20px 24px;
      margin-bottom: 18px;
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 0 0 1px #eef2f7;
    }

    @media (max-width: 900px) {
      .hero {
        grid-template-columns: 1fr;
      }
    }

    .hero__identity {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    .hero__icon {
      width: 88px;
      height: 88px;
      flex-shrink: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, #e0ecff, #f1f6ff);
      color: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 46px;
        width: 46px;
        height: 46px;
      }
    }

    .hero__text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      min-width: 0;
    }

    .hero__name {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
    }

    .hero__plan {
      font-size: 15px;
      color: #334155;
    }

    .hero__plan-name {
      color: #2563eb;
      font-weight: 600;
    }

    .hero__sep {
      margin: 0 6px;
      color: #94a3b8;
    }

    .hero__dates {
      display: grid;
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 28px;
      margin-bottom: 14px;
    }

    .hero__date {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-right: 28px;
      border-right: 1px solid #e5eaf1;
    }

    .hero__date-label {
      font-size: 12.5px;
      color: #64748b;
    }

    .hero__date-value {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 17px;
      font-weight: 600;
      color: #0f172a;

      mat-icon {
        font-size: 19px;
        width: 19px;
        height: 19px;
        color: #64748b;
      }
    }

    .hero__remaining {
      font-size: 17px;
      color: #16a34a;
      text-align: center;

      strong {
        font-size: 20px;
        font-weight: 700;
      }
    }

    .hero__remaining--warn { color: #d97706; }
    .hero__remaining--ended { color: #dc2626; }

    .hero__bar {
      height: 12px;
      border-radius: 999px;
      background: #e8eef8;
      overflow: hidden;
    }

    .hero__fill {
      height: 100%;
      border-radius: inherit;
      background: #2563eb;
      transition: width 0.3s ease;
    }

    .hero__fill--warn { background: #f59e0b; }
    .hero__fill--ended { background: #ef4444; }

    .hero__bar-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 12.5px;
      color: #475569;
    }

    /* ---- Three cards ---- */
    .sd-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.75fr);
      gap: 18px;
      align-items: start;
    }

    @media (max-width: 1100px) {
      .sd-grid {
        grid-template-columns: 1fr 1fr;
      }

      .card--history {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 700px) {
      .sd-grid {
        grid-template-columns: 1fr;
      }
    }

    .card {
      padding: 20px;
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 0 0 1px #eef2f7;
    }

    .card__title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: #2563eb;
      }
    }

    .rows {
      margin: 0;

      > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid #eef2f7;
      }

      > div:last-child {
        border-bottom: none;
      }

      dt {
        font-size: 13.5px;
        color: #475569;
      }

      dd {
        margin: 0;
        font-size: 13.5px;
        font-weight: 500;
        color: #0f172a;
        text-align: right;
      }
    }

    .rows--compact > div {
      padding: 10px 0;
    }

    .rows__late dt,
    .rows__late dd {
      color: #b45309;
    }

    .link-text {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #2563eb !important;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #64748b;
      }
    }

    .due__label {
      font-size: 13px;
      color: #64748b;
    }

    .due__amount {
      margin: 6px 0 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid #eef2f7;
      font-size: 30px;
      font-weight: 700;
      color: #16a34a;
    }

    .due__amount--late {
      color: #dc2626;
    }

    .note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 14px 0 0;
      padding: 12px 14px;
      border-radius: 10px;
      background: #ecfbf2;
      color: #166534;
      font-size: 12.5px;
      line-height: 1.5;

      mat-icon {
        flex-shrink: 0;
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #16a34a;
      }
    }

    .note--warn {
      background: #fff7e6;
      color: #92400e;

      mat-icon {
        color: #d97706;
      }
    }

    .due-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 28px 12px;
      text-align: center;
      font-size: 13px;
      color: #64748b;

      mat-icon {
        font-size: 30px;
        width: 30px;
        height: 30px;
        color: #94a3b8;
      }
    }

    /* ---- Payment history timeline ---- */
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .timeline__item {
      position: relative;
      display: grid;
      grid-template-columns: 56px 20px minmax(0, 1fr);
      align-items: center;
      column-gap: 10px;
      padding-bottom: 12px;

      /* Line through the dots */
      &::before {
        content: '';
        position: absolute;
        left: calc(56px + 10px + 9px);
        top: 0;
        bottom: 0;
        width: 2px;
        background: #dbe6fb;
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

    .year-chip {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      background: #eef2f7;
      color: #0f172a;
      font-size: 13px;
      font-weight: 600;
    }

    .timeline__dot {
      position: relative;
      z-index: 1;
      width: 12px;
      height: 12px;
      margin-left: 4px;
      border-radius: 50%;
      background: #2563eb;
      box-shadow: 0 0 0 3px #ffffff;
    }

    .pay-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06), 0 0 0 1px #eef2f7;
    }

    .pay-card__main {
      min-width: 0;
    }

    .pay-card__top {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 4px;
    }

    .pay-card__amount {
      font-size: 14.5px;
      font-weight: 700;
      color: #0f172a;
    }

    .pay-card__sub {
      font-size: 12.5px;
      line-height: 1.6;
      color: #64748b;
    }

    .pay-card__older {
      display: inline-block;
      margin-top: 4px;
      padding: 1px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      font-size: 11.5px;
    }

    .pay-card__meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #334155;
      text-align: center;
      white-space: nowrap;
    }

    .pay-card__actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-left: 16px;
      border-left: 1px solid #eef2f7;
    }

    .pay-card__no-receipt {
      font-size: 12px;
      color: #94a3b8;
    }

    .action-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-size: 13px;
      color: #0f172a;
      cursor: pointer;
      white-space: nowrap;

      &:hover {
        color: #2563eb;
      }

      &:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
    }

    .action-link__icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #f1f5f9;
      color: #334155;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
      }
    }

    .action-link:hover .action-link__icon {
      background: #e8f0ff;
      color: #2563eb;
    }

    .late-chip {
      padding: 1px 8px;
      border-radius: 6px;
      background: #fff7e6;
      color: #b45309;
      font-size: 11.5px;
      font-weight: 600;
    }

    /* Status tags (same look as the list tables) */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;

      &::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
    }

    .status-badge--success { background: #dcfce7; color: #16a34a; }
    .status-badge--warning { background: #ffedd5; color: #ea580c; }
    .status-badge--danger { background: #fee2e2; color: #dc2626; }
    .status-badge--info { background: #e0f2fe; color: #0284c7; }
    .status-badge--neutral { background: #f1f5f9; color: #64748b; }

    @media (max-width: 700px) {
      .pay-card {
        grid-template-columns: 1fr;
      }

      .pay-card__actions {
        flex-direction: row;
        padding-left: 0;
        border-left: none;
      }

      .hero__dates {
        grid-template-columns: 1fr 1fr;
      }
    }
  `],
})
export class SubscriptionDetailPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() subscription?: HostelSubscription;
  /** All payments; filtered down to this subscription's history. */
  @Input() allPayments: PaymentTransaction[] = [];
  /** All subscriptions; used to include payments from the hostel's earlier subscription IDs. */
  @Input() allSubscriptions: HostelSubscription[] = [];

  @Output() closePanel = new EventEmitter<void>();

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isOpen && shouldCloseOnEscape(event)) this.closePanel.emit();
  }

  @ViewChild('panelBody') panelBody?: ElementRef<HTMLElement>;

  private readonly fmt = inject(AppFormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    // The page area is its own stacking context, so a fixed dialog inside it would sit under the
    // side menu. Living on <body> keeps it above the app (and below the invoice dialog overlay).
    document.body.appendChild(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  readonly hasInvoice = hasInvoice;
  readonly tone = statusTone;

  constructor(
    public invoices: InvoiceService,
    private settings: SystemSettingsService,
    private store: SubscriptionPaymentService,
  ) {}

  /** The next payment for this subscription, with any late fee per Settings → Fees (null if nothing to pay). */
  get amountDue(): AmountDue | null {
    return this.subscription ? this.store.amountDueNow(this.subscription) : null;
  }

  /** Late-fee rule wording for the "Next payment" box, e.g. "₹100 after a 5-day grace period". */
  get lateFeeRule(): string | null {
    const p = this.store.lateFeePolicy;
    if (!p.enabled || p.value <= 0) return null;
    const fee = p.type === 'Percentage' ? `${p.value}% of the amount due` : this.fmt.money(p.value);
    return `${fee} after a ${p.graceDays}-day grace period`;
  }

  /** How GST applies to the plan price, per Settings → Fees (for the next billing). */
  get gstHint(): string {
    const p = this.settings.settings.fees;
    if (!p.gstEnabled || p.gstRate <= 0) return 'no GST';
    return p.pricesIncludeTax ? `incl. ${p.gstRate}% GST` : `+ ${p.gstRate}% GST`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      setTimeout(() => {
        if (this.panelBody) this.panelBody.nativeElement.scrollTop = 0;
      }, 0);
    }
  }

  /**
   * Every payment for this hostel, newest first: all billing periods of the
   * current subscription (renewals keep the same ID) plus any earlier, closed
   * subscriptions the hostel had before re-subscribing.
   */
  get payments(): PaymentTransaction[] {
    const sub = this.subscription;
    if (!sub) return [];
    const ids = new Set([sub.subscriptionId, ...subscriptionsFor(this.allSubscriptions, sub.hostelId).map((s) => s.subscriptionId)]);
    return this.allPayments
      .filter((p) => ids.has(p.subscriptionId))
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.transactionId.localeCompare(a.transactionId));
  }

  /** Payment history grouped by calendar year, newest year first. */
  get paymentYears(): { year: string; items: PaymentTransaction[] }[] {
    const groups: { year: string; items: PaymentTransaction[] }[] = [];
    for (const p of this.payments) {
      const year = p.paymentDate.slice(0, 4);
      if (groups[groups.length - 1]?.year !== year) groups.push({ year, items: [] });
      groups[groups.length - 1].items.push(p);
    }
    return groups;
  }

  /** Billing period a payment covers: from its payment date to the day before the next cycle starts. */
  periodEnd(p: PaymentTransaction): string {
    const [y, m, d] = p.paymentDate.split('-').map(Number);
    const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    return nextExpiryDate(dayBefore, p.billingCycle);
  }

  get lastPayment(): PaymentTransaction | undefined {
    return this.payments.find((p) => p.paymentStatus === 'Paid');
  }

  get totalPaid(): number {
    return this.payments.filter((p) => p.paymentStatus === 'Paid').reduce((sum, p) => sum + p.totalAmount, 0);
  }

  /** Icon for each payment method, tinted by payment status in the history list. */
  methodIcon(method: PaymentMethod): string {
    return { UPI: 'qr_code_2', Card: 'credit_card', 'Net Banking': 'account_balance', 'Bank Transfer': 'account_balance' }[method] ?? 'payments';
  }

  get cycleUnit(): string {
    const cycle = this.subscription?.billingCycle;
    return cycle === 'Yearly' ? 'yr' : cycle === 'Quarterly' ? 'qtr' : 'mo';
  }

  /** Whole days until expiry; negative once the expiry date has passed. */
  get daysRemaining(): number {
    if (!this.subscription) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(`${this.subscription.expiryDate}T00:00:00`);
    return Math.round((expiry.getTime() - today.getTime()) / DAY_MS);
  }

  get periodElapsedPercent(): number {
    if (!this.subscription) return 0;
    const start = new Date(`${this.subscription.startDate}T00:00:00`).getTime();
    const end = new Date(`${this.subscription.expiryDate}T00:00:00`).getTime();
    const pct = ((Date.now() - start) / Math.max(end - start, DAY_MS)) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  /** Colour of the period bar and "days remaining": blue/green normally, amber in the last week, red once ended. */
  get periodTone(): 'ok' | 'warn' | 'ended' {
    const days = this.daysRemaining;
    return days < 0 ? 'ended' : days <= 7 ? 'warn' : 'ok';
  }

  get periodCaption(): string {
    const days = this.daysRemaining;
    if (days < 0) return `Ended ${-days} day${days === -1 ? '' : 's'} ago`;
    if (days === 0) return 'Expires today';
    return `${days} day${days === 1 ? '' : 's'} remaining`;
  }
}
