import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { ParcelsService } from '../parcels.service';
import { COLLECTOR_RELATIONS, Parcel } from '../parcels.models';

export interface ParcelHandoverData {
  id: string;
  mode: 'collect' | 'return';
}

const RETURN_REASONS = ['Not collected in time', 'Refused by resident', 'Not a resident / wrong address', 'Damaged on arrival'];

/** Pickup confirmation or return to sender. Closes with the updated parcel. */
@Component({
  selector: 'app-parcel-handover-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './parcel-handover-dialog.component.html',
  styleUrl: './parcel-handover-dialog.component.scss',
})
export class ParcelHandoverDialogComponent {
  private readonly data = inject<ParcelHandoverData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ParcelHandoverDialogComponent, Parcel>);
  private readonly service = inject(ParcelsService);
  readonly fmt = inject(AppFormatService);

  readonly mode = this.data.mode;
  readonly p: Parcel = this.service.byId(this.data.id)!;
  readonly relations = COLLECTOR_RELATIONS;
  readonly returnReasons = RETURN_REASONS;
  readonly residentName = (() => {
    const r = this.service.resident(this.p.residentId);
    return r ? residentFullName(r) : this.p.residentId;
  })();
  readonly location = this.service.location(this.p.residentId);
  readonly age = this.service.ageDays(this.p);

  // Collect
  self = true;
  name = '';
  relation = '';
  idReference = '';
  confirmed = false;
  // Both: reason (collect by someone else / return)
  reason = '';
  // Return
  returnedTo = '';

  submitted = false;
  error = '';

  get nameError(): string {
    return this.submitted && this.mode === 'collect' && !this.self && !this.name.trim() ? 'Enter the collector’s name' : '';
  }

  get relationError(): string {
    return this.submitted && this.mode === 'collect' && !this.self && !this.relation ? 'Pick the relation to the resident' : '';
  }

  get reasonError(): string {
    const needed = this.mode === 'return' || !this.self;
    return this.submitted && needed && !this.reason.trim() ? 'A reason is required' : '';
  }

  get returnedToError(): string {
    return this.submitted && this.mode === 'return' && !this.returnedTo.trim() ? 'Who took the parcel back?' : '';
  }

  get confirmError(): string {
    return this.submitted && this.mode === 'collect' && !this.confirmed ? 'Confirm the handover' : '';
  }

  /** Quick reason chips prefill (or prefix) the reason text. */
  pickReason(r: string): void {
    const cur = this.reason.trim();
    this.reason = !cur ? r : cur.startsWith(r) ? cur : `${r}. ${cur}`;
  }

  submit(): void {
    this.submitted = true;
    if (this.nameError || this.relationError || this.reasonError || this.returnedToError || this.confirmError) return;
    this.error = '';
    try {
      const next =
        this.mode === 'collect'
          ? this.service.collect(this.p.id, { self: this.self, name: this.name, relation: this.relation, idReference: this.idReference, reason: this.reason })
          : this.service.returnToSender(this.p.id, { reason: this.reason, returnedTo: this.returnedTo });
      this.dialogRef.close(next);
    } catch (err: any) {
      this.error = err?.message ?? 'Something went wrong.';
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
