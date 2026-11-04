import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { GuardiansService } from '../../../core/services/guardians.service';
import { ACCESS_SCOPES, Guardian, VERIFICATION_TONES } from '../../../core/models/guardians.models';

/** What the owner chose in the detail view; the list opens the matching dialog. */
export type GuardianViewAction = 'edit' | 'verify' | 'revoke' | 'restore' | 'primary';

export interface GuardianViewData {
  id: string;
}

/** Guardian detail: contact, consent, scope, access state, what each kind of alert would do, and history. */
@Component({
  selector: 'app-guardian-view-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './guardian-view-dialog.component.html',
  styleUrl: './guardian-view-dialog.component.scss',
})
export class GuardianViewDialogComponent {
  private readonly data = inject<GuardianViewData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<GuardianViewDialogComponent, GuardianViewAction>);
  readonly service = inject(GuardiansService);
  readonly fmt = inject(AppFormatService);
  readonly tones = VERIFICATION_TONES;
  readonly kinds = ACCESS_SCOPES;

  get g(): Guardian {
    return this.service.byId(this.data.id)!;
  }

  get access() {
    return this.service.effectiveAccess(this.g);
  }

  get resident() {
    return this.service.resident(this.g.residentId);
  }

  get residentName(): string {
    return this.service.residentName(this.g.residentId);
  }

  /** Other guardians of the same resident. */
  get others(): Guardian[] {
    return this.service.byResident(this.g.residentId).filter((x) => x.id !== this.g.id);
  }

  /** Same mobile linked to another resident (siblings); each link is verified on its own. */
  get sameMobileElsewhere(): Guardian[] {
    const m = this.g.mobile;
    return m ? this.service.guardians.filter((x) => x.id !== this.g.id && x.mobile === m && x.residentId !== this.g.residentId) : [];
  }

  /** Newest first. */
  get history() {
    return [...this.g.history].reverse();
  }

  blocker(kind: (typeof ACCESS_SCOPES)[number]): string {
    return this.service.notifyBlocker(this.g, kind);
  }

  act(a: GuardianViewAction): void {
    this.dialogRef.close(a);
  }

  close(): void {
    this.dialogRef.close();
  }
}
