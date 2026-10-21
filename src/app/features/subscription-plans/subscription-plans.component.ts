import { Component, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AddPlanSidePanelComponent, FEATURE_CONFIG_ITEMS } from './add-plan-side-panel.component';
import { AppPaginationComponent } from '../../shared/components/pagination/app-pagination.component';
import { AppEmptyStateComponent } from '../../shared/components/empty-state/app-empty-state.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AuditLogService } from '../../core/services/audit-log.service';
import { diffForAudit } from '../../core/models/audit.models';
import { SubscriptionPaymentService } from '../subscription-payments/subscription-payment.service';
import { isOpenSubscription } from '../subscription-payments/subscription-payment.models';

const PLAN_AUDIT_FIELDS: Record<string, string> = {
  planName: 'Plan Name',
  price: 'Price',
  billingCycle: 'Billing Cycle',
  residentLimit: 'Tenant Limit',
  features: 'Enabled Features',
};

/** Plan fields in audit-friendly form: the feature toggles become a readable list. */
function planAuditValues(plan: SubscriptionPlanRow): Record<string, unknown> {
  const enabled = plan.featureConfig
    ? FEATURE_CONFIG_ITEMS.filter((f) => plan.featureConfig![f.id]).map((f) => f.name).join(', ')
    : undefined;
  return { ...plan, features: enabled };
}

export interface SubscriptionPlanRow {
  planId: string;
  planName: string;
  price: string;
  billingCycle: 'Monthly' | 'Yearly' | 'Quarterly';
  residentLimit: number;
  status: 'Active' | 'Inactive';
  createdDate: string;
  features?: string;
  featureConfig?: Record<string, boolean>;
}

type BillingFilter = 'All' | SubscriptionPlanRow['billingCycle'];

/** Features listed on a card before "+N more". */
const VISIBLE_FEATURES = 4;

@Component({
  selector: 'app-subscription-plans',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    AddPlanSidePanelComponent,
    AppPaginationComponent,
    AppEmptyStateComponent,
    AppButtonComponent,
  ],
  template: `
    <div class="plans-page">
      <!-- Toolbar: search (left) · billing toggle + New (right) -->
      <div class="plans-toolbar">
        <mat-form-field appearance="outline" class="filter-field filter-field--search">
          <mat-icon matPrefix>search</mat-icon>
          <input matInput type="text" placeholder="Search plans..." [(ngModel)]="searchTerm" (ngModelChange)="currentPage = 0" />
          <button
            *ngIf="searchTerm"
            mat-icon-button
            matSuffix
            type="button"
            class="filter-clear-btn"
            aria-label="Clear search"
            (click)="searchTerm = ''"
          >
            <mat-icon>close</mat-icon>
          </button>
        </mat-form-field>

        <div class="plans-toolbar__right">
          <div class="billing-toggle" role="group" aria-label="Filter plans by billing cycle">
            @for (option of billingOptions; track option) {
              <button
                type="button"
                class="billing-toggle__btn"
                [class.billing-toggle__btn--active]="billingFilter === option"
                [attr.aria-pressed]="billingFilter === option"
                (click)="billingFilter = option; currentPage = 0"
              >
                {{ option }}
              </button>
            }
          </div>

          <app-button icon="add" (clicked)="onAddPlan()">New</app-button>
        </div>
      </div>

      <!-- Plan cards -->
      @if (filteredRows.length > 0) {
        <div class="plan-grid">
          @for (plan of pagedRows; track plan.planId) {
            @let popular = plan.planId === popularPlanId;
            @let features = enabledFeatures(plan);
            <article
              class="plan-card"
              [class.plan-card--popular]="popular"
              [class.plan-card--inactive]="plan.status === 'Inactive'"
            >
              @if (popular) {
                <span class="plan-card__badge" matTooltip="Most hostels are on this plan">
                  <mat-icon>star</mat-icon>
                  Most Popular
                </span>
              }

              <header class="plan-card__head">
                <h3 class="plan-card__name" [title]="plan.planId">{{ plan.planName }}</h3>
                <span class="plan-status" [class.plan-status--active]="plan.status === 'Active'">{{ plan.status }}</span>
              </header>

              <div class="plan-card__price">
                <span class="plan-card__amount">{{ priceAmount(plan.price) }}</span>
                @if (pricePeriod(plan.price); as period) {
                  <span class="plan-card__period">/{{ period }}</span>
                }
                <!-- On the price line, so inactive cards are no taller than the others -->
                @if (plan.status === 'Inactive') {
                  <span class="plan-card__tag" matTooltip="No longer offered to new hostels; existing subscriptions keep it">Legacy Plan</span>
                }
              </div>

              <ul class="plan-card__limits">
                <li>
                  <span class="plan-card__limit-icon"><mat-icon fontSet="material-icons-outlined">group</mat-icon></span>
                  Up to {{ plan.residentLimit | number }} Tenants
                </li>
                <li>
                  <span class="plan-card__limit-icon"><mat-icon fontSet="material-icons-outlined">view_in_ar</mat-icon></span>
                  @if (features.length === featureCount) {
                    All {{ featureCount }} Modules Included
                  } @else {
                    {{ features.length }} of {{ featureCount }} Modules Included
                  }
                </li>
              </ul>

              <ul class="plan-card__features">
                @for (feature of features.slice(0, visibleFeatures); track feature) {
                  <li>
                    <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
                    {{ feature }}
                  </li>
                }
                @if (features.length > visibleFeatures) {
                  <li class="plan-card__more" [matTooltip]="features.slice(visibleFeatures).join(', ')">
                    +{{ features.length - visibleFeatures }} more
                  </li>
                }
              </ul>

              <footer class="plan-card__footer">
                <span class="plan-card__created">
                  <mat-icon fontSet="material-icons-outlined">calendar_month</mat-icon>
                  Created {{ fmt.date(plan.createdDate) }}
                </span>
                <!-- Popular plan: solid; inactive plan: neutral; others: blue outline -->
                <app-button
                  [variant]="popular ? 'primary' : plan.status === 'Inactive' ? 'secondary' : 'outline'"
                  [block]="true"
                  [ariaLabel]="'Edit plan ' + plan.planName"
                  (clicked)="onEditPlan(plan)"
                >
                  Edit
                </app-button>
              </footer>
            </article>
          }
        </div>
      } @else {
        <div class="plans-empty">
          <app-empty-state [message]="emptyMessage"></app-empty-state>
          @if (isFiltering) {
            <app-button class="plans-empty__action" variant="secondary" icon="filter_alt_off" (clicked)="clearFilters()">
              Clear filters
            </app-button>
          } @else {
            <app-button class="plans-empty__action" icon="add" (clicked)="onAddPlan()">Create your first plan</app-button>
          }
        </div>
      }

      @if (totalPages > 1) {
        <app-pagination [page]="safePage" [totalPages]="totalPages" (pageChange)="currentPage = $event"></app-pagination>
      }
    </div>

    <!-- Right Side Panel Drawer -->
    <app-add-plan-side-panel
      [isOpen]="isSidePanelOpen"
      [mode]="panelMode"
      [plan]="selectedPlan"
      [nextId]="nextPlanId"
      (closePanel)="isSidePanelOpen = false"
      (savePlan)="onSavePlan($event)"
    ></app-add-plan-side-panel>
  `,
  styles: [`
    .plans-page {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 4px 0 16px;
    }

    /* ---- Toolbar ---- */
    .plans-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .plans-toolbar .filter-field--search {
      width: 280px;
    }

    .plans-toolbar__right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .billing-toggle {
      display: inline-flex;
      padding: 4px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 0 0 1px #e2e8f0;
    }

    .billing-toggle__btn {
      min-width: 96px;
      height: 38px;
      padding: 0 18px;
      border: none;
      border-radius: 9px;
      background: transparent;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;

      &:hover:not(.billing-toggle__btn--active) {
        background: #f1f5f9;
      }

      &:focus-visible {
        outline: 2px solid #0057e7;
        outline-offset: 1px;
      }
    }

    .billing-toggle__btn--active {
      background: #0057e7;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 87, 231, 0.25);
    }

    /* ---- Cards ---- */
    .plan-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 24px;
      padding-top: 14px; /* room for the "Most Popular" badge */
    }

    .plan-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: 20px 20px 18px;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.05);
      transition: box-shadow 0.2s ease, transform 0.2s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 36px rgba(15, 34, 74, 0.09), 0 0 0 1px rgba(15, 23, 42, 0.06);
      }
    }

    .plan-card--popular {
      box-shadow: 0 16px 40px rgba(0, 87, 231, 0.12), 0 0 0 1.5px #3b82f6;

      &:hover {
        box-shadow: 0 20px 44px rgba(0, 87, 231, 0.16), 0 0 0 1.5px #3b82f6;
      }
    }

    .plan-card__badge {
      position: absolute;
      top: -15px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      background: #0057e7;
      color: #ffffff;
      font-size: 12.5px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 6px 16px rgba(0, 87, 231, 0.3);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .plan-card__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .plan-card__name {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
    }

    .plan-status {
      flex-shrink: 0;
      padding: 4px 10px;
      border-radius: 8px;
      background: #f1f5f9;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
    }

    .plan-status--active {
      background: #dcfce7;
      color: #15803d;
    }

    .plan-card__price {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin: 12px 0 14px;
    }

    .plan-card__amount {
      font-size: 30px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.02em;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }

    .plan-card__period {
      font-size: 15px;
      font-weight: 500;
      color: #64748b;
    }

    .plan-card__limits,
    .plan-card__features {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }

    .plan-card__limits {
      gap: 8px;
      padding-bottom: 14px;
      margin-bottom: 14px;
      border-bottom: 1px solid #eef2f7;

      li {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        color: #334155;
      }
    }

    .plan-card__limit-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border-radius: 7px;
      background: #eff4ff;
      color: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
      }
    }

    .plan-card__tag {
      align-self: center;
      margin-left: auto;
      padding: 3px 10px;
      border-radius: 6px;
      background: #f1f5f9;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
    }

    .plan-card__features {
      flex: 1;
      gap: 9px;

      li {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        color: #334155;
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: #2563eb;
      }
    }

    .plan-card__more {
      font-size: 15px !important;
      font-weight: 500;
      color: #2563eb !important;
      cursor: default;
    }

    .plan-card__footer {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      margin-top: 16px;
    }

    .plan-card__created {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #eef2f7;
      font-size: 13.5px;
      color: #334155;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #64748b;
      }
    }

    /* Inactive plans: kept visible, but clearly switched off. */
    .plan-card--inactive {
      background: #fafbfc;

      .plan-card__name,
      .plan-card__amount {
        color: #94a3b8;
      }

      .plan-card__period,
      .plan-card__limits li,
      .plan-card__features li,
      .plan-card__created {
        color: #94a3b8;
      }

      .plan-card__limits mat-icon,
      .plan-card__features mat-icon {
        color: #cbd5e1;
      }

      .plan-card__more {
        color: #94a3b8 !important;
      }

      .plan-card__limit-icon {
        background: #f1f5f9;
        color: #cbd5e1;
      }
    }

    /* ---- Empty state ---- */
    .plans-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 0 24px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.05);
    }

    .plans-empty__action {
      margin-top: -4px;
    }

    @media (max-width: 720px) {
      .plans-toolbar,
      .plans-toolbar__right,
      .plans-toolbar .filter-field--search {
        width: 100%;
      }
    }
  `],
})
export class SubscriptionPlansComponent {
  /** Currency and date format from System Defaults → General. */
  readonly fmt = inject(AppFormatService);
  private readonly subscriptions = inject(SubscriptionPaymentService);

  readonly featureCount = FEATURE_CONFIG_ITEMS.length;
  readonly visibleFeatures = VISIBLE_FEATURES;

  searchTerm = '';
  billingFilter: BillingFilter = 'All';
  // Divisible by 2, 3 and 4 so the last row of cards stays full at common grid widths.
  pageSize = 12;
  currentPage = 0;

  rows: SubscriptionPlanRow[] = [
    {
      planId: 'PLN-1001',
      planName: 'Basic',
      price: '₹999 / mo',
      billingCycle: 'Monthly',
      residentLimit: 50,
      status: 'Active',
      createdDate: '2026-08-01',
    },
    {
      planId: 'PLN-1002',
      planName: 'Standard',
      price: '₹1,999 / mo',
      billingCycle: 'Monthly',
      residentLimit: 150,
      status: 'Active',
      createdDate: '2026-08-01',
    },
    {
      planId: 'PLN-1003',
      planName: 'Premium',
      price: '₹19,999 / yr',
      billingCycle: 'Yearly',
      residentLimit: 500,
      status: 'Active',
      createdDate: '2026-08-01',
    },
    {
      planId: 'PLN-1004',
      planName: 'Legacy Basic',
      price: '₹799 / mo',
      billingCycle: 'Monthly',
      residentLimit: 50,
      status: 'Inactive',
      createdDate: '2025-11-12',
    },
  ];

  isSidePanelOpen = false;
  panelMode: 'add' | 'edit' = 'add';
  selectedPlan?: SubscriptionPlanRow;
  nextPlanId?: string;

  constructor(
    private snackBar: MatSnackBar,
    private auditLog: AuditLogService,
  ) {}

  /** "All" plus each billing cycle that at least one plan uses (Monthly, Quarterly, Yearly order). */
  get billingOptions(): BillingFilter[] {
    const cycles = (['Monthly', 'Quarterly', 'Yearly'] as const).filter((c) => this.rows.some((r) => r.billingCycle === c));
    return ['All', ...cycles];
  }

  /**
   * "Most Popular": the active plan the most hostels currently subscribe to
   * (open subscriptions on Subscription & Payment). None when nobody subscribes.
   */
  get popularPlanId(): string | null {
    const counts = new Map<string, number>();
    for (const s of this.subscriptions.subscriptions) {
      if (isOpenSubscription(s)) counts.set(s.planName, (counts.get(s.planName) ?? 0) + 1);
    }
    let best: SubscriptionPlanRow | null = null;
    let bestCount = 0;
    for (const plan of this.rows) {
      const count = counts.get(plan.planName) ?? 0;
      if (plan.status === 'Active' && count > bestCount) {
        best = plan;
        bestCount = count;
      }
    }
    return best?.planId ?? null;
  }

  get filteredRows(): SubscriptionPlanRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.rows.filter(
      (row) =>
        (this.billingFilter === 'All' || row.billingCycle === this.billingFilter) &&
        (!term || [row.planName, row.planId, row.billingCycle, row.status].some((value) => value.toLowerCase().includes(term))),
    );
  }

  get isFiltering(): boolean {
    return !!this.searchTerm.trim() || this.billingFilter !== 'All';
  }

  get emptyMessage(): string {
    if (this.searchTerm.trim()) return 'No plans match your search';
    if (this.billingFilter !== 'All') return `No ${this.billingFilter.toLowerCase()} plans`;
    return 'No subscription plans yet';
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.billingFilter = 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  /** Clamps `currentPage` so it stays valid after a search or page-size change shrinks the result set. */
  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get pagedRows(): SubscriptionPlanRow[] {
    const start = this.safePage * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  /** "₹1,999 / mo" → "₹1,999", shown in the currency from System Defaults (e.g. "$1,999"). */
  priceAmount(price: string): string {
    const raw = price.split('/')[0].trim();
    const amount = Number(raw.replace(/[^\d.]/g, ''));
    return /\d/.test(raw) && !isNaN(amount) ? this.fmt.money(amount, '1.0-2') : raw;
  }

  /** "₹1,999 / mo" → "mo"; empty when the price has no period suffix. */
  pricePeriod(price: string): string {
    return price.split('/')[1]?.trim() ?? '';
  }

  /** A plan without a saved feature config has every module on (the edit panel opens it that way). */
  enabledFeatures(plan: SubscriptionPlanRow): string[] {
    if (!plan.featureConfig) return FEATURE_CONFIG_ITEMS.map((f) => f.name);
    return FEATURE_CONFIG_ITEMS.filter((f) => plan.featureConfig![f.id]).map((f) => f.name);
  }

  private getNextPlanId(): string {
    const numericIds = this.rows
      .map((r) => {
        const match = r.planId.match(/PLN-(\d+)/);
        return match ? parseInt(match[1], 10) : 1000;
      })
      .filter((n) => !isNaN(n));
    const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 1000;
    return `PLN-${maxId + 1}`;
  }

  onAddPlan(): void {
    this.panelMode = 'add';
    this.selectedPlan = undefined;
    this.nextPlanId = this.getNextPlanId();
    this.isSidePanelOpen = true;
  }

  onEditPlan(row: SubscriptionPlanRow): void {
    this.panelMode = 'edit';
    this.selectedPlan = row;
    this.isSidePanelOpen = true;
  }

  onSavePlan(result: SubscriptionPlanRow): void {
    this.isSidePanelOpen = false;
    if (this.panelMode === 'add') {
      this.rows = [result, ...this.rows];
      this.auditLog.record('Create Plan', result.planName, {
        details: `${result.price} · ${result.billingCycle} · ${result.residentLimit} tenants`,
      });
      this.snackBar.open('Subscription Plan created successfully', 'x', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['app-snackbar--success', 'green-snackbar'],
      });
    } else {
      const index = this.rows.findIndex((r) => r.planId === result.planId);
      if (index !== -1) {
        const previous = this.rows[index];
        const changes = diffForAudit(planAuditValues(previous), planAuditValues(result), PLAN_AUDIT_FIELDS);
        // Only an actual edit is logged; saving with nothing changed is not an audit event.
        if (changes.length) this.auditLog.record('Update Plan', result.planName, { changes });
        if (previous.status !== result.status) {
          this.auditLog.record(result.status === 'Active' ? 'Activate Plan' : 'Deactivate Plan', result.planName, {
            changes: [{ field: 'Status', oldValue: previous.status, newValue: result.status }],
          });
        }
        this.rows[index] = result;
        this.rows = [...this.rows];
        this.snackBar.open('Subscription Plan updated successfully', 'x', {
          duration: 4000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['app-snackbar--success', 'green-snackbar'],
        });
      }
    }
  }
}
