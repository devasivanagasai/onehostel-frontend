import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HostelSubscription,
  PAYMENT_STATUSES,
  PaymentTransaction,
  SUBSCRIPTION_STATUSES,
  hasInvoice,
} from './subscription-payment.models';
import { SubscriptionDetailPanelComponent } from './subscription-detail-panel.component';
import { InvoiceService } from './invoice.service';
import { SubscriptionPaymentService } from './subscription-payment.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { statusTone } from '../../shared/constants/status.constants';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { isOnboardedHostel } from '../hostel-onboarding/onboarded-hostels';

type TabKey = 'subscriptions' | 'payments';

const EXPIRING_WINDOW_DAYS = 30;

@Component({
  selector: 'app-subscription-payments',
  standalone: true,
  imports: [
    AppDatePipe,
    AppCurrencyPipe,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    MatTooltipModule,
    SubscriptionDetailPanelComponent,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  template: `
    <div class="onboarding-page">
      <!-- Summary tiles -->
      <div class="stat-row">
        <div class="stat-tile stat-tile--green">
          <span class="stat-tile__icon"><mat-icon fontSet="material-icons-outlined">inventory_2</mat-icon></span>
          <span class="stat-tile__text">
            <span class="stat-tile__label">Active Subscriptions</span>
            <span class="stat-tile__value">{{ countByStatus('Active') }}</span>
            <span class="stat-tile__sub">
              @if (countByStatus('Trial')) {
                <strong>+{{ countByStatus('Trial') }}</strong> on trial
              } @else {
                No trials running
              }
            </span>
          </span>
        </div>

        <div class="stat-tile stat-tile--orange">
          <span class="stat-tile__icon"><mat-icon fontSet="material-icons-outlined">schedule</mat-icon></span>
          <span class="stat-tile__text">
            <span class="stat-tile__label">Payment Pending</span>
            <span class="stat-tile__value">{{ countByStatus('Payment Pending') }}</span>
            <span class="stat-tile__sub stat-tile__sub--tone">
              {{ countByStatus('Payment Pending') ? 'Needs attention' : 'All caught up' }}
            </span>
          </span>
        </div>

        <div class="stat-tile stat-tile--blue">
          <span class="stat-tile__icon"><mat-icon fontSet="material-icons-outlined">calendar_month</mat-icon></span>
          <span class="stat-tile__text">
            <span class="stat-tile__label">Expiring in {{ expiringWindowDays }} days</span>
            <span class="stat-tile__value">{{ expiringSoonCount }}</span>
            <span class="stat-tile__sub stat-tile__sub--tone">
              {{ expiringSoonCount ? 'Renew before they lapse' : 'No subscriptions' }}
            </span>
          </span>
        </div>

        <div class="stat-tile stat-tile--indigo">
          <span class="stat-tile__icon"><mat-icon>currency_rupee</mat-icon></span>
          <span class="stat-tile__text">
            <span class="stat-tile__label">Total Collected</span>
            <span class="stat-tile__value">{{ totalCollected | appCurrency: '1.0-0' }}</span>
            <span class="stat-tile__sub">
              <mat-icon class="stat-tile__trend">trending_up</mat-icon>
              <strong class="stat-tile__good">{{ paidCount }}</strong> paid {{ paidCount === 1 ? 'payment' : 'payments' }}
            </span>
          </span>
        </div>
      </div>

      <app-table-card
        class="subscription-table-card"
        [empty]="activeCount === 0"
        [emptyMessage]="emptyMessage"
        [emptyHint]="hasFilters ? 'Try a different search or status, or clear the filters.' : ''"
        [clearable]="hasFilters"
        (clear)="resetFilters()"
        [page]="safePage"
        [totalPages]="totalPages"
        [pageSize]="pageSize"
        (pageChange)="setPage($event)"
        (pageSizeChange)="pageSize = $event; setPage(0)"
      >
        <div tableToolbar>
        <!-- Tabs -->
        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab--active]="activeTab === 'subscriptions'"
            [attr.aria-selected]="activeTab === 'subscriptions'"
            (click)="activeTab = 'subscriptions'"
          >
            Subscriptions
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab--active]="activeTab === 'payments'"
            [attr.aria-selected]="activeTab === 'payments'"
            (click)="activeTab = 'payments'"
          >
            Payments
          </button>
        </div>

        <!-- Filters: search + dropdowns -->
        <div class="filter-bar">
          <mat-form-field appearance="outline" class="filter-field filter-field--search">
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              type="text"
              [placeholder]="activeTab === 'subscriptions' ? 'Search by Subscription ID, Hostel or Plan' : 'Search by Transaction ID, Hostel or Invoice'"
              [(ngModel)]="search[activeTab]"
              (ngModelChange)="setPage(0)"
            />
            <button
              *ngIf="search[activeTab]"
              mat-icon-button
              matSuffix
              type="button"
              class="filter-clear-btn"
              aria-label="Clear search"
              (click)="search[activeTab] = ''"
            >
              <mat-icon>close</mat-icon>
            </button>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">apartment</mat-icon>
            <mat-select [(ngModel)]="hostelFilter[activeTab]" (ngModelChange)="setPage(0)" aria-label="Filter by hostel">
              <mat-option value="All">All</mat-option>
              @for (h of hostelOptions; track h) {
                <mat-option [value]="h">{{ h }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">sell</mat-icon>
            <mat-select [(ngModel)]="planFilter[activeTab]" (ngModelChange)="setPage(0)" aria-label="Filter by plan">
              <mat-option value="All">All</mat-option>
              @for (pl of planOptions; track pl) {
                <mat-option [value]="pl">{{ pl }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">{{ activeTab === 'subscriptions' ? 'event_repeat' : 'account_balance_wallet' }}</mat-icon>
            <mat-select [(ngModel)]="extraFilter[activeTab]" (ngModelChange)="setPage(0)" [attr.aria-label]="activeTab === 'subscriptions' ? 'Filter by billing cycle' : 'Filter by payment method'">
              <mat-option value="All">All</mat-option>
              @for (o of extraOptions; track o) {
                <mat-option [value]="o">{{ o }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">toggle_on</mat-icon>
            <mat-select [ngModel]="statusFilter[activeTab]" (ngModelChange)="setStatus($event)" aria-label="Filter by status">
              <mat-option value="All">All</mat-option>
              @for (st of statusOptions; track st) {
                <mat-option [value]="st">{{ st }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          @if (hasFilters) {
            <app-button variant="text" size="sm" icon="restart_alt" (clicked)="resetFilters()">Reset</app-button>
          }
        </div>
        </div>

        <!-- Subscriptions table (header stays visible when empty) -->
        @if (activeTab === 'subscriptions') {
            <table mat-table [dataSource]="pagedSubscriptions" class="saas-table">
              <ng-container matColumnDef="subscriptionId">
                <th mat-header-cell *matHeaderCellDef> Subscription ID </th>
                <td mat-cell *matCellDef="let el">
                  <button type="button" class="id-link" (click)="openSubscription(el)">{{ el.subscriptionId }}</button>
                </td>
              </ng-container>

              <ng-container matColumnDef="hostel">
                <th mat-header-cell *matHeaderCellDef> Hostel </th>
                <td mat-cell *matCellDef="let el">
                  <div class="list-entity">
                    <span class="list-entity__avatar list-avatar--{{ hostelTone(el.hostelName) }}">{{ initials(el.hostelName) }}</span>
                    <span class="list-entity__name">{{ el.hostelName }}</span>
                  </div>
                </td>
              </ng-container>

              <ng-container matColumnDef="plan">
                <th mat-header-cell *matHeaderCellDef> Plan </th>
                <td mat-cell *matCellDef="let el"><span class="plan-tag plan-tag--{{ el.planName.toLowerCase() }}">{{ el.planName }}</span></td>
              </ng-container>

              <!-- Start and expiry stacked in one column so every column fits beside the sidebar -->
              <ng-container matColumnDef="period">
                <th mat-header-cell *matHeaderCellDef> Period </th>
                <td mat-cell *matCellDef="let el">
                  <span class="list-entity__text">
                    <span>{{ el.startDate | appDate }}</span>
                    <span
                      class="list-entity__sub"
                      [class.expiring-soon]="isExpiringSoon(el)"
                      [matTooltip]="isExpiringSoon(el) ? 'Expires within ' + expiringWindowDays + ' days' : ''"
                    >to {{ el.expiryDate | appDate }}</span>
                  </span>
                </td>
              </ng-container>

              <ng-container matColumnDef="billingCycle">
                <th mat-header-cell *matHeaderCellDef> Billing Cycle </th>
                <td mat-cell *matCellDef="let el"> {{ el.billingCycle }} </td>
              </ng-container>

              <ng-container matColumnDef="amount">
                <th mat-header-cell *matHeaderCellDef class="num"> Amount </th>
                <td mat-cell *matCellDef="let el" class="num amount">
                  {{ el.amount > 0 ? (el.amount | appCurrency: '1.0-2') : 'Free' }}
                </td>
              </ng-container>

              <ng-container matColumnDef="paymentStatus">
                <th mat-header-cell *matHeaderCellDef> Payment Status </th>
                <td mat-cell *matCellDef="let el">
                  <span class="status-badge status-badge--{{ tone(el.paymentStatus) }}">{{ el.paymentStatus }}</span>
                </td>
              </ng-container>

              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef> Subscription Status </th>
                <td mat-cell *matCellDef="let el">
                  <span class="status-badge status-badge--{{ tone(el.status) }}">{{ el.status }}</span>
                </td>
              </ng-container>

              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef class="actions-header"> Actions </th>
                <td mat-cell *matCellDef="let el" class="actions-cell">
                  <app-button variant="outline" size="sm" icon="visibility" [ariaLabel]="'View ' + el.subscriptionId" (clicked)="openSubscription(el)">
                    View
                  </app-button>
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="subscriptionColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: subscriptionColumns;" class="table-row"></tr>
            </table>
        }

        <!-- Payments table (header stays visible when empty) -->
        @if (activeTab === 'payments') {
            <table mat-table [dataSource]="pagedPayments" class="saas-table">
              <ng-container matColumnDef="transactionId">
                <th mat-header-cell *matHeaderCellDef> Transaction ID </th>
                <td mat-cell *matCellDef="let el" class="font-medium"> {{ el.transactionId }} </td>
              </ng-container>

              <ng-container matColumnDef="subscriptionId">
                <th mat-header-cell *matHeaderCellDef> Subscription ID </th>
                <td mat-cell *matCellDef="let el">
                  <button type="button" class="id-link" (click)="openSubscriptionById(el.subscriptionId)">
                    {{ el.subscriptionId }}
                  </button>
                </td>
              </ng-container>

              <ng-container matColumnDef="hostel">
                <th mat-header-cell *matHeaderCellDef> Hostel </th>
                <td mat-cell *matCellDef="let el">
                  <div class="list-entity">
                    <span class="list-entity__avatar list-avatar--{{ hostelTone(el.hostelName) }}">{{ initials(el.hostelName) }}</span>
                    <span class="list-entity__name">{{ el.hostelName }}</span>
                  </div>
                </td>
              </ng-container>

              <ng-container matColumnDef="plan">
                <th mat-header-cell *matHeaderCellDef> Plan </th>
                <td mat-cell *matCellDef="let el"><span class="plan-tag plan-tag--{{ el.planName.toLowerCase() }}">{{ el.planName }}</span></td>
              </ng-container>

              <ng-container matColumnDef="totalAmount">
                <th mat-header-cell *matHeaderCellDef class="num"> Total Amount </th>
                <td mat-cell *matCellDef="let el" class="num amount"> {{ el.totalAmount | appCurrency: '1.2-2' }} </td>
              </ng-container>

              <ng-container matColumnDef="paymentDate">
                <th mat-header-cell *matHeaderCellDef> Payment Date </th>
                <td mat-cell *matCellDef="let el"> {{ el.paymentDate | appDate }} </td>
              </ng-container>

              <ng-container matColumnDef="paymentMethod">
                <th mat-header-cell *matHeaderCellDef> Payment Method </th>
                <td mat-cell *matCellDef="let el">
                  <span class="method"><mat-icon class="method__icon">{{ methodIcon(el.paymentMethod) }}</mat-icon>{{ el.paymentMethod }}</span>
                </td>
              </ng-container>

              <ng-container matColumnDef="paymentGateway">
                <th mat-header-cell *matHeaderCellDef> Payment Gateway </th>
                <td mat-cell *matCellDef="let el"> {{ el.paymentGateway }} </td>
              </ng-container>

              <ng-container matColumnDef="paymentStatus">
                <th mat-header-cell *matHeaderCellDef> Payment Status </th>
                <td mat-cell *matCellDef="let el">
                  <span class="status-badge status-badge--{{ tone(el.paymentStatus) }}">{{ el.paymentStatus }}</span>
                </td>
              </ng-container>

              <ng-container matColumnDef="invoiceNumber">
                <th mat-header-cell *matHeaderCellDef> Invoice Number </th>
                <td mat-cell *matCellDef="let el" class="invoice-no"> {{ el.invoiceNumber || '—' }} </td>
              </ng-container>

              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef class="actions-header"> Actions </th>
                <td mat-cell *matCellDef="let el" class="actions-cell">
                  <app-button
                    variant="icon-outline"
                    size="sm"
                    icon="description"
                    [disabled]="!hasInvoice(el)"
                    [matTooltip]="hasInvoice(el) ? 'View Invoice' : 'No invoice for ' + el.paymentStatus.toLowerCase() + ' payments'"
                    ariaLabel="View invoice"
                    (clicked)="invoices.viewInvoice(el)"
                  ></app-button>
                  <app-button
                    variant="icon-outline"
                    size="sm"
                    icon="download"
                    [disabled]="!hasInvoice(el)"
                    [matTooltip]="hasInvoice(el) ? 'Download Receipt' : ''"
                    ariaLabel="Download receipt"
                    (clicked)="invoices.downloadReceipt(el)"
                  ></app-button>
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="paymentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: paymentColumns;" class="table-row"></tr>
            </table>
        }
      </app-table-card>
    </div>

    <app-subscription-detail-panel
      [isOpen]="isPanelOpen"
      [subscription]="selectedSubscription"
      [allPayments]="payments"
      [allSubscriptions]="subscriptions"
      (closePanel)="isPanelOpen = false"
    ></app-subscription-detail-panel>
  `,
  styles: [`
    /* Card, table, badges, empty state and pagination: src/styles/_table.scss */

    /* Summary tiles: round icon, label, big coloured number, short status line */
    .stat-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    @media (max-width: 1100px) {
      .stat-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .stat-row {
        grid-template-columns: 1fr;
      }
    }

    .stat-tile {
      --tone: #2563eb;
      --tone-bg: #eaf1ff;
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 20px 22px;
      background: #ffffff;
      border: none;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04);
      text-align: left;
    }

    .stat-tile--green { --tone: #16a34a; --tone-bg: #e8f7ee; }
    .stat-tile--orange { --tone: #ea580c; --tone-bg: #fff1e6; }
    .stat-tile--blue { --tone: #2563eb; --tone-bg: #eaf1ff; }
    .stat-tile--indigo { --tone: #2563eb; --tone-bg: #e8eeff; }

    .stat-tile__icon {
      width: 56px;
      height: 56px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone);
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 26px;
        width: 26px;
        height: 26px;
      }
    }

    .stat-tile__text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .stat-tile__label {
      font-size: 13px;
      color: #475569;
    }

    .stat-tile__value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--tone);
      white-space: nowrap;
    }

    .stat-tile__sub {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #64748b;

      strong {
        font-weight: 600;
        color: #16a34a;
      }
    }

    .stat-tile__sub--tone {
      color: var(--tone);
    }

    .stat-tile__trend {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: #16a34a;
    }

    /* Tabs sit above the filters, so the card needs less top padding. */
    .subscription-table-card {
      padding-top: 14px;
    }

    /* Tabs: blue underline on the active one */
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 18px;
    }

    .tab {
      padding: 12px 16px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      color: #475569;
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease;

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

    /* Filters */
    /* Compact filters: fixed widths instead of stretching across the card */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;

      .filter-field {
        width: 160px;
        max-width: 100%;
      }

      .filter-field--search {
        width: 280px;
      }

      @media (max-width: 600px) {
        .filter-field,
        .filter-field--search {
          width: 100%;
        }
      }
    }

    .filter-bar mat-icon[matPrefix] {
      color: #64748b;
    }

    /* Payments: method with icon, invoice number */
    .method {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #334155;
      white-space: nowrap;
    }

    .method__icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #2563eb;
    }

    .invoice-no {
      color: #334155 !important;
      white-space: nowrap;
    }

    /* Table cells */
    .id-link {
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-weight: 500;
      color: #2563eb;
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }

    .plan-tag {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      background: #f1f5f9;
      color: #475569;
    }

    .plan-tag--premium { background: #e8f0ff; color: #1d4ed8; }
    .plan-tag--standard { background: #e6f7ef; color: #15803d; }
    .plan-tag--basic { background: #f3eefe; color: #6d28d9; }

    .amount {
      font-weight: 700;
      color: #0f172a !important;
    }

    .saas-table .num {
      text-align: right;
    }

    .expiring-soon {
      color: #d97706;
      font-weight: 600;
    }

    .link-cell {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      color: #0057e7;
      font-weight: 600;
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }
  `],
})
export class SubscriptionPaymentsComponent {
  activeTab: TabKey = 'subscriptions';
  pageSize = 10;

  /** Search, status filter and page are kept per tab so switching tabs doesn't lose them. */
  search: Record<TabKey, string> = { subscriptions: '', payments: '' };
  statusFilter: Record<TabKey, string> = { subscriptions: 'All', payments: 'All' };
  hostelFilter: Record<TabKey, string> = { subscriptions: 'All', payments: 'All' };
  planFilter: Record<TabKey, string> = { subscriptions: 'All', payments: 'All' };
  /** Billing cycle (Subscriptions) or payment method (Payments). */
  extraFilter: Record<TabKey, string> = { subscriptions: 'All', payments: 'All' };
  currentPage: Record<TabKey, number> = { subscriptions: 0, payments: 0 };

  readonly expiringWindowDays = EXPIRING_WINDOW_DAYS;
  readonly hasInvoice = hasInvoice;
  readonly tone = statusTone;

  /**
   * Live lists from the shared store, so recorded payments show up everywhere at once.
   * Only onboarded hostels (the Onboard Hostel list) are shown; payments follow their subscription's hostel.
   */
  get subscriptions(): HostelSubscription[] {
    return this.store.subscriptions.filter((s) => isOnboardedHostel(s.hostelId));
  }

  get payments(): PaymentTransaction[] {
    const ids = new Set(this.subscriptions.map((s) => s.subscriptionId));
    return this.store.payments.filter((p) => ids.has(p.subscriptionId));
  }

  subscriptionColumns = [
    'subscriptionId',
    'hostel',
    'plan',
    'period',
    'billingCycle',
    'amount',
    'paymentStatus',
    'status',
    'actions',
  ];

  paymentColumns = [
    'transactionId',
    'subscriptionId',
    'hostel',
    'plan',
    'totalAmount',
    'paymentDate',
    'paymentMethod',
    'paymentGateway',
    'paymentStatus',
    'invoiceNumber',
    'actions',
  ];

  isPanelOpen = false;
  /** Tracked by ID so the panel shows the latest data after a payment updates the subscription. */
  private selectedSubscriptionId?: string;

  get selectedSubscription(): HostelSubscription | undefined {
    return this.selectedSubscriptionId ? this.store.bySubscriptionId(this.selectedSubscriptionId) : undefined;
  }

  constructor(
    public invoices: InvoiceService,
    private store: SubscriptionPaymentService,
  ) {}

  get statusOptions(): string[] {
    return this.activeTab === 'subscriptions' ? SUBSCRIPTION_STATUSES : PAYMENT_STATUSES;
  }

  private get activeRows(): (HostelSubscription | PaymentTransaction)[] {
    return this.activeTab === 'subscriptions' ? this.subscriptions : this.payments;
  }

  get hostelOptions(): string[] {
    return [...new Set(this.activeRows.map((r) => r.hostelName))].sort();
  }

  get planOptions(): string[] {
    return [...new Set(this.activeRows.map((r) => r.planName))].sort();
  }

  /** Billing cycles (Subscriptions) or payment methods (Payments) present in the data. */
  get extraOptions(): string[] {
    const values =
      this.activeTab === 'subscriptions'
        ? this.subscriptions.map((s) => s.billingCycle as string)
        : this.payments.map((p) => p.paymentMethod as string);
    return [...new Set(values)].filter(Boolean).sort();
  }

  setStatus(status: string): void {
    this.statusFilter[this.activeTab] = status;
    this.setPage(0);
  }

  /** "Grand Stay Hostel" → "GS" */
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  /** A stable avatar colour per hostel name. */
  hostelTone(name: string): string {
    const tones = ['blue', 'purple', 'green', 'amber'];
    return tones[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tones.length];
  }

  // ---- Summary tiles ----

  countByStatus(status: string): number {
    return this.subscriptions.filter((s) => s.status === status).length;
  }

  /** Icon per payment method (Payments table). */
  methodIcon(method: string): string {
    return { UPI: 'qr_code_2', Card: 'credit_card', 'Net Banking': 'account_balance', 'Bank Transfer': 'account_balance' }[method] ?? 'payments';
  }

  get paidCount(): number {
    return this.payments.filter((p) => p.paymentStatus === 'Paid').length;
  }

  get totalCollected(): number {
    return this.payments.filter((p) => p.paymentStatus === 'Paid').reduce((sum, p) => sum + p.totalAmount, 0);
  }

  /** Live subscriptions (not already ended/cancelled) whose expiry falls within the window. */
  isExpiringSoon(sub: HostelSubscription): boolean {
    if (!['Active', 'Trial', 'Payment Pending'].includes(sub.status)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = (new Date(`${sub.expiryDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000;
    return days >= 0 && days <= EXPIRING_WINDOW_DAYS;
  }

  get expiringSoonCount(): number {
    return this.subscriptions.filter((s) => this.isExpiringSoon(s)).length;
  }

  /** True when the current tab has a search term or any filter applied. */
  get hasFilters(): boolean {
    const t = this.activeTab;
    return (
      !!this.search[t].trim() ||
      this.statusFilter[t] !== 'All' ||
      this.hostelFilter[t] !== 'All' ||
      this.planFilter[t] !== 'All' ||
      this.extraFilter[t] !== 'All'
    );
  }

  /** Clears the current tab's search and filters. */
  resetFilters(): void {
    this.search[this.activeTab] = '';
    this.statusFilter[this.activeTab] = 'All';
    this.hostelFilter[this.activeTab] = 'All';
    this.planFilter[this.activeTab] = 'All';
    this.extraFilter[this.activeTab] = 'All';
    this.currentPage[this.activeTab] = 0;
  }

  // ---- Filtering ----

  private matches(term: string, values: (string | undefined)[]): boolean {
    return values.some((v) => !!v && v.toLowerCase().includes(term));
  }

  get filteredSubscriptions(): HostelSubscription[] {
    const term = this.search.subscriptions.trim().toLowerCase();
    const status = this.statusFilter.subscriptions;
    const { subscriptions: hostel } = this.hostelFilter;
    const { subscriptions: plan } = this.planFilter;
    const { subscriptions: cycle } = this.extraFilter;
    return this.subscriptions.filter(
      (s) =>
        (status === 'All' || s.status === status) &&
        (hostel === 'All' || s.hostelName === hostel) &&
        (plan === 'All' || s.planName === plan) &&
        (cycle === 'All' || s.billingCycle === cycle) &&
        (!term || this.matches(term, [s.subscriptionId, s.hostelName, s.planName, s.billingCycle])),
    );
  }

  get filteredPayments(): PaymentTransaction[] {
    const term = this.search.payments.trim().toLowerCase();
    const status = this.statusFilter.payments;
    const { payments: hostel } = this.hostelFilter;
    const { payments: plan } = this.planFilter;
    const { payments: method } = this.extraFilter;
    return this.payments
      .filter(
        (p) =>
          (status === 'All' || p.paymentStatus === status) &&
          (hostel === 'All' || p.hostelName === hostel) &&
          (plan === 'All' || p.planName === plan) &&
          (method === 'All' || p.paymentMethod === method) &&
          (!term ||
            this.matches(term, [
              p.transactionId,
              p.subscriptionId,
              p.hostelName,
              p.planName,
              p.invoiceNumber,
              p.paymentMethod,
              p.paymentGateway,
            ])),
      )
      // Newest first, so earlier billing periods sit below the current ones.
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.transactionId.localeCompare(a.transactionId));
  }

  // ---- Pagination (for whichever tab is active) ----

  get activeCount(): number {
    return this.activeTab === 'subscriptions' ? this.filteredSubscriptions.length : this.filteredPayments.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.activeCount / this.pageSize));
  }

  get emptyMessage(): string {
    return this.hasFilters
      ? 'No records match your filters'
      : 'No Data Found';
  }

  /** Clamps the page so it stays valid after a search or filter change shrinks the result set. */
  get safePage(): number {
    return Math.min(this.currentPage[this.activeTab], this.totalPages - 1);
  }

  setPage(page: number): void {
    this.currentPage[this.activeTab] = Math.min(Math.max(0, page), this.totalPages - 1);
  }

  get pagedSubscriptions(): HostelSubscription[] {
    const start = this.safePage * this.pageSize;
    return this.filteredSubscriptions.slice(start, start + this.pageSize);
  }

  get pagedPayments(): PaymentTransaction[] {
    const start = this.safePage * this.pageSize;
    return this.filteredPayments.slice(start, start + this.pageSize);
  }

  // ---- Detail panel ----

  openSubscription(sub: HostelSubscription): void {
    this.selectedSubscriptionId = sub.subscriptionId;
    this.isPanelOpen = true;
  }

  openSubscriptionById(subscriptionId: string): void {
    const sub = this.subscriptions.find((s) => s.subscriptionId === subscriptionId);
    if (sub) this.openSubscription(sub);
  }
}
