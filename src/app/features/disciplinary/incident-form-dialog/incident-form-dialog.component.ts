import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { DisciplinaryService } from '../../../core/services/disciplinary.service';
import {
  ACCESS_CLASSIFICATIONS,
  ACTION_MAX,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  EVIDENCE_EXTENSIONS,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MAX_COUNT,
  EvidenceFile,
  INCIDENT_CATEGORIES,
  Incident,
  NOTE_MIN,
  evidenceErrors,
  fileSizeLabel,
  localMinute,
} from '../../../core/models/disciplinary.models';

export interface IncidentFormData {
  /** create: new incident; edit: open incident; correct: authorized correction of a closed one. */
  mode: 'create' | 'edit' | 'correct';
  id?: string;
}

/** Report / edit / correct an incident. Closes with the saved incident. */
@Component({
  selector: 'app-incident-form-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './incident-form-dialog.component.html',
  styleUrl: './incident-form-dialog.component.scss',
})
export class IncidentFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<IncidentFormDialogComponent, Incident>);
  private readonly data = inject<IncidentFormData>(MAT_DIALOG_DATA);
  readonly service = inject(DisciplinaryService);

  readonly mode = this.data.mode;
  readonly existing: Incident | undefined = this.data.id ? this.service.byId(this.data.id) : undefined;
  readonly residents = this.service.selectableResidents;
  readonly categories = INCIDENT_CATEGORIES;
  readonly classifications = ACCESS_CLASSIFICATIONS;
  readonly descriptionMin = DESCRIPTION_MIN;
  readonly descriptionMax = DESCRIPTION_MAX;
  readonly actionMax = ACTION_MAX;
  readonly maxCount = EVIDENCE_MAX_COUNT;
  readonly accept = EVIDENCE_EXTENSIONS.map((e) => '.' + e).join(',');
  readonly maxMb = EVIDENCE_MAX_BYTES / 1024 / 1024;
  readonly sizeLabel = fileSizeLabel;
  /** Latest allowed incident time (the picker blocks the future). */
  readonly maxDateTime = localMinute();

  readonly form = inject(FormBuilder).nonNullable.group({
    residentId: [this.existing?.residentId ?? '', Validators.required],
    occurredAt: [this.existing?.occurredAt ?? '', Validators.required],
    category: [this.existing?.category ?? '', Validators.required],
    classification: [this.existing?.classification ?? '', Validators.required],
    description: [this.existing?.description ?? ''],
    actionTaken: [this.existing?.actionTaken ?? ''],
    closingNote: [this.existing?.closingNote ?? ''],
    reason: [''],
  });

  evidence: EvidenceFile[] = [...(this.existing?.evidence ?? [])];
  fileErrors: string[] = [];
  submitted = false;
  saving = false;
  saveError = '';

  get title(): string {
    return this.mode === 'create' ? 'Report Incident' : this.mode === 'edit' ? 'Edit Incident' : 'Authorized Correction';
  }

  get subtitle(): string {
    if (this.mode === 'create') return 'Record a factual account. Access is restricted and audited.';
    if (this.mode === 'edit') return `${this.existing?.id} · changes are recorded on the incident history.`;
    return `${this.existing?.id} is closed. A correction needs a reason and is audited with before and after values.`;
  }

  get hasClosingNote(): boolean {
    return this.existing?.closingNote !== undefined;
  }

  private get descLength(): number {
    return this.form.controls.description.value.trim().length;
  }

  get descCount(): number {
    return this.form.controls.description.value.length;
  }

  get descriptionError(): string {
    if (!this.submitted) return '';
    if (!this.descLength) return 'Describe the incident factually';
    if (this.descLength < DESCRIPTION_MIN) return `At least ${DESCRIPTION_MIN} characters (${this.descLength} entered)`;
    return this.descLength > DESCRIPTION_MAX ? `At most ${DESCRIPTION_MAX} characters` : '';
  }

  get dateError(): string {
    const v = this.form.controls.occurredAt.value;
    if (!this.submitted && !v) return '';
    if (!v) return 'Enter when the incident happened';
    return v > localMinute() ? 'The incident time cannot be in the future' : '';
  }

  get reasonError(): string {
    if (this.mode !== 'correct' || !this.submitted) return '';
    return this.form.controls.reason.value.trim().length < NOTE_MIN ? `Give a reason of at least ${NOTE_MIN} characters` : '';
  }

  /** Message when a required select is still empty after a submit attempt. */
  missing(name: 'residentId' | 'category' | 'classification', message: string): string {
    return this.submitted && !this.form.controls[name].value ? message : '';
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const errors: string[] = [];
    for (const file of Array.from(input.files ?? [])) {
      const f: EvidenceFile = { name: file.name, size: file.size, type: file.type };
      const problems = evidenceErrors([f]);
      if (problems.length) errors.push(problems[0]);
      else if (this.evidence.length >= EVIDENCE_MAX_COUNT) errors.push(`"${f.name}" was not added: at most ${EVIDENCE_MAX_COUNT} files are allowed.`);
      else if (this.evidence.some((e) => e.name === f.name && e.size === f.size)) errors.push(`"${f.name}" is already attached.`);
      else this.evidence = [...this.evidence, f];
    }
    this.fileErrors = errors;
    input.value = ''; // only names are kept; the same file can be picked again after removal
  }

  removeFile(i: number): void {
    this.evidence = this.evidence.filter((_, idx) => idx !== i);
    this.fileErrors = [];
  }

  save(): void {
    this.submitted = true;
    const v = this.form.getRawValue();
    if (this.form.invalid || this.descriptionError || this.dateError || this.reasonError) return;
    this.saving = true;
    this.saveError = '';
    const patch = {
      residentId: v.residentId,
      occurredAt: v.occurredAt,
      category: v.category as Incident['category'],
      classification: v.classification as Incident['classification'],
      description: v.description,
      actionTaken: v.actionTaken,
      evidence: this.evidence,
    };
    try {
      const saved =
        this.mode === 'create'
          ? this.service.create(patch)
          : this.mode === 'edit'
            ? this.service.update(this.existing!.id, patch)
            : this.service.correct(this.existing!.id, this.hasClosingNote ? { ...patch, closingNote: v.closingNote } : patch, v.reason);
      this.dialogRef.close(saved);
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the incident.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
