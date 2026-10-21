import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { UPGRADE_PLANS } from './hostel-settings.models';

export interface UpgradeRequestResult {
  desiredPlan: string;
  note: string;
}

/** Plan upgrade request — goes to SuperAdmin / billing; nothing about the plan or price changes here. */
@Component({
  selector: 'app-hs-upgrade-request-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <app-dialog
        title="Request plan upgrade"
        subtitle="Sent to OneHostel for review. Pricing and billing are handled by the billing team."
        icon="upgrade"
        tone="teal"
      >
        <div class="ur-body">
          <p class="ur-current">Current plan: <strong>{{ data.currentPlan }}</strong></p>
          <div class="fk-field">
            <label class="fk-label" for="ur-plan">Desired Plan<span class="req">*</span></label>
            <span class="fk-control" [class.is-invalid]="form.controls.desiredPlan.touched && form.controls.desiredPlan.invalid">
              <select id="ur-plan" formControlName="desiredPlan" [class.is-placeholder]="!form.value.desiredPlan">
                <option value="" disabled>Select a plan</option>
                @for (p of plans; track p.planId) {
                  <option [value]="p.planName">
                    {{ p.planName }} — {{ p.price }}{{ p.residentLimit ? ' · up to ' + p.residentLimit + ' tenants' : '' }}
                  </option>
                }
              </select>
              <mat-icon class="fk-caret">expand_more</mat-icon>
            </span>
            @if (form.controls.desiredPlan.touched && form.controls.desiredPlan.invalid) {
              <span class="fk-error">Select the plan you'd like</span>
            }
          </div>
          <div class="fk-field">
            <label class="fk-label" for="ur-note">Note <span class="opt">(optional)</span></label>
            <span class="fk-control">
              <textarea id="ur-note" formControlName="note" rows="3" maxlength="300" placeholder="e.g. Need SMS alerts and the Mess module from next month"></textarea>
            </span>
            <span class="fk-hint">{{ form.value.note?.length ?? 0 }} / 300</span>
          </div>
        </div>
        <ng-container dialogFooter>
          <app-button variant="secondary" (clicked)="ref.close()">Cancel</app-button>
          <app-button type="submit" icon="send">Send request</app-button>
        </ng-container>
      </app-dialog>
    </form>
  `,
  styleUrl: './upgrade-request-dialog.component.scss',
})
export class UpgradeRequestDialogComponent {
  readonly ref = inject(MatDialogRef<UpgradeRequestDialogComponent, UpgradeRequestResult>);
  readonly data = inject<{ currentPlan: string }>(MAT_DIALOG_DATA);
  readonly plans = UPGRADE_PLANS;

  readonly form = inject(FormBuilder).nonNullable.group({
    desiredPlan: ['', Validators.required],
    note: ['', Validators.maxLength(300)],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.ref.close(this.form.getRawValue());
  }
}
