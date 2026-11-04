import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { TenantSupportService } from '../../../core/services/tenant-support.service';
import { trimmedLength } from '../complaints/tenant-complaint-raise-dialog.component';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  SUBJECT_MAX,
  SUBJECT_MIN,
  SUPPORT_TOPICS,
  SupportTicket,
  SupportTopic,
  TENANT_ATTACHMENT_ACCEPT,
  TENANT_ATTACHMENT_MAX_COUNT,
  TenantAttachmentMeta,
  formatFileSize,
  pickAttachments,
} from '../../../core/models/tenant-support.models';

@Component({
  selector: 'app-tenant-support-new-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './tenant-support-new-dialog.component.html',
  styleUrl: './tenant-support.component.scss',
})
export class TenantSupportNewDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<TenantSupportNewDialogComponent, SupportTicket | undefined>);
  private readonly service = inject(TenantSupportService);

  readonly topics = SUPPORT_TOPICS;
  readonly subjectMax = SUBJECT_MAX;
  readonly subjectMin = SUBJECT_MIN;
  readonly descriptionMax = DESCRIPTION_MAX;
  readonly descriptionMin = DESCRIPTION_MIN;
  readonly accept = TENANT_ATTACHMENT_ACCEPT;
  readonly maxFiles = TENANT_ATTACHMENT_MAX_COUNT;
  readonly formatFileSize = formatFileSize;

  readonly form = this.fb.nonNullable.group({
    topic: ['Other' as SupportTopic, Validators.required],
    subject: ['', trimmedLength(SUBJECT_MIN, SUBJECT_MAX)],
    description: ['', trimmedLength(DESCRIPTION_MIN, DESCRIPTION_MAX)],
  });

  attachments: TenantAttachmentMeta[] = [];
  attachmentError = '';
  submitError = '';
  saving = false;
  created?: SupportTicket;

  invalid(name: 'subject' | 'description'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
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
      this.created = this.service.create({ ...this.form.getRawValue(), attachments: this.attachments });
    } catch (e) {
      this.submitError = e instanceof Error ? e.message : 'Could not send your request. Please try again.';
    } finally {
      this.saving = false;
    }
  }

  close(): void {
    this.dialogRef.close(this.created);
  }
}
