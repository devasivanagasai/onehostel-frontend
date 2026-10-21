import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AppDialogComponent } from '../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

export interface ReasonDialogData {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Asks for a mandatory reason (≥ 5 chars) before an adjustment such as cancelling a charge. */
@Component({
  selector: 'app-reason-dialog',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, AppDialogComponent, AppButtonComponent],
  template: `
    <app-dialog [title]="data.title">
      <p class="msg">{{ data.message }}</p>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Reason</mat-label>
        <textarea matInput [(ngModel)]="reason" rows="3" maxlength="250" required cdkFocusInitial></textarea>
        <mat-hint>Required · recorded in the audit log</mat-hint>
      </mat-form-field>

      <ng-container dialogFooter>
        <app-button variant="secondary" (clicked)="cancel()">Cancel</app-button>
        <app-button variant="danger" [disabled]="reason.trim().length < 5" (clicked)="ref.close(reason.trim())">
          {{ data.confirmLabel }}
        </app-button>
      </ng-container>
    </app-dialog>
  `,
  styles: [
    `
      .msg { margin: 0 0 14px; color: #475569; font-size: 13.5px; }
      .full { width: 100%; }
    `,
  ],
})
export class ReasonDialogComponent {
  readonly data = inject<ReasonDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ReasonDialogComponent, string>);
  reason = '';

  cancel(): void {
    this.ref.close();
  }
}
