import { Component, Inject, OnInit, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SubscriptionPlanRow } from './subscription-plans.component';
import { AppDialogComponent } from '../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

export interface PlanDialogData {
  mode: 'add' | 'edit';
  plan?: SubscriptionPlanRow;
  nextId?: string;
}

export interface FeatureItem {
  id: string;
  name: string;
  icon: string;
}

export const FEATURE_CONFIG_ITEMS: FeatureItem[] = [
  { id: 'residentManagement', name: 'Tenant Management', icon: 'people' },
  { id: 'roomManagement', name: 'Room Management', icon: 'meeting_room' },
  { id: 'payments', name: 'Payments', icon: 'payments' },
  { id: 'complaints', name: 'Complaints', icon: 'report_problem' },
  { id: 'laundry', name: 'Laundry', icon: 'local_laundry_service' },
  { id: 'washingMachine', name: 'Washing Machine', icon: 'dry_cleaning' },
  { id: 'visitors', name: 'Visitors', icon: 'badge' },
  { id: 'announcements', name: 'Announcements', icon: 'campaign' },
  { id: 'mess', name: 'Mess', icon: 'restaurant' },
  { id: 'attendance', name: 'Attendance', icon: 'fact_check' },
  { id: 'leaveOutpass', name: 'Leave / Outpass', icon: 'exit_to_app' },
  { id: 'parentAccess', name: 'Parent Access', icon: 'family_restroom' },
  { id: 'reports', name: 'Reports', icon: 'assessment' },
];

@Component({
  selector: 'app-add-plan-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSlideToggleModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  template: `
    <form [formGroup]="planForm" (ngSubmit)="onSubmit()" novalidate>
      <app-dialog
        [title]="data.mode === 'edit' ? 'Edit Subscription Plan' : 'Add New Subscription Plan'"
        subtitle="Configure pricing details and feature module permissions"
        [icon]="data.mode === 'edit' ? 'edit_note' : 'workspace_premium'"
        [iconOutlined]="false"
        (closed)="onCancel()"
      >
          <!-- Basic Fields Grid -->
          <div class="fields-grid">
            
            <!-- Plan ID -->
            <div class="field-group">
              <label class="field-label">
                Plan ID
                <span class="auto-badge"><mat-icon class="badge-icon">auto_awesome</mat-icon> Auto-generated</span>
              </label>
              <mat-form-field appearance="outline" class="full-width readonly-field">
                <input matInput formControlName="planId" readonly />
                <mat-icon matSuffix class="suffix-lock">lock</mat-icon>
              </mat-form-field>
            </div>

            <!-- Plan Name -->
            <div class="field-group">
              <label class="field-label">
                Plan Name <span class="required-star">*</span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="planName" placeholder="e.g. Standard, Premium, Enterprise" />
                <mat-error *ngIf="planForm.get('planName')?.hasError('required')">
                  Plan Name is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Price -->
            <div class="field-group">
              <label class="field-label">
                Price <span class="required-star">*</span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="price" [placeholder]="'e.g. ' + fmt.currencySymbol + '1,999 / mo or ' + fmt.currencySymbol + '19,999'" />
                <mat-error *ngIf="planForm.get('price')?.hasError('required')">
                  Price is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Billing Cycle -->
            <div class="field-group">
              <label class="field-label">
                Billing Cycle <span class="required-star">*</span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <mat-select formControlName="billingCycle" placeholder="Select cycle">
                  <mat-option value="Monthly">Monthly</mat-option>
                  <mat-option value="Yearly">Yearly</mat-option>
                  <mat-option value="Quarterly">Quarterly</mat-option>
                </mat-select>
                <mat-error *ngIf="planForm.get('billingCycle')?.hasError('required')">
                  Billing cycle is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Tenant Limit -->
            <div class="field-group">
              <label class="field-label">
                Tenant Limit <span class="required-star">*</span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput type="number" formControlName="residentLimit" placeholder="e.g. 150" />
                <mat-error *ngIf="planForm.get('residentLimit')?.hasError('required')">
                  Tenant limit is required
                </mat-error>
                <mat-error *ngIf="planForm.get('residentLimit')?.hasError('min')">
                  Limit must be 1 or higher
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Features -->
            <div class="field-group full-width-field">
              <label class="field-label">
                Features Overview / Highlights
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="features" placeholder="e.g. Priority Support, Custom Branding, Dedicated Manager" />
              </mat-form-field>
            </div>

          </div>

          <!-- Feature Configuration Section -->
          <div class="feature-config-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">Feature Configuration</h3>
                <p class="section-subtitle">Toggle module access enabled for this subscription plan</p>
              </div>
              <div class="toggle-all-buttons">
                <button type="button" class="link-btn" (click)="selectAllFeatures(true)">
                  <mat-icon>done_all</mat-icon> Select All
                </button>
                <span class="btn-divider">|</span>
                <button type="button" class="link-btn link-btn-danger" (click)="selectAllFeatures(false)">
                  <mat-icon>remove_done</mat-icon> Clear All
                </button>
              </div>
            </div>

            <div class="features-grid" formGroupName="featureConfig">
              <div 
                *ngFor="let item of featureList" 
                class="feature-card"
                [class.feature-card-active]="isFeatureEnabled(item.id)"
                (click)="toggleFeature(item.id)"
              >
                <div class="feature-card__info">
                  <div class="feature-icon-wrapper" [class.feature-icon-active]="isFeatureEnabled(item.id)">
                    <mat-icon>{{ item.icon }}</mat-icon>
                  </div>
                  <span class="feature-name">{{ item.name }}</span>
                </div>
                <mat-slide-toggle
                  [formControlName]="item.id"
                  (click)="$event.stopPropagation()"
                  color="primary"
                ></mat-slide-toggle>
              </div>
            </div>
          </div>

        <ng-container dialogFooter>
          <app-button variant="secondary" (clicked)="onCancel()">Cancel</app-button>
          <app-button type="submit" [icon]="data.mode === 'edit' ? 'check' : 'add'" [disabled]="planForm.invalid">
            {{ data.mode === 'edit' ? 'Update' : 'Submit' }}
          </app-button>
        </ng-container>
      </app-dialog>
    </form>
  `,
  styles: [`
    .fields-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px 20px;
      margin-bottom: 28px;
    }

    .full-width-field {
      grid-column: span 2;
    }

    .field-group {
      display: flex;
      flex-direction: column;
    }

    .field-label {
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .required-star {
      color: #ef4444;
      margin-left: 2px;
    }

    .auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 600;
      color: #0284c7;
      background: #e0f2fe;
      padding: 2px 8px;
      border-radius: 12px;

      .badge-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
      }
    }

    .full-width {
      width: 100%;

      ::ng-deep {
        .mat-mdc-text-field-wrapper {
          background-color: #ffffff !important;
          border-radius: 8px !important;
          padding: 0 12px !important;
          height: 42px !important;
        }

        .mat-mdc-form-field-flex {
          height: 42px !important;
          align-items: center !important;
        }

        .mat-mdc-form-field-infix {
          padding: 0 !important;
          min-height: 0 !important;
          border-top: none !important;
          display: flex;
          align-items: center;
        }

        .mat-mdc-form-field-subscript-wrapper {
          margin-top: 4px;
        }

        .mdc-notched-outline__leading,
        .mdc-notched-outline__notch,
        .mdc-notched-outline__trailing {
          border-color: #cbd5e1 !important;
          border-width: 1px !important;
        }

        .mat-mdc-select-trigger {
          display: flex;
          align-items: center;
          height: 100%;
        }

        .mat-mdc-select-value {
          font-size: 13.5px;
        }
      }
    }

    .readonly-field {
      ::ng-deep .mat-mdc-text-field-wrapper {
        background-color: #f1f5f9 !important;
        cursor: not-allowed;
      }
      input {
        color: #475569 !important;
        font-weight: 600;
      }
      .suffix-lock {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #94a3b8;
      }
    }

    /* Feature Configuration Section */
    .feature-config-section {
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
    }

    .section-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }

    .section-subtitle {
      font-size: 12.5px;
      color: #64748b;
      margin: 2px 0 0 0;
    }

    .toggle-all-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .link-btn {
      background: none;
      border: none;
      color: #0057e7;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background 0.15s;

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
      }

      &:hover {
        background: #eff6ff;
      }
    }

    .link-btn-danger {
      color: #ef4444;
      &:hover {
        background: #fef2f2;
      }
    }

    .btn-divider {
      color: #cbd5e1;
      font-size: 12px;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .feature-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        border-color: #93c5fd;
        background: #f8fafc;
      }
    }

    .feature-card-active {
      border-color: #3b82f6;
      background: #f0f6ff;
    }

    .feature-card__info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .feature-icon-wrapper {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #f1f5f9;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .feature-icon-active {
      background: #0057e7;
      color: #ffffff;
    }

    .feature-name {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
    }
  `],
})
export class AddPlanDialogComponent implements OnInit {
  /** Currency from Settings → General. */
  readonly fmt = inject(AppFormatService);

  planForm!: FormGroup;
  featureList = FEATURE_CONFIG_ITEMS;

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<AddPlanDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PlanDialogData
  ) {}

  ngOnInit(): void {
    const isEdit = this.data.mode === 'edit' && !!this.data.plan;
    const plan = this.data.plan;

    // Build feature controls map with default true or plan defaults
    const featureControls: Record<string, boolean> = {};
    this.featureList.forEach((item) => {
      if (isEdit && plan?.featureConfig) {
        featureControls[item.id] = !!plan.featureConfig[item.id];
      } else {
        featureControls[item.id] = true; // Enabled by default for new plan
      }
    });

    this.planForm = this.fb.group({
      planId: [isEdit ? plan?.planId : (this.data.nextId || 'PLN-1005')],
      planName: [isEdit ? plan?.planName : '', [Validators.required]],
      price: [isEdit ? plan?.price : '', [Validators.required]],
      billingCycle: [isEdit ? plan?.billingCycle : 'Monthly', [Validators.required]],
      residentLimit: [isEdit ? plan?.residentLimit : 100, [Validators.required, Validators.min(1)]],
      features: [isEdit ? (plan?.features || '') : ''],
      featureConfig: this.fb.group(featureControls),
    });
  }

  isFeatureEnabled(featureId: string): boolean {
    const group = this.planForm.get('featureConfig') as FormGroup;
    return !!group.get(featureId)?.value;
  }

  toggleFeature(featureId: string): void {
    const group = this.planForm.get('featureConfig') as FormGroup;
    const current = group.get(featureId)?.value;
    group.get(featureId)?.setValue(!current);
  }

  selectAllFeatures(enable: boolean): void {
    const group = this.planForm.get('featureConfig') as FormGroup;
    this.featureList.forEach((item) => {
      group.get(item.id)?.setValue(enable);
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSubmit(): void {
    if (this.planForm.invalid) {
      this.planForm.markAllAsTouched();
      return;
    }

    const formVal = this.planForm.getRawValue();
    const result: SubscriptionPlanRow = {
      planId: formVal.planId,
      planName: formVal.planName,
      // A bare number gets the currency symbol from Settings; a price typed with a symbol is kept as is.
      price: /^\d/.test(formVal.price.trim()) ? `${this.fmt.currencySymbol}${formVal.price.trim()}` : formVal.price,
      billingCycle: formVal.billingCycle,
      residentLimit: Number(formVal.residentLimit),
      status: this.data.plan?.status || 'Active',
      createdDate: this.data.plan?.createdDate || new Date().toISOString().split('T')[0],
      features: formVal.features,
      featureConfig: formVal.featureConfig,
    };

    this.dialogRef.close(result);
  }
}
