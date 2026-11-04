import { Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { GuardiansService } from '../../../core/services/guardians.service';
import { Guardian, MAX_OTP_ATTEMPTS, VERIFICATION_TONES } from '../../../core/models/guardians.models';

export interface GuardianVerifyData {
  id: string;
}

/**
 * Send a verification code to a guardian and check what they read back.
 * The code is simulated: the purple banner stands in for the SMS / email the guardian would get.
 */
@Component({
  selector: 'app-guardian-verify-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './guardian-verify-dialog.component.html',
  styleUrl: './guardian-verify-dialog.component.scss',
})
export class GuardianVerifyDialogComponent {
  private readonly data = inject<GuardianVerifyData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<GuardianVerifyDialogComponent, boolean>);
  readonly service = inject(GuardiansService);
  readonly tones = VERIFICATION_TONES;
  readonly maxAttempts = MAX_OTP_ATTEMPTS;

  code = '';
  message = '';
  messageOk = false;
  busy = false;
  /** Ticks every second so the countdown moves. */
  now = Date.now();
  private changed = false;

  constructor() {
    const t = setInterval(() => (this.now = Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  get g(): Guardian {
    return this.service.byId(this.data.id)!;
  }

  get access() {
    return this.service.effectiveAccess(this.g);
  }

  get pending(): boolean {
    return this.g.verification === 'Pending' && !!this.g.otp;
  }

  get secondsLeft(): number {
    const otp = this.g.otp;
    return otp ? Math.max(0, Math.ceil((new Date(otp.expiresAt).getTime() - this.now) / 1000)) : 0;
  }

  get expired(): boolean {
    return this.pending && this.secondsLeft === 0;
  }

  get countdown(): string {
    const s = this.secondsLeft;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  get attemptsLeft(): number {
    return this.maxAttempts - (this.g.otp?.attempts ?? 0);
  }

  get simulatedCode(): string {
    return this.service.simulatedCode(this.data.id) ?? '';
  }

  send(): void {
    this.fail('');
    try {
      this.service.sendVerification(this.data.id);
      this.changed = true;
      this.code = '';
      this.message = 'Verification code sent.';
      this.messageOk = true;
    } catch (err: any) {
      this.fail(err?.message ?? 'Could not send the code.');
    }
  }

  verify(): void {
    this.fail('');
    this.busy = true;
    try {
      const res = this.service.verify(this.data.id, this.code);
      this.changed = true;
      this.message = res.message;
      this.messageOk = res.ok;
      this.code = '';
      if (res.ok) this.dialogRef.close(true);
    } catch (err: any) {
      this.fail(err?.message ?? 'Could not verify.');
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }

  private fail(msg: string): void {
    this.message = msg;
    this.messageOk = false;
  }
}
