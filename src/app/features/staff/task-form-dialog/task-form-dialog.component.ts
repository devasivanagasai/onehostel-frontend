import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { TASK_PRIORITIES, Staff, Task, TaskErrors, TaskInput, TaskPriority } from '../../../core/models/staff.models';
import { StaffService } from '../../../core/services/staff.service';
import { localDateIso } from '../../../shared/utils/local-date';

export interface TaskFormData {
  /** Present when editing. */
  id?: string;
  /** Pre-selected assignee for a new task. */
  assigneeId?: string;
}

/** Create / edit a task. Closes with the saved task, or nothing when cancelled. */
@Component({
  selector: 'app-task-form-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './task-form-dialog.component.html',
  styleUrl: '../staff-form-dialog/staff-form-dialog.component.scss',
})
export class TaskFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<TaskFormDialogComponent, Task>);
  private readonly data = inject<TaskFormData | null>(MAT_DIALOG_DATA, { optional: true });
  readonly service = inject(StaffService);

  readonly priorities = TASK_PRIORITIES;
  readonly editing: Task | undefined = this.data?.id ? this.service.taskById(this.data.id) : undefined;
  /** New tasks can't be due in the past. */
  readonly today = localDateIso();

  /** Active staff only (an edited task also keeps its current assignee in the list). */
  readonly assignees: Staff[] = (() => {
    const list = this.service.activeStaff;
    const cur = this.editing ? this.service.byId(this.editing.assigneeId) : undefined;
    return cur && !list.some((s) => s.id === cur.id) ? [cur, ...list] : list;
  })();

  readonly form = inject(FormBuilder).nonNullable.group({
    title: [this.editing?.title ?? ''],
    description: [this.editing?.description ?? ''],
    dueDate: [this.editing?.dueDate ?? ''],
    priority: [(this.editing?.priority ?? 'Medium') as TaskPriority],
    assigneeId: [this.editing?.assigneeId ?? this.data?.assigneeId ?? ''],
  });

  submitted = false;
  saving = false;
  saveError = '';

  get errors(): TaskErrors {
    return this.submitted ? this.service.validateTask(this.input(), this.editing) : {};
  }

  private input(): TaskInput {
    return this.form.getRawValue();
  }

  save(): void {
    this.submitted = true;
    if (Object.keys(this.errors).length) return;
    this.saving = true;
    this.saveError = '';
    try {
      const input = this.input();
      this.dialogRef.close(this.editing ? this.service.updateTask(this.editing.id, input) : this.service.createTask(input));
    } catch (err: any) {
      this.saveError = err?.message ?? 'Could not save the task.';
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
