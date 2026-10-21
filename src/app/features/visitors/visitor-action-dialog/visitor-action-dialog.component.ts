import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent, AppDialogTone } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { VisitorsService } from '../visitors.service';
import { ID_TYPES, Visitor, VisitorIdType, clock, initials, localIso, maskId, withinHours } from '../visitors.models';

export type VisitorActionMode = 'approve' | 'reject' | 'cancel' | 'checkin';

export interface VisitorActionData {
  id: string;
  mode: VisitorActionMode;
}

const META: Record<VisitorActionMode, { title: string; subtitle: string; icon: string; tone: AppDialogTone; confirm: string }> = {
  approve: { title: 'Approve Visit', subtitle: 'Security can check the visitor in on arrival.', icon: 'verified', tone: 'green', confirm: 'Approve' },
  reject: { title: 'Reject Visit', subtitle: 'The resident is told the request was rejected.', icon: 'block', tone: 'red', confirm: 'Reject' },
  cancel: { title: 'Cancel Visit', subtitle: 'The visit is closed and can no longer be checked in.', icon: 'event_busy', tone: 'red', confirm: 'Cancel Visit' },
  checkin: { title: 'Check In Visitor', subtitle: 'Verify the visitor against the hostel rules and record arrival.', icon: 'login', tone: 'teal', confirm: 'Check In' },
};

/** Decision / gate step on one visitor. Closes with the updated record. */
@Component({
  selector: 'app-visitor-action-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './visitor-action-dialog.component.html',
  styleUrl: './visitor-action-dialog.component.scss',
})
export class VisitorActionDialogComponent {
  private readonly data = inject<VisitorActionData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<VisitorActionDialogComponent, Visitor>);
  private readonly service = inject(VisitorsService);
  readonly fmt = inject(AppFormatService);

  readonly mode = this.data.mode;
  readonly meta = META[this.mode];
  readonly v: Visitor = this.service.byId(this.data.id)!;
  readonly policy = this.service.policy;
  readonly idTypes = ID_TYPES;
  readonly initials = initials;
  readonly clock = clock;
  readonly maskId = maskId;

  readonly residentName = (() => {
    const r = this.service.resident(this.v.residentId);
    return r ? residentFullName(r) : this.v.residentId;
  })();
  readonly location = this.service.location(this.v.residentId);

  /** Check-in: ask for the ID only when policy needs it and none is on record. */
  readonly needsId = this.mode === 'checkin' && this.policy.idRequired && !this.v.idReference;
  readonly outsideHours = this.mode === 'checkin' && !withinHours(localIso(), this.policy.visitingFrom, this.policy.visitingTo);

  reason = '';
  idType: VisitorIdType | '' = '';
  idReference = '';
  idVerified = false;
  submitted = false;
  error = '';

  get reasonRequired(): boolean {
    return this.mode === 'reject' || this.mode === 'cancel' || this.outsideHours;
  }

  get reasonLabel(): string {
    if (this.mode === 'checkin') return 'Reason to allow entry outside visiting hours';
    return this.mode === 'approve' ? 'Note' : 'Reason';
  }

  get reasonError(): string {
    return this.submitted && this.reasonRequired && !this.reason.trim() ? 'A reason is required' : '';
  }

  get idError(): string {
    return this.submitted && this.needsId && (!this.idType || !this.idReference.trim()) ? 'ID type and reference are required by the hostel rules' : '';
  }

  get verifyError(): string {
    return this.submitted && this.mode === 'checkin' && !this.idVerified ? 'Confirm you have verified the visitor' : '';
  }

  submit(): void {
    this.submitted = true;
    if (this.reasonError || this.idError || this.verifyError) return;
    this.error = '';
    try {
      const id = this.v.id;
      const next =
        this.mode === 'approve' ? this.service.decide(id, true, this.reason)
        : this.mode === 'reject' ? this.service.decide(id, false, this.reason)
        : this.mode === 'cancel' ? this.service.cancel(id, this.reason)
        : this.service.checkIn(id, { idType: this.idType || undefined, idReference: this.idReference, overrideReason: this.outsideHours ? this.reason : undefined });
      this.dialogRef.close(next);
    } catch (err: any) {
      this.error = err?.message ?? 'Something went wrong.';
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
