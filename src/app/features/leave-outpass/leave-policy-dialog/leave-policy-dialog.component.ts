import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { LeaveOutpassService } from '../leave-outpass.service';
import { LeavePolicy } from '../leave-outpass.models';

/** Hostel rules for leave / outpass requests, kept locally. Closes with true when saved. */
@Component({
  selector: 'app-leave-policy-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatSlideToggleModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './leave-policy-dialog.component.html',
  styleUrl: './leave-policy-dialog.component.scss',
})
export class LeavePolicyDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<LeavePolicyDialogComponent, boolean>);
  private readonly service = inject(LeaveOutpassService);

  readonly policy: LeavePolicy = structuredClone(this.service.policy);
  saveError = '';

  get hoursError(): string {
    const h = Number(this.policy.outpassMaxHours);
    return Number.isInteger(h) && h >= 1 && h <= 24 ? '' : 'Enter whole hours between 1 and 24';
  }

  save(): void {
    if (this.hoursError) return;
    try {
      this.service.savePolicy({ ...this.policy, outpassMaxHours: Number(this.policy.outpassMaxHours) });
      this.dialogRef.close(true);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the policy.';
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
