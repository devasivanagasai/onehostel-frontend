import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { LaundryService } from '../laundry.service';
import { LaundryUnit, clock } from '../laundry.models';

export interface LaundryStateDialogData {
  unitId: string;
  state: LaundryUnit['state'];
}

/**
 * Mark maintenance / deactivate. Lists the future bookings that will be cancelled and whose
 * residents get notified. Closes with the number of cancelled bookings.
 */
@Component({
  selector: 'app-laundry-state-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  template: `
    <app-dialog
      [title]="maintenance ? 'Mark ' + unit?.name + ' as Maintenance' : 'Deactivate ' + unit?.name"
      [subtitle]="maintenance ? 'Future slots are blocked until it is back in service.' : 'It disappears from booking until you activate it again.'"
      [icon]="maintenance ? 'build' : 'block'"
      [tone]="maintenance ? 'amber' : 'red'"
    >
      @if (maintenance) {
        <div class="fk-field ls__field">
          <label class="fk-label" for="ls-note">Reason <span class="opt">(shared with affected residents)</span></label>
          <span class="fk-control"><input id="ls-note" maxlength="80" [(ngModel)]="note" placeholder="e.g. Drain pump replacement" /></span>
        </div>
      }

      <span class="ls__label">Affected bookings ({{ affected.length }})</span>
      @if (affected.length) {
        <ul class="ls__list">
          @for (b of affected; track b.id) {
            <li>
              <mat-icon fontSet="material-icons-outlined">notifications_active</mat-icon>
              <span><strong>{{ b.residentName }}</strong> · {{ fmt.date(b.date, 'dayDate') }}, {{ clock(b.start) }}</span>
              <small>{{ b.id }} · {{ b.status }}</small>
            </li>
          }
        </ul>
        <p class="ls__note">These bookings will be cancelled and each resident notified in the app.</p>
      } @else {
        <p class="ls__note">No upcoming bookings — nobody needs to be notified.</p>
      }

      <ng-container dialogFooter>
        <app-button variant="secondary" (clicked)="close()">Cancel</app-button>
        <app-button [variant]="maintenance ? 'warning' : 'danger'" [icon]="maintenance ? 'build' : 'block'" (clicked)="apply()">
          {{ maintenance ? 'Mark Maintenance' : 'Deactivate' }}
        </app-button>
      </ng-container>
    </app-dialog>
  `,
  styleUrl: './laundry-state-dialog.component.scss',
})
export class LaundryStateDialogComponent {
  private readonly data = inject<LaundryStateDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LaundryStateDialogComponent, number>);
  private readonly service = inject(LaundryService);
  readonly fmt = inject(AppFormatService);
  readonly clock = clock;

  readonly unit = this.service.unit(this.data.unitId);
  readonly maintenance = this.data.state === 'Maintenance';
  readonly affected = this.service.futureBookings(this.data.unitId);
  note = '';

  apply(): void {
    const cancelled = this.service.setState(this.data.unitId, this.data.state, this.note);
    this.dialogRef.close(cancelled.length);
  }

  close(): void {
    this.dialogRef.close();
  }
}
