import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AcademicYearsService } from '../../../core/services/academic-years.service';
import { AcademicYear, AcademicYearInput, MAX_ELIGIBILITY_CHIPS, MIN_DURATION_DAYS, REASON_MAX, daysBetween } from '../../../core/models/academic-years.models';

export interface AcademicYearFormData {
  /** Present when editing. */
  id?: string;
  /** Authorized correction of a Completed year: needs a reason. */
  correction?: boolean;
}

/** Create or edit an academic year. A new year starts as Draft; status moves from the detail view. */
@Component({
  selector: 'app-academic-year-form-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './academic-year-form-dialog.component.html',
  styleUrl: './academic-year-form-dialog.component.scss',
})
export class AcademicYearFormDialogComponent {
  private readonly data = inject<AcademicYearFormData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(MatDialogRef<AcademicYearFormDialogComponent, AcademicYear>);
  readonly service = inject(AcademicYearsService);

  readonly existing: AcademicYear | undefined = this.data?.id ? this.service.byId(this.data.id) : undefined;
  readonly isEdit = !!this.existing;
  readonly correction = !!this.data?.correction;
  readonly maxChips = MAX_ELIGIBILITY_CHIPS;
  readonly reasonMax = REASON_MAX;
  readonly minDays = MIN_DURATION_DAYS;

  name = this.existing?.name ?? '';
  startDate = this.existing?.startDate ?? '';
  endDate = this.existing?.endDate ?? '';
  block = this.existing?.block ?? '';
  eligibility: string[] = [...(this.existing?.eligibility ?? [])];
  chipDraft = '';
  winStart = this.existing?.allocationWindow?.start ?? '';
  winEnd = this.existing?.allocationWindow?.end ?? '';
  reason = '';

  attempted = false;
  saving = false;
  saveError = '';

  get input(): AcademicYearInput {
    return {
      name: this.name,
      startDate: this.startDate,
      endDate: this.endDate,
      block: this.block,
      eligibility: this.eligibility,
      allocationWindow: this.winStart || this.winEnd ? { start: this.winStart, end: this.winEnd } : null,
    };
  }

  /** The first rule the service would refuse, once Save was tried. */
  get problem(): string {
    return this.attempted ? this.service.validate(this.input, this.existing?.id) : '';
  }

  get nameError(): string {
    return this.attempted && !this.name.trim() ? 'Academic year name is required' : '';
  }

  get startError(): string {
    return this.attempted && !this.startDate ? 'Start date is required' : '';
  }

  get endError(): string {
    if (!this.attempted) return '';
    if (!this.endDate) return 'End date is required';
    return this.startDate && this.endDate <= this.startDate ? 'End date must be after the start date' : '';
  }

  get reasonError(): string {
    return this.attempted && this.correction && !this.reason.trim() ? 'A reason is required for a correction' : '';
  }

  /** Live "x days" under the dates. */
  get duration(): string {
    if (!this.startDate || !this.endDate || this.endDate <= this.startDate) return '';
    const d = daysBetween(this.startDate, this.endDate) + 1;
    return d < this.minDays ? '' : `${d} days`;
  }

  addChip(): void {
    const v = this.chipDraft.trim();
    if (!v) return;
    if (this.eligibility.length >= this.maxChips) {
      this.saveError = `At most ${this.maxChips} eligibility labels.`;
      return;
    }
    if (!this.eligibility.some((e) => e.toLowerCase() === v.toLowerCase())) this.eligibility = [...this.eligibility, v];
    this.chipDraft = '';
    this.saveError = '';
  }

  removeChip(c: string): void {
    this.eligibility = this.eligibility.filter((e) => e !== c);
  }

  submit(): void {
    this.attempted = true;
    if (this.nameError || this.startError || this.endError || this.reasonError) return;
    if (this.service.validate(this.input, this.existing?.id)) return;
    this.saving = true;
    this.saveError = '';
    try {
      const saved = this.existing
        ? this.correction
          ? this.service.authorizedCorrection(this.existing.id, this.input, this.reason)
          : this.service.update(this.existing.id, this.input)
        : this.service.create(this.input);
      this.dialogRef.close(saved);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the academic year.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
