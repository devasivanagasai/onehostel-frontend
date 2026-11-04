import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { VisitorsService } from '../visitors.service';
import { VisitorRules, WALK_IN_OPTIONS, clock } from '../visitors.models';

/**
 * Local visitor rules (approval, walk-ins, ID retention). Visiting hours, visitor limit and
 * ID requirement come from Hostel Settings → Rules and are shown read-only here.
 */
@Component({
  selector: 'app-visitor-rules-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './visitor-rules-dialog.component.html',
  styleUrl: './visitor-rules-dialog.component.scss',
})
export class VisitorRulesDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<VisitorRulesDialogComponent, boolean>);
  private readonly router = inject(Router);
  private readonly service = inject(VisitorsService);

  readonly policy = this.service.policy;
  readonly walkInOptions = WALK_IN_OPTIONS;
  readonly clock = clock;

  rules: VisitorRules = { ...this.service.rules };

  get retentionError(): string {
    const d = this.rules.idRetentionDays;
    return !Number.isInteger(d) || d < 1 || d > 365 ? 'Enter 1 to 365 days' : '';
  }

  openSettings(): void {
    this.dialogRef.close();
    this.router.navigate(['/hostel-settings']);
  }

  save(): void {
    if (this.retentionError) return;
    this.service.saveRules(this.rules);
    this.dialogRef.close(true);
  }

  close(): void {
    this.dialogRef.close();
  }
}
