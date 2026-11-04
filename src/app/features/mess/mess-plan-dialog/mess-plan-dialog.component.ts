import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { MessService } from '../mess.service';
import { MEAL_PLANS, MealPlan, PLAN_HINTS } from '../mess.models';

export interface MessPlanDialogData {
  residentId: string;
  name: string;
}

const NOTE_MAX = 200;

/** Edit a resident's meal plan and restricted dietary note. Closes with true when saved. */
@Component({
  selector: 'app-mess-plan-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  template: `
    <app-dialog [title]="'Meal Plan · ' + data.name" subtitle="Pick the plan and record only the dietary information the kitchen needs." icon="badge" tone="teal">
      <div class="fk-field">
        <span class="fk-label">Meal Plan</span>
        <div class="mpd__plans" role="radiogroup" aria-label="Meal plan">
          @for (p of plans; track p) {
            <button type="button" role="radio" class="mpd__plan" [class.is-on]="plan === p" [attr.aria-checked]="plan === p" (click)="plan = p">
              <span><strong>{{ p }}</strong><small>{{ hints[p] }}</small></span>
              @if (plan === p) { <mat-icon>check_circle</mat-icon> }
            </button>
          }
        </div>
      </div>

      <div class="fk-field mpd__note">
        <label class="fk-label" for="mpd-note">Dietary Notes <span class="opt">(Optional)</span></label>
        <span class="fk-control"><textarea id="mpd-note" rows="3" [maxlength]="noteMax" [(ngModel)]="note" placeholder="e.g. Peanut allergy; vegetarian"></textarea></span>
        <span class="mpd__restricted"><mat-icon fontSet="material-icons-outlined">lock</mat-icon>Restricted: hidden in lists and every view or change is logged. Avoid medical details the kitchen doesn't need.</span>
      </div>

      <ng-container dialogFooter>
        <app-button variant="secondary" (clicked)="ref.close()">Cancel</app-button>
        <app-button variant="accent" icon="save" [iconOutlined]="true" (clicked)="save()">Save</app-button>
      </ng-container>
    </app-dialog>
  `,
  styleUrl: './mess-plan-dialog.component.scss',
})
export class MessPlanDialogComponent {
  readonly data = inject<MessPlanDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<MessPlanDialogComponent, boolean>);
  private readonly service = inject(MessService);

  readonly plans = MEAL_PLANS;
  readonly hints = PLAN_HINTS;
  readonly noteMax = NOTE_MAX;

  private readonly profile = this.service.profile(this.data.residentId);
  plan: MealPlan = this.profile.plan;
  note = this.profile.dietaryNote ?? '';

  save(): void {
    this.service.saveProfile(this.data.residentId, this.plan, this.note);
    this.ref.close(true);
  }
}
