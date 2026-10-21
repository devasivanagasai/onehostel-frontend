import { Component, Inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent, AppButtonVariant } from '../button/app-button.component';

export type ConfirmDialogTone = 'primary' | 'danger' | 'success' | 'warning';

export interface ConfirmDialogDetail {
  icon: string;
  label: string;
  value: string;
}

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm action in the warn palette for destructive/irreversible actions. */
  danger?: boolean;
  /** Material icon shown in the header badge. Defaults from the tone. */
  icon?: string;
  /** Colour theme for the icon and confirm button. Defaults to 'danger' when `danger` is set, else 'primary'. */
  tone?: ConfirmDialogTone;
  /** Optional key facts (e.g. where a password is sent), rendered as a list under the message. */
  details?: ConfirmDialogDetail[];
  /** Optional follow-up note shown in a highlighted box. */
  note?: string;
}

const CONFIRM_VARIANTS: Record<ConfirmDialogTone, AppButtonVariant> = {
  primary: 'primary',
  danger: 'danger',
  success: 'accent',
  warning: 'warning',
};

const DEFAULT_ICONS: Record<ConfirmDialogTone, string> = {
  primary: 'help_outline',
  danger: 'warning_amber',
  success: 'check_circle_outline',
  warning: 'error_outline',
};

/**
 * Generic confirmation dialog for any sensitive action (suspend hostel,
 * delete admin, cancel subscription, ...). Open it via ConfirmDialogService
 * rather than calling MatDialog directly, so every confirmation looks the same.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, AppButtonComponent],
  templateUrl: './app-confirm-dialog.component.html',
  styleUrl: './app-confirm-dialog.component.scss',
})
export class AppConfirmDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<AppConfirmDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData,
  ) {}

  get tone(): ConfirmDialogTone {
    return this.data.tone ?? (this.data.danger ? 'danger' : 'primary');
  }

  /** Confirm button colour follows the dialog's tone. */
  get confirmVariant(): AppButtonVariant {
    return CONFIRM_VARIANTS[this.tone];
  }

  get icon(): string {
    return this.data.icon ?? DEFAULT_ICONS[this.tone];
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
