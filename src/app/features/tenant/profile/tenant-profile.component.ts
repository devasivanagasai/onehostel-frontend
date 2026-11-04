import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppFormatService } from '../../../core/services/app-format.service';
import { TenantProfileService, TenantProfileView } from '../../../core/services/tenant-profile.service';
import { PROFILE_FIELD_LABELS, ProfileRequestStatus, TenantAccountStatus, TenantProfileRequest } from '../../../core/models/tenant-profile.models';
import { TenantProfileRequestDialogComponent } from './request-dialog/tenant-profile-request-dialog.component';

type LoadState = 'loading' | 'ready' | 'error';

const ACCOUNT_TONES: Record<TenantAccountStatus, string> = {
  'Pending Activation': 'warning',
  Active: 'success',
  Suspended: 'danger',
  'Checked Out': 'neutral',
};

const REQUEST_TONES: Record<ProfileRequestStatus, string> = {
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
};

/** My Profile (FRD 5.3): read-only identity, optional photo, documents, and profile update requests. */
@Component({
  selector: 'app-tenant-profile',
  standalone: true,
  imports: [MatIconModule, MatDialogModule, MatSnackBarModule, AppButtonComponent, AppTableCardComponent],
  templateUrl: './tenant-profile.component.html',
  styleUrl: './tenant-profile.component.scss',
})
export class TenantProfileComponent implements OnInit {
  readonly service = inject(TenantProfileService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly labels = PROFILE_FIELD_LABELS;
  state: LoadState = 'loading';
  profile?: TenantProfileView;
  requests: TenantProfileRequest[] = [];
  photoError = '';
  uploading = false;

  ngOnInit(): void {
    this.service.view$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.profile = v;
      if (this.state !== 'loading') this.state = v ? 'ready' : 'error';
    });
    this.service.mine$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((list) => (this.requests = list));
    this.load();
  }

  /** Shows the loading state briefly, then the page (or the error state with Retry). */
  load(): void {
    this.state = 'loading';
    setTimeout(() => (this.state = this.service.view ? 'ready' : 'error'), 250);
  }

  accountTone(s: TenantAccountStatus): string {
    return ACCOUNT_TONES[s];
  }

  requestTone(s: ProfileRequestStatus): string {
    return REQUEST_TONES[s];
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  requestValue(r: TenantProfileRequest): string {
    return r.field === 'emergencyContact' ? `${r.proposedValue} · ${r.proposedValue2 ?? ''}` : r.proposedValue;
  }

  // ---- Actions ----------------------------------------------------------------

  openRequestDialog(): void {
    this.dialog
      .open<TenantProfileRequestDialogComponent, void, TenantProfileRequest>(TenantProfileRequestDialogComponent, {
        width: '620px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
      })
      .afterClosed()
      .subscribe((r) => {
        if (r) this.snackBar.open(`Request ${r.id} sent to the hostel office. You will be notified of the decision.`, 'Close', { duration: 5000 });
      });
  }

  cancel(r: TenantProfileRequest): void {
    this.confirm
      .confirm({
        title: 'Cancel this request?',
        message: `Your request to change your ${this.labels[r.field].toLowerCase()} will be withdrawn.`,
        confirmLabel: 'Cancel Request',
        cancelLabel: 'Keep Request',
        tone: 'warning',
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          this.service.cancelRequest(r.id);
          this.snackBar.open(`Request ${r.id} cancelled.`, 'Close', { duration: 3500 });
        } catch (err) {
          this.snackBar.open(err instanceof Error ? err.message : 'Could not cancel the request.', 'Close', { duration: 4500 });
        }
      });
  }

  async onPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError = '';
    this.uploading = true;
    try {
      await this.service.setPhoto(file);
      this.snackBar.open('Profile photo updated.', 'Close', { duration: 3000 });
    } catch (err) {
      this.photoError = err instanceof Error ? err.message : 'Could not upload the photo.';
    } finally {
      this.uploading = false;
    }
  }

  removePhoto(): void {
    try {
      this.service.removePhoto();
      this.photoError = '';
      this.snackBar.open('Uploaded photo removed.', 'Close', { duration: 3000 });
    } catch (err) {
      this.photoError = err instanceof Error ? err.message : 'Could not remove the photo.';
    }
  }
}
