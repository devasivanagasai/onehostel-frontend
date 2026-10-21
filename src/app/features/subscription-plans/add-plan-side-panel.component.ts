import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { shouldCloseOnEscape } from '../../shared/utils/panel-escape';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SubscriptionPlanRow } from './subscription-plans.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

export interface FeatureItem {
  id: string;
  name: string;
  icon: string;
  /** Icon tile colour in the plan dialog. */
  tone?: 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'pink' | 'indigo';
}

export const FEATURE_CONFIG_ITEMS: FeatureItem[] = [
  { id: 'residentManagement', name: 'Tenant Management', icon: 'groups', tone: 'blue' },
  { id: 'roomManagement', name: 'Room Management', icon: 'bed', tone: 'purple' },
  { id: 'payments', name: 'Payments', icon: 'payments', tone: 'green' },
  { id: 'complaints', name: 'Complaints', icon: 'chat_bubble', tone: 'orange' },
  { id: 'laundry', name: 'Laundry', icon: 'checkroom', tone: 'blue' },
  { id: 'washingMachine', name: 'Washing Machine', icon: 'local_laundry_service', tone: 'teal' },
  { id: 'visitors', name: 'Visitors', icon: 'groups_2', tone: 'purple' },
  { id: 'announcements', name: 'Announcements', icon: 'campaign', tone: 'blue' },
  { id: 'mess', name: 'Mess', icon: 'restaurant', tone: 'orange' },
  { id: 'attendance', name: 'Attendance', icon: 'event_available', tone: 'green' },
  { id: 'leaveOutpass', name: 'Leave / Outpass', icon: 'exit_to_app', tone: 'pink' },
  { id: 'parentAccess', name: 'Parent Access', icon: 'family_restroom', tone: 'teal' },
  { id: 'reports', name: 'Reports', icon: 'bar_chart', tone: 'indigo' },
];

/** Price suffix stored with the plan, per billing cycle (e.g. "₹999 / mo"). */
const CYCLE_SUFFIX: Record<SubscriptionPlanRow['billingCycle'], string> = {
  Monthly: 'mo',
  Quarterly: 'qtr',
  Yearly: 'yr',
};

/**
 * Add / Edit Subscription Plan, shown as a centred dialog.
 * (The selector keeps its original "side panel" name, so callers don't change.)
 */
@Component({
  selector: 'app-add-plan-side-panel',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatIconModule,
    MatSlideToggleModule,
    AppButtonComponent,
  ],
  template: `
    @if (isOpen) {
      <div class="plan-modal-backdrop" (click)="onCancel()"></div>

      <div class="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
        <!-- Header -->
        <header class="plan-modal__header">
          <span class="plan-modal__icon"><mat-icon fontSet="material-icons-outlined">{{ mode === 'edit' ? 'edit_note' : 'note_add' }}</mat-icon></span>
          <div class="plan-modal__titles">
            <h2 id="plan-modal-title" class="plan-modal__title">
              {{ mode === 'edit' ? 'Edit Subscription Plan' : 'Add New Subscription Plan' }}
            </h2>
            <p class="plan-modal__subtitle">
              {{ mode === 'edit' && plan ? plan.planId + ' · ' + plan.planName : 'Set pricing, limits and the modules this plan includes' }}
            </p>
          </div>
          <app-button class="plan-modal__close" variant="icon" icon="close" ariaLabel="Close" (clicked)="onCancel()"></app-button>
        </header>

        <!-- Body -->
        <div class="panel-body">
          <form [formGroup]="planForm" (ngSubmit)="onSubmit()" id="sidePlanForm" class="plan-form">
            <!-- Plan details -->
            <section class="plan-section">
              <h3 class="plan-section__title"><mat-icon fontSet="material-icons-outlined">description</mat-icon>Plan Details</h3>
              <div class="plan-grid plan-grid--2">
                <div class="field">
                  <label class="field__label" for="plan-id">Plan ID</label>
                  <div class="readonly-box">
                    <mat-icon fontSet="material-icons-outlined">lock</mat-icon>
                    <input id="plan-id" formControlName="planId" readonly />
                    <span class="auto-badge">Auto-generated</span>
                  </div>
                </div>

                <div class="field">
                  <label class="field__label" for="plan-name">Plan Name <span class="req">*</span></label>
                  <input id="plan-name" class="text-input" formControlName="planName" placeholder="Enter plan name" />
                  @if (showError('planName')) {
                    <span class="field__error">Plan name is required</span>
                  }
                </div>
              </div>
            </section>

            <!-- Pricing & limits -->
            <section class="plan-section">
              <h3 class="plan-section__title"><mat-icon fontSet="material-icons-outlined">sell</mat-icon>Pricing &amp; Limits</h3>
              <div class="plan-grid plan-grid--3">
                <div class="field">
                  <label class="field__label" for="plan-price">Price ({{ fmt.currencyCode }}) <span class="req">*</span></label>
                  <div class="prefix-input">
                    <span class="prefix-input__symbol">{{ fmt.currencySymbol }}</span>
                    <input id="plan-price" formControlName="price" inputmode="decimal" placeholder="e.g. 999.00" />
                  </div>
                  @if (showError('price')) {
                    <span class="field__error">{{ planForm.get('price')?.hasError('pattern') ? 'Enter an amount, e.g. 999 or 999.50' : 'Price is required' }}</span>
                  }
                </div>

                <div class="field">
                  <label class="field__label" for="plan-cycle">Billing Cycle <span class="req">*</span></label>
                  <select id="plan-cycle" class="text-input select-input" formControlName="billingCycle">
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Yearly">Yearly</option>
                  </select>
                </div>

                <div class="field">
                  <label class="field__label" for="plan-limit">Tenant Limit <span class="req">*</span></label>
                  <input id="plan-limit" class="text-input" type="number" min="1" formControlName="residentLimit" placeholder="e.g. 200" />
                  @if (showError('residentLimit')) {
                    <span class="field__error">{{ planForm.get('residentLimit')?.hasError('min') ? 'Limit must be 1 or higher' : 'Tenant limit is required' }}</span>
                  }
                </div>
              </div>

              <!-- Plan status (edit only; new plans start Active). A change logs Activate/Deactivate Plan. -->
              @if (mode === 'edit') {
                <div class="status-row">
                  <div>
                    <span class="status-row__title">Plan Status</span>
                    <span class="status-row__hint">
                      {{ planForm.get('active')?.value ? 'Active — can be assigned to hostels' : 'Inactive — hidden from new subscriptions' }}
                    </span>
                  </div>
                  <mat-slide-toggle hideIcon formControlName="active" aria-label="Plan active"></mat-slide-toggle>
                </div>
              }
            </section>

            <!-- Feature configuration -->
            <section class="plan-section">
              <div class="plan-section__head">
                <h3 class="plan-section__title">
                  <mat-icon fontSet="material-icons-outlined">view_in_ar</mat-icon>Feature Configuration
                  <span class="enabled-pill"><span class="enabled-pill__dot"></span>{{ enabledCount }} / {{ featureList.length }} Modules Enabled</span>
                </h3>
                <div class="bulk-links">
                  <button type="button" class="bulk-link" (click)="selectAllFeatures(true)">Select All</button>
                  <button type="button" class="bulk-link bulk-link--danger" (click)="selectAllFeatures(false)">Clear All</button>
                </div>
              </div>

              <div class="feature-list" formGroupName="featureConfig">
                @for (item of featureList; track item.id) {
                  <div class="feature-row" [class.feature-row--off]="!isFeatureEnabled(item.id)" (click)="toggleFeature(item.id)">
                    <span class="feature-row__icon tone--{{ item.tone || 'blue' }}"><mat-icon>{{ item.icon }}</mat-icon></span>
                    <span class="feature-row__name">{{ item.name }}</span>
                    <mat-slide-toggle
                      hideIcon
                      [formControlName]="item.id"
                      (click)="$event.stopPropagation()"
                      [attr.aria-label]="item.name"
                    ></mat-slide-toggle>
                  </div>
                }
              </div>
            </section>
          </form>
        </div>

        <!-- Footer -->
        <footer class="plan-modal__footer">
          <app-button variant="secondary" (clicked)="onCancel()">Cancel</app-button>
          <app-button type="submit" form="sidePlanForm">{{ mode === 'edit' ? 'Update' : 'Submit' }}</app-button>
        </footer>
      </div>
    }
  `,
  styles: [`
    .plan-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(3px);
      animation: fade-in 0.2s ease;
    }

    .plan-modal {
      position: fixed;
      z-index: 1001;
      top: 50%;
      left: 50%;
      width: min(1000px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 30px 80px rgba(15, 23, 42, 0.3);
      transform: translate(-50%, -50%);
      animation: modal-in 0.22s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
    }

    @keyframes modal-in {
      from { opacity: 0; transform: translate(-50%, -47%) scale(0.98); }
    }

    @media (prefers-reduced-motion: reduce) {
      .plan-modal,
      .plan-modal-backdrop {
        animation: none;
      }
    }

    /* ---- Header ---- */
    .plan-modal__header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 22px 24px 16px;
    }

    .plan-modal__icon {
      width: 46px;
      height: 46px;
      flex-shrink: 0;
      border-radius: 12px;
      background: #eff4ff;
      color: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
    }

    .plan-modal__titles {
      flex: 1;
      min-width: 0;
    }

    .plan-modal__title {
      margin: 0;
      font-size: 21px;
      font-weight: 600;
      color: #0f172a;
    }

    .plan-modal__subtitle {
      margin: 2px 0 0;
      font-size: 13.5px;
      color: #64748b;
    }

    .plan-modal__close {
      align-self: flex-start;
    }

    /* ---- Body ---- */
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 0 24px 8px;
    }

    .plan-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .plan-section {
      padding: 14px 18px 16px;
      border-radius: 12px;
      background: #f8fafc;
    }

    .plan-section__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;

      .plan-section__title {
        margin: 0;
      }
    }

    .plan-section__title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #1e293b;

      mat-icon {
        width: 26px;
        height: 26px;
        padding: 4px;
        border-radius: 7px;
        background: #e8f0ff;
        color: #2563eb;
        font-size: 18px;
        box-sizing: border-box;
      }
    }

    .plan-grid {
      display: grid;
      gap: 14px 24px;
    }

    .plan-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .plan-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

    @media (max-width: 720px) {
      .plan-grid--2,
      .plan-grid--3 {
        grid-template-columns: 1fr;
      }
    }

    .field {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .field__label {
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #334155;
    }

    .req {
      color: #ef4444;
    }

    .field__error {
      margin-top: 4px;
      font-size: 12px;
      color: #dc2626;
    }

    /* One field look for text, prefix and read-only boxes. */
    .text-input,
    .prefix-input,
    .readonly-box {
      height: 40px;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      background: #ffffff;
      font: inherit;
      font-size: 14px;
      color: #0f172a;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .text-input {
      width: 100%;
      padding: 0 12px;
      outline: none;

      &::placeholder {
        color: #94a3b8;
      }
    }

    .text-input:focus,
    .prefix-input:focus-within {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .prefix-input {
      display: flex;
      align-items: center;
      overflow: hidden;

      input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0 12px 0 10px;
        border: none;
        outline: none;
        background: transparent;
        font: inherit;
        color: #0f172a;

        &::placeholder {
          color: #94a3b8;
        }
      }
    }

    .prefix-input__symbol {
      padding-left: 12px;
      font-weight: 600;
      color: #64748b;
    }

    .readonly-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px 0 12px;
      background: #f1f5f9;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #94a3b8;
      }

      input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        font: inherit;
        color: #475569;
      }
    }

    .auto-badge {
      flex-shrink: 0;
      padding: 2px 8px;
      border-radius: 6px;
      background: #e0ebff;
      font-size: 11.5px;
      font-weight: 500;
      color: #2563eb;
    }

    /* Billing cycle: a plain select with the same look as the text fields. */
    .select-input {
      appearance: none;
      padding-right: 36px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%2364748b' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 18px;
      cursor: pointer;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-top: 14px;
      padding: 10px 14px;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 0 0 1px #e8edf5;
    }

    .status-row__title {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }

    .status-row__hint {
      font-size: 12.5px;
      color: #64748b;
    }

    /* ---- Features ---- */
    .enabled-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 4px;
      padding: 3px 10px;
      border-radius: 999px;
      background: #dcfce7;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: none;
      color: #15803d;
    }

    .enabled-pill__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
    }

    .bulk-links {
      display: flex;
      gap: 16px;
    }

    .bulk-link {
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-size: 13.5px;
      font-weight: 500;
      color: #2563eb;
      text-decoration: none;
      cursor: pointer;

      &:hover {
        text-decoration: none;
        opacity: 0.8;
      }
    }

    .bulk-link--danger {
      color: #ef4444;
    }

    .feature-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 24px;

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .feature-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 7px 12px;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 0 0 1px #edf1f7;
      cursor: pointer;
      transition: box-shadow 0.15s ease;

      &:hover {
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08), 0 0 0 1px #dbe3ef;
      }
    }

    .feature-row--off .feature-row__name {
      color: #94a3b8;
    }

    .feature-row__icon {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 19px;
        width: 19px;
        height: 19px;
      }
    }

    .feature-row__name {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
      color: #1e293b;
    }

    .tone--blue { background: #dbeafe; color: #2563eb; }
    .tone--purple { background: #ede9fe; color: #7c3aed; }
    .tone--green { background: #dcfce7; color: #16a34a; }
    .tone--orange { background: #ffedd5; color: #ea580c; }
    .tone--teal { background: #ccfbf1; color: #0d9488; }
    .tone--pink { background: #fce7f3; color: #db2777; }
    .tone--indigo { background: #e0e7ff; color: #4f46e5; }

    /* Green switches, as in the design */
    :host ::ng-deep .mat-mdc-slide-toggle {
      --mdc-switch-selected-handle-color: #ffffff;
      --mdc-switch-selected-hover-handle-color: #ffffff;
      --mdc-switch-selected-focus-handle-color: #ffffff;
      --mdc-switch-selected-pressed-handle-color: #ffffff;
      --mdc-switch-selected-track-color: #16a34a;
      --mdc-switch-selected-hover-track-color: #15803d;
      --mdc-switch-selected-focus-track-color: #15803d;
      --mdc-switch-selected-pressed-track-color: #15803d;
      --mdc-switch-selected-icon-color: #16a34a;

      /* The theme sets these with equal specificity, so paint the "on" state directly too. */
      .mdc-switch.mdc-switch--selected:enabled .mdc-switch__track::after {
        background: #16a34a !important;
      }

      .mdc-switch.mdc-switch--selected:enabled:hover .mdc-switch__track::after {
        background: #15803d !important;
      }

      .mdc-switch.mdc-switch--selected:enabled .mdc-switch__handle::after {
        background: #ffffff !important;
      }
    }

    /* ---- Footer ---- */
    .plan-modal__footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 14px 24px 18px;
    }
  `],
})
export class AddPlanSidePanelComponent implements OnInit, OnChanges, OnDestroy {
  /** Currency from System Defaults → General. */
  readonly fmt = inject(AppFormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @Input() isOpen = false;
  @Input() mode: 'add' | 'edit' = 'add';
  @Input() plan?: SubscriptionPlanRow;
  @Input() nextId?: string;

  @Output() closePanel = new EventEmitter<void>();
  @Output() savePlan = new EventEmitter<SubscriptionPlanRow>();

  /** Same as clicking the backdrop. */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isOpen && shouldCloseOnEscape(event)) this.onCancel();
  }

  planForm!: FormGroup;
  featureList = FEATURE_CONFIG_ITEMS;

  constructor(private fb: FormBuilder) {
    this.initForm();
  }

  ngOnInit(): void {
    this.initForm();
    // The page content area is its own stacking context, so a fixed dialog inside it
    // would sit under the app's side menu. Living on <body> keeps it above everything.
    document.body.appendChild(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.initForm();
    if (changes['isOpen'] && this.isOpen) {
      this.resetScroll();
    }
  }

  private resetScroll(): void {
    setTimeout(() => {
      const bodyEl = document.querySelector('.panel-body');
      if (bodyEl) {
        bodyEl.scrollTop = 0;
      }
    }, 0);
  }

  private initForm(): void {
    const isEdit = this.mode === 'edit' && !!this.plan;
    const plan = this.plan;

    // Build feature controls map
    const featureControls: Record<string, boolean> = {};
    this.featureList.forEach((item) => {
      if (isEdit && plan?.featureConfig) {
        featureControls[item.id] = !!plan.featureConfig[item.id];
      } else {
        featureControls[item.id] = true;
      }
    });

    this.planForm = this.fb.group({
      planId: [isEdit ? plan?.planId : (this.nextId || 'PLN-1005')],
      planName: [isEdit ? plan?.planName : '', [Validators.required]],
      // Just the amount; the currency symbol and billing period are added on save.
      price: [isEdit && plan ? amountOf(plan.price) : '', [Validators.required, Validators.pattern(/^\d[\d,]*(\.\d{1,2})?$/)]],
      billingCycle: [isEdit ? plan?.billingCycle : 'Monthly', [Validators.required]],
      residentLimit: [isEdit ? plan?.residentLimit : '', [Validators.required, Validators.min(1)]],
      active: [isEdit ? plan?.status !== 'Inactive' : true],
      featureConfig: this.fb.group(featureControls),
    });
  }

  /** Errors show once the field was touched (or after a submit attempt). */
  showError(name: string): boolean {
    const c = this.planForm.get(name);
    return !!c && c.invalid && c.touched;
  }

  get enabledCount(): number {
    return this.featureList.filter((item) => this.isFeatureEnabled(item.id)).length;
  }

  isFeatureEnabled(featureId: string): boolean {
    if (!this.planForm) return false;
    const group = this.planForm.get('featureConfig') as FormGroup;
    return !!group?.get(featureId)?.value;
  }

  toggleFeature(featureId: string): void {
    if (!this.planForm) return;
    const group = this.planForm.get('featureConfig') as FormGroup;
    const current = group.get(featureId)?.value;
    group.get(featureId)?.setValue(!current);
  }

  selectAllFeatures(enable: boolean): void {
    if (!this.planForm) return;
    const group = this.planForm.get('featureConfig') as FormGroup;
    this.featureList.forEach((item) => {
      group.get(item.id)?.setValue(enable);
    });
  }

  onCancel(): void {
    this.closePanel.emit();
  }

  onSubmit(): void {
    if (this.planForm.invalid) {
      this.planForm.markAllAsTouched();
      return;
    }

    const formVal = this.planForm.getRawValue();
    const amount = Number(String(formVal.price).replace(/,/g, ''));
    const cycle = formVal.billingCycle as SubscriptionPlanRow['billingCycle'];
    const result: SubscriptionPlanRow = {
      planId: formVal.planId,
      planName: String(formVal.planName).trim(),
      // e.g. "₹1,999 / mo" — symbol from System Defaults, period from the billing cycle.
      price: `${this.fmt.money(amount, '1.0-2')} / ${CYCLE_SUFFIX[cycle]}`,
      billingCycle: cycle,
      residentLimit: Number(formVal.residentLimit),
      // New plans always start Active; the status toggle is only shown when editing.
      status: this.mode === 'edit' ? (formVal.active ? 'Active' : 'Inactive') : 'Active',
      createdDate: this.plan?.createdDate || new Date().toISOString().split('T')[0],
      features: formVal.features,
      featureConfig: formVal.featureConfig,
    };

    this.savePlan.emit(result);
  }
}

/** "₹1,999 / mo" → "1999" (for editing the amount on its own). */
function amountOf(price: string): string {
  const raw = (price ?? '').split('/')[0].replace(/[^\d.]/g, '');
  return raw;
}
