import { Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AppFormErrorComponent } from '../../../../../shared/components/form-error/app-form-error.component';

@Component({
  selector: 'app-step-capacity',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, AppFormErrorComponent],
  template: `
    <div [formGroup]="formGroup" class="step-grid">
      <div class="field-group">
        <label class="field-label">Number of Buildings<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput type="number" min="1" formControlName="buildings" placeholder="e.g. 2" />
        </mat-form-field>
        <app-form-error [control]="formGroup.get('buildings')" label="Number of buildings"></app-form-error>
      </div>

      <div class="field-group">
        <label class="field-label">Number of Floors<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput type="number" min="1" formControlName="floors" placeholder="e.g. 5" />
        </mat-form-field>
        <app-form-error [control]="formGroup.get('floors')" label="Number of floors"></app-form-error>
      </div>

      <div class="field-group">
        <label class="field-label">Number of Rooms<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput type="number" min="1" formControlName="rooms" placeholder="e.g. 150" />
        </mat-form-field>
        <app-form-error [control]="formGroup.get('rooms')" label="Number of rooms"></app-form-error>
      </div>

      <div class="field-group">
        <label class="field-label">Total Beds<span class="required-mark">*</span></label>
        <mat-form-field appearance="outline">
          <input matInput type="number" min="1" formControlName="totalBeds" placeholder="e.g. 500" />
        </mat-form-field>
        <app-form-error [control]="formGroup.get('totalBeds')" label="Total beds"></app-form-error>
      </div>
      @if (formGroup.errors?.['bedsLessThanRooms'] && formGroup.get('totalBeds')?.touched) {
        <p style="grid-column:1/-1;color:#dc2626;font-size:12px;margin:0" role="alert">Total beds cannot be fewer than the number of rooms.</p>
      }
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
    `,
  ],
})
export class StepCapacityComponent {
  @Input({ required: true }) formGroup!: FormGroup;
}
