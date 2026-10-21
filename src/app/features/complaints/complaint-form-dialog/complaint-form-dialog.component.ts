import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { MatIconModule } from '@angular/material/icon';
import { ResidentsService } from '../../residents/residents.service';
import { residentFullName } from '../../residents/residents.models';
import { NewComplaintInput } from '../complaints.service';
import {
  ATTACHMENT_MAX_COUNT,
  CATEGORY_DEFAULT_STAFF,
  CATEGORY_ICONS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  ComplaintAttachment,
  ComplaintCategory,
  STAFF,
} from '../complaints.models';
import { isImage, readAttachments } from '../attachments';

/** Logs a complaint on a resident's behalf (residents normally use the Resident App). */
@Component({
  selector: 'app-complaint-form-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './complaint-form-dialog.component.html',
  styleUrl: './complaint-form-dialog.component.scss',
})
export class ComplaintFormDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly residentsService = inject(ResidentsService);
  private readonly dialogRef = inject(MatDialogRef<ComplaintFormDialogComponent, NewComplaintInput>);

  readonly categories = COMPLAINT_CATEGORIES;
  readonly priorities = COMPLAINT_PRIORITIES;
  readonly staff = STAFF;
  readonly maxFiles = ATTACHMENT_MAX_COUNT;
  readonly today = new Date().toISOString().slice(0, 10);
  readonly isImage = isImage;
  readonly categoryIcons = CATEGORY_ICONS;

  /** Current residents, with their room / bed for context. */
  readonly residents = this.residentsService.residents
    .filter((r) => !r.deactivatedAt && r.status !== 'Checked Out')
    .map((r) => {
      const alloc = this.residentsService.allocationFor(r.residentId);
      return { id: r.residentId, label: `${residentFullName(r)} · ${alloc ? this.residentsService.describe(alloc) : 'No bed'}` };
    });

  readonly form = this.fb.nonNullable.group({
    residentId: ['', Validators.required],
    category: ['Plumbing' as ComplaintCategory, Validators.required],
    title: ['', [Validators.required, Validators.maxLength(80)]],
    description: ['', [Validators.required, Validators.maxLength(1000)]],
    priority: ['Medium' as NewComplaintInput['priority'], Validators.required],
    targetDate: [''],
    assignedTo: [''],
  });

  attachments: ComplaintAttachment[] = [];
  attachmentError = '';
  /** Assignee suggestion follows the category until the user picks someone themselves. */
  private assigneeTouched = false;

  constructor() {
    this.form.controls.category.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onCategoryChange());
  }

  onCategoryChange(): void {
    if (!this.assigneeTouched && this.form.controls.assignedTo.value) {
      this.form.patchValue({ assignedTo: CATEGORY_DEFAULT_STAFF[this.form.controls.category.value] });
    }
  }

  suggestAssignee(): void {
    this.form.patchValue({ assignedTo: CATEGORY_DEFAULT_STAFF[this.form.controls.category.value] });
  }

  onAssigneePicked(): void {
    this.assigneeTouched = true;
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const { added, error } = await readAttachments(input.files, this.attachments.length);
    input.value = '';
    this.attachments = [...this.attachments, ...added];
    this.attachmentError = error;
  }

  removeAttachment(id: string): void {
    this.attachments = this.attachments.filter((a) => a.id !== id);
  }

  hasError(name: keyof typeof this.form.controls, error: string): boolean {
    const c = this.form.controls[name];
    return c.hasError(error) && (c.touched || c.dirty);
  }

  /** Field shows its error state once touched. */
  invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  get targetInPast(): boolean {
    const t = this.form.controls.targetDate.value;
    return !!t && t < this.today;
  }

  submit(): void {
    if (this.form.invalid || this.targetInPast) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.dialogRef.close({
      ...v,
      title: v.title.trim(),
      description: v.description.trim(),
      targetDate: v.targetDate || undefined,
      assignedTo: v.assignedTo || undefined,
      attachments: this.attachments,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
