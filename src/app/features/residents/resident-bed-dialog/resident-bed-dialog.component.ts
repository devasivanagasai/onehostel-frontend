import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { Bed, Room } from '../../rooms-management/rooms.models';
import { AppFormatService } from '../../../core/services/app-format.service';
import { ResidentAllocation, ResidentsService } from '../residents.service';
import { HostelResident, residentFullName } from '../residents.models';

export type ResidentBedMode = 'allocate' | 'transfer' | 'checkout';

export interface ResidentBedDialogData {
  resident: HostelResident;
  mode: ResidentBedMode;
}

export interface ResidentBedDialogResult {
  mode: ResidentBedMode;
  date: string;
  roomId?: string;
  bedId?: string;
  notes?: string;
}

const MODE_META: Record<ResidentBedMode, { title: string; icon: string; submit: string }> = {
  allocate: { title: 'Allocate Bed', icon: 'bed', submit: 'Allocate bed' },
  transfer: { title: 'Transfer Bed', icon: 'swap_horiz', submit: 'Transfer' },
  checkout: { title: 'Check Out Resident', icon: 'logout', submit: 'Check out' },
};

@Component({
  selector: 'app-resident-bed-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './resident-bed-dialog.component.html',
  styleUrl: './resident-bed-dialog.component.scss',
})
export class ResidentBedDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly residents = inject(ResidentsService);
  private readonly dialogRef = inject(MatDialogRef<ResidentBedDialogComponent, ResidentBedDialogResult>);
  readonly fmt = inject(AppFormatService);
  readonly data = inject<ResidentBedDialogData>(MAT_DIALOG_DATA);

  readonly meta = MODE_META[this.data.mode];
  readonly name = residentFullName(this.data.resident);
  readonly current: ResidentAllocation | undefined = this.residents.allocationFor(this.data.resident.residentId);
  readonly currentLabel = this.residents.describe(this.current);

  /** Earliest valid date: the joining date for new allocations / check-out, the current bed's start for transfers. */
  readonly minDate =
    this.data.mode === 'transfer' && this.current?.bed.joinedDate ? this.current.bed.joinedDate : this.data.resident.joiningDate;

  readonly form = this.fb.nonNullable.group({
    roomId: ['', this.data.mode === 'checkout' ? [] : Validators.required],
    bedId: ['', this.data.mode === 'checkout' ? [] : Validators.required],
    date: [this.defaultDate(), Validators.required],
    notes: [''],
  });

  /** Only Available beds the resident may take (so the current, occupied bed is never offered). */
  readonly rooms: Room[] = this.residents.eligibleRooms(this.data.resident);

  get beds(): Bed[] {
    const room = this.rooms.find((r) => r.id === this.form.value.roomId);
    return room?.beds.filter((b) => b.status === 'Available') ?? [];
  }

  get dateTooEarly(): boolean {
    const d = this.form.value.date;
    return !!d && d < this.minDate;
  }

  onRoomPicked(): void {
    const beds = this.beds;
    this.form.patchValue({ bedId: beds.length === 1 ? beds[0].id : '' });
  }

  submit(): void {
    if (this.form.invalid || this.dateTooEarly) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.dialogRef.close({
      mode: this.data.mode,
      date: v.date,
      roomId: v.roomId || undefined,
      bedId: v.bedId || undefined,
      notes: v.notes || undefined,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private defaultDate(): string {
    const today = new Date().toISOString().slice(0, 10);
    return this.data.mode === 'allocate' && this.data.resident.joiningDate > today ? this.data.resident.joiningDate : today;
  }
}
