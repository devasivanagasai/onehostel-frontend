import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { ResidentsService } from '../residents.service';
import { HostelResident, formatMobile, residentFullName } from '../residents.models';

export interface ResidentViewDialogData {
  residentId: string;
  canViewBalance: boolean;
}

/** Follow-up the list page runs after the dialog closes. */
export type ResidentViewAction = 'edit' | 'allocate' | 'transfer' | 'invite' | 'checkout' | 'deactivate' | 'reactivate';

@Component({
  selector: 'app-resident-view-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './resident-view-dialog.component.html',
  styleUrl: './resident-view-dialog.component.scss',
})
export class ResidentViewDialogComponent {
  private readonly residents = inject(ResidentsService);
  private readonly dialogRef = inject(MatDialogRef<ResidentViewDialogComponent, ResidentViewAction>);
  readonly fmt = inject(AppFormatService);
  readonly data = inject<ResidentViewDialogData>(MAT_DIALOG_DATA);

  readonly formatMobile = formatMobile;

  tab: 'profile' | 'activity' = 'profile';

  get resident(): HostelResident {
    return this.residents.byId(this.data.residentId)!;
  }

  get name(): string {
    return residentFullName(this.resident);
  }

  get allocation() {
    return this.residents.allocationFor(this.data.residentId);
  }

  get canHoldBed(): boolean {
    return !this.resident.deactivatedAt && this.residents.canHoldBed(this.resident.status);
  }

  get initials(): string {
    return (this.resident.firstName[0] + (this.resident.lastName[0] ?? '')).toUpperCase();
  }

  statusKey(status: string): string {
    return status.toLowerCase().replace(/\s+/g, '-');
  }

  run(action: ResidentViewAction): void {
    this.dialogRef.close(action);
  }

  close(): void {
    this.dialogRef.close();
  }
}
