import { Component, Input, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { planDetailFor } from '../../plan-details';
import { SubscriptionPlanService } from '../../../../../core/services/subscription-plan.service';

@Component({
  selector: 'app-step-subscription',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule],
  template: `
    <div [formGroup]="formGroup" class="step-grid">
      <div class="field-group">
        <label class="field-label">Subscription Plan<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <mat-select formControlName="plan" placeholder="Select Plan">
            @for (p of plans.activePlans; track p.planId) {
              <mat-option [value]="p.planName">{{ p.planName }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div class="field-group">
        <label class="field-label">Billing Cycle<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <mat-select formControlName="billingCycle" placeholder="Select Billing Cycle">
            <mat-option value="Monthly">Monthly</mat-option>
            <mat-option value="Yearly">Yearly</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div class="field-group">
        <label class="field-label">Start Date<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput [matDatepicker]="startPicker" formControlName="startDate" placeholder="Select Date" />
          <mat-datepicker-toggle matSuffix [for]="startPicker"></mat-datepicker-toggle>
          <mat-datepicker #startPicker></mat-datepicker>
        </mat-form-field>
      </div>

      <div class="field-group">
        <label class="field-label">End Date<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput [matDatepicker]="endPicker" formControlName="endDate" placeholder="Select Date" />
          <mat-datepicker-toggle matSuffix [for]="endPicker"></mat-datepicker-toggle>
          <mat-datepicker #endPicker></mat-datepicker>
        </mat-form-field>
      </div>

      @if (formGroup.errors?.['endBeforeStart'] && formGroup.get('endDate')?.touched) {
        <p class="step-grid__full group-error" role="alert">End date cannot be earlier than the start date.</p>
      }

      <div class="plan-summary step-grid__full">
        <div class="plan-summary__row">
          <span>Tenant Limit</span>
          <strong>{{ planDetail.residentLimit }} tenants</strong>
        </div>
        <div class="plan-summary__row plan-summary__row--features">
          <span>Enabled Features</span>
          <div class="plan-summary__chips">
            @for (feature of planDetail.features; track feature) {
              <span class="plan-chip">{{ feature }}</span>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .step-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;

        @media (max-width: 720px) {
          grid-template-columns: 1fr;
        }
      }

      .step-grid__full {
        grid-column: 1 / -1;
      }

      .group-error {
        color: #dc2626;
        font-size: 12px;
        margin: 0;
      }

      .plan-summary {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 14px 16px;
      }

      .plan-summary__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        padding: 6px 0;

        span {
          color: #64748b;
        }

        strong {
          color: #0f172a;
        }
      }

      .plan-summary__row--features {
        align-items: flex-start;
      }

      .plan-summary__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-end;
        max-width: 70%;
      }

      .plan-chip {
        background: #e6f7f5;
        color: #0d9488;
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 11.5px;
        font-weight: 600;
      }
    `,
  ],
})
export class StepSubscriptionComponent {
  @Input({ required: true }) formGroup!: FormGroup;

  readonly plans = inject(SubscriptionPlanService);

  get planDetail() {
    const name = (this.formGroup.get('plan')?.value as string) ?? '';
    return planDetailFor(this.plans.byName(name), name);
  }
}
