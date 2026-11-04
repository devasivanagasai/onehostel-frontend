import { Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  LOCATION_KINDS,
  LocationKind,
  TENANT_CATEGORY_ICONS,
  TENANT_COMPLAINT_CATEGORIES,
  TENANT_PRIORITIES,
  TITLE_MAX,
  TenantComplaintCategory,
  TenantComplaintView,
  TenantComplaintsService,
  TenantSuggestedPriority,
} from '../../../core/services/tenant-complaints.service';
import { TenantContextService } from '../../../core/services/tenant-context.service';
import {
  TENANT_ATTACHMENT_ACCEPT,
  TENANT_ATTACHMENT_MAX_COUNT,
  TenantAttachmentMeta,
  formatFileSize,
  pickAttachments,
} from '../../../core/models/tenant-support.models';

/** Text length after trimming; blank text counts as empty. */
export const trimmedLength = (min: number, max: number) => (c: AbstractControl): ValidationErrors | null => {
  const v = typeof c.value === 'string' ? c.value.trim() : '';
  if (!v) return { required: true };
  if (v.length < min) return { minlength: { requiredLength: min, actualLength: v.length } };
  if (v.length > max) return { maxlength: { requiredLength: max, actualLength: v.length } };
  return null;
};

@Component({
  selector: 'app-tenant-complaint-raise-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-complaint-raise-dialog.component.html',
  styleUrl: './tenant-complaints.component.scss',
})
export class TenantComplaintRaiseDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject<MatDialogRef<TenantComplaintRaiseDialogComponent, TenantComplaintView | undefined>>(MatDialogRef);
  private readonly service = inject(TenantComplaintsService);
  private readonly tenant = inject(TenantContextService);

  readonly categories = TENANT_COMPLAINT_CATEGORIES;
  readonly categoryIcons = TENANT_CATEGORY_ICONS;
  readonly priorities = TENANT_PRIORITIES;
  readonly locationKinds = LOCATION_KINDS;
  readonly titleMax = TITLE_MAX;
  readonly descriptionMax = DESCRIPTION_MAX;
  readonly descriptionMin = DESCRIPTION_MIN;
  readonly accept = TENANT_ATTACHMENT_ACCEPT;
  readonly maxFiles = TENANT_ATTACHMENT_MAX_COUNT;
  readonly formatFileSize = formatFileSize;

  readonly hasRoom = !!this.tenant.allocation;

  readonly form = this.fb.nonNullable.group({
    category: ['Plumbing' as TenantComplaintCategory, Validators.required],
    title: ['', trimmedLength(1, TITLE_MAX)],
    description: ['', trimmedLength(DESCRIPTION_MIN, DESCRIPTION_MAX)],
    locationKind: [(this.hasRoom ? 'My room' : 'Common area') as LocationKind, Validators.required],
    locationDetail: [''],
    priority: ['Medium' as TenantSuggestedPriority, Validators.required],
  });

  attachments: TenantAttachmentMeta[] = [];
  attachmentError = '';
  submitError = '';
  saving = false;
  /** Set after a successful submit: shows the confirmation with the complaint ID. */
  created?: TenantComplaintView;

  constructor() {
    this.syncLocation();
    this.form.controls.locationKind.valueChanges.subscribe(() => this.syncLocation());
  }

  get needsDetail(): boolean {
    return this.form.controls.locationKind.value !== 'My room';
  }

  invalid(name: 'category' | 'title' | 'description' | 'locationDetail'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  private syncLocation(): void {
    const c = this.form.controls.locationDetail;
    c.setValidators(this.needsDetail ? [trimmedLength(2, 80)] : []);
    c.updateValueAndValidity({ emitEvent: false });
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const { added, error } = pickAttachments(input.files, this.attachments);
    this.attachments = [...this.attachments, ...added];
    this.attachmentError = error;
    input.value = '';
  }

  removeAttachment(i: number): void {
    this.attachments = this.attachments.filter((_, idx) => idx !== i);
    this.attachmentError = '';
  }

  submit(): void {
    this.submitError = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving = true;
    try {
      this.created = this.service.raise({ ...this.form.getRawValue(), attachments: this.attachments });
    } catch (e) {
      this.submitError = e instanceof Error ? e.message : 'Could not submit your complaint. Please try again.';
    } finally {
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close(this.created);
  }
}
