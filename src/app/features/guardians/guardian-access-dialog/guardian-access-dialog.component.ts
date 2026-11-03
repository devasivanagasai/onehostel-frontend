import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { GuardiansService } from '../../../core/services/guardians.service';
import { Guardian, REASON_MAX } from '../../../core/models/guardians.models';

export type GuardianAccessMode = 'revoke' | 'restore';

export interface GuardianAccessData {
  id: string;
  mode: GuardianAccessMode;
}

/** Sensitive action: revoke or restore a guardian's access. A reason is required and goes to the audit log. */
@Component({
  selector: 'app-guardian-access-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './guardian-access-dialog.component.html',
  styleUrl: './guardian-access-dialog.component.scss',
})
export class GuardianAccessDialogComponent {
  private readonly data = inject<GuardianAccessData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<GuardianAccessDialogComponent, Guardian>);
  readonly service = inject(GuardiansService);

  readonly g: Guardian = this.service.byId(this.data.id)!;
  readonly revoking = this.data.mode === 'revoke';
  readonly residentName = this.service.residentName(this.g.residentId);
  readonly reasonMax = REASON_MAX;

  reason = '';
  attempted = false;
  saving = false;
  saveError = '';

  get reasonError(): string {
    return this.attempted && !this.reason.trim() ? 'A reason is required' : '';
  }

  confirm(): void {
    this.attempted = true;
    if (this.reasonError) return;
    this.saving = true;
    this.saveError = '';
    try {
      const next = this.revoking ? this.service.revoke(this.g.id, this.reason) : this.service.restore(this.g.id, this.reason);
      this.dialogRef.close(next);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not update access.';
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
