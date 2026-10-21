import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppFormatService } from '../../core/services/app-format.service';
import {
  HostelSettingsPermissions,
  INDIAN_STATES,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  NameChangeRequest,
} from './hostel-settings.models';

/** Hostel Profile: logo, name (approval-gated), read-only type, address and contact. */
@Component({
  selector: 'app-hs-profile-section',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatTooltipModule, AppButtonComponent],
  templateUrl: './profile-section.component.html',
  styleUrl: './profile-section.component.scss',
})
export class ProfileSectionComponent {
  private readonly snackBar = inject(MatSnackBar);
  readonly fmt = inject(AppFormatService);

  @Input({ required: true }) group!: FormGroup;
  @Input({ required: true }) hostelType = '';
  @Input({ required: true }) currentName = '';
  @Input() pending: NameChangeRequest | null = null;
  @Input({ required: true }) permissions!: HostelSettingsPermissions;
  @Output() withdraw = new EventEmitter<void>();

  readonly states = INDIAN_STATES;
  readonly logoAccept = LOGO_TYPES.join(',');

  get logo(): string {
    return this.group.get('logoDataUrl')!.value;
  }

  get logoName(): string {
    return this.group.get('logoFileName')!.value;
  }

  get initials(): string {
    return this.currentName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  /** True once the owner has typed a different name (it will go for approval on save). */
  get nameChanged(): boolean {
    const v = (this.group.get('hostelName')!.value as string).trim();
    return !this.pending && !!v && v !== this.currentName;
  }

  show(name: string, error?: string): boolean {
    const c = this.group.get(name);
    if (!c || !(c.touched || c.dirty)) return false;
    return error ? c.hasError(error) : c.invalid;
  }

  onLogoPicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again still fires (change)
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      this.snackBar.open('Logo must be a JPG, PNG, WebP or SVG image.', 'OK', { duration: 3500 });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      this.snackBar.open('Logo must be 2 MB or smaller.', 'OK', { duration: 3500 });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.setLogo(String(reader.result), file.name);
    reader.readAsDataURL(file);
  }

  removeLogo(): void {
    this.setLogo('', '');
  }

  private setLogo(dataUrl: string, fileName: string): void {
    this.group.patchValue({ logoDataUrl: dataUrl, logoFileName: fileName });
    this.group.markAsDirty();
  }
}
