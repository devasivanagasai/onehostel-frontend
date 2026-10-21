import { Component, DestroyRef, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountService } from '../../../core/services/account.service';
import { AuthService } from '../../../core/services/auth.service';
import { MOBILE_CODES, UserProfile, profileFullName, profileInitials } from '../../../core/models/account.models';
import { UnsavedChangesAware } from '../../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { CustomValidators } from '../../../shared/validators/custom-validators';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';

const MAX_PHOTO_BYTES = 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    AppDatePipe,
    AppButtonComponent,
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements UnsavedChangesAware {
  @ViewChild('photoInput') private photoInput?: ElementRef<HTMLInputElement>;

  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly mobileCodes = MOBILE_CODES;

  readonly form = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, CustomValidators.noWhitespace, Validators.maxLength(50)]],
    lastName: ['', [Validators.required, CustomValidators.noWhitespace, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email]],
    mobileCode: ['+91', Validators.required],
    mobile: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    avatarDataUrl: [''],
  });

  profile: UserProfile | null = null;
  saving = false;

  constructor() {
    this.account.profile$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((profile) => {
      this.profile = profile;
      // Don't clobber edits in progress if the profile is re-emitted.
      if (profile && !this.form.dirty) this.resetForm(profile);
    });
  }

  // ---- View helpers ----------------------------------------------------------

  /** Live preview: the summary card reflects unsaved edits as you type. */
  get preview(): Pick<UserProfile, 'firstName' | 'lastName' | 'email' | 'avatarDataUrl'> {
    const v = this.form.getRawValue();
    return { firstName: v.firstName, lastName: v.lastName, email: v.email, avatarDataUrl: v.avatarDataUrl };
  }

  get displayName(): string {
    return profileFullName(this.preview) || 'Your name';
  }

  get initials(): string {
    return profileInitials(this.preview);
  }

  /** When you last signed in on this browser. */
  get lastLoginAt(): string | null {
    return this.auth.lastLoginAt;
  }

  get passwordAgeDays(): number {
    return this.account.passwordAgeDays;
  }

  get passwordExpiresInDays(): number | null {
    return this.account.passwordExpiresInDays;
  }

  get passwordStatus(): 'never' | 'ok' | 'soon' | 'expired' {
    const days = this.passwordExpiresInDays;
    if (days === null) return 'never';
    if (days <= 0) return 'expired';
    if (days <= 14) return 'soon';
    return 'ok';
  }

  /** When the password was last changed (for the Account Security card). */
  get passwordChangedOn(): string | null {
    return this.profile?.passwordChangedAt ?? null;
  }

  /** When the current password expires, or null if passwords never expire. */
  get passwordExpiresOn(): Date | null {
    const days = this.passwordExpiresInDays;
    if (days === null || !this.passwordChangedOn) return null;
    const d = new Date(this.passwordChangedOn);
    d.setDate(d.getDate() + this.passwordAgeDays + days);
    return d;
  }

  get passwordAgeLabel(): string {
    const days = this.passwordAgeDays;
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  }

  hasError(control: string, error: string): boolean {
    const c = this.form.get(control);
    return !!c && c.hasError(error) && (c.dirty || c.touched);
  }

  // ---- Photo -----------------------------------------------------------------

  choosePhoto(): void {
    this.photoInput?.nativeElement.click();
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;

    if (!PHOTO_TYPES.includes(file.type)) {
      this.toast('Please choose a PNG, JPG or WEBP image.', true);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.toast('Photo must be 1 MB or smaller.', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => this.applyPhoto(String(reader.result));
    reader.readAsDataURL(file);
  }

  goToChangePassword(): void {
    this.router.navigateByUrl('/change-password');
  }

  removePhoto(): void {
    this.applyPhoto('');
  }

  /** Photos are saved immediately (no Save click), so the header avatar updates right away. */
  private applyPhoto(dataUrl: string): void {
    this.form.controls.avatarDataUrl.setValue(dataUrl); // stays pristine — not an unsaved edit
    this.account.updatePhoto(dataUrl);
    this.toast(dataUrl ? 'Profile photo updated' : 'Profile photo removed');
  }

  // ---- Save / discard --------------------------------------------------------

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving = true;
    this.account
      .saveProfile({
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        email: v.email.trim().toLowerCase(),
        mobileCode: v.mobileCode,
        mobile: v.mobile,
        avatarDataUrl: v.avatarDataUrl,
      })
      .subscribe((changes) => {
        this.saving = false;
        this.form.markAsPristine();
        if (this.profile) this.resetForm(this.profile);
        this.toast(changes.length ? 'Profile updated successfully' : 'No changes to save');
      });
  }

  onDiscard(): void {
    if (this.profile) this.resetForm(this.profile);
  }

  private resetForm(profile: UserProfile): void {
    this.form.reset({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      mobileCode: profile.mobileCode,
      mobile: profile.mobile,
      avatarDataUrl: profile.avatarDataUrl,
    });
  }

  // ---- Leave guard -----------------------------------------------------------

  confirmLeave(): Observable<boolean> {
    if (!this.form.dirty) return of(true);
    return this.confirm.confirm({
      title: 'Leave without saving?',
      message: 'You have unsaved changes to your profile. They will be lost.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: true,
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty) event.preventDefault();
  }

  private toast(message: string, error = false): void {
    this.snackBar.open(message, 'x', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: error ? 'app-snackbar--error' : ['app-snackbar--success', 'green-snackbar'],
    });
  }
}
