import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AcademicYearsService } from '../../../core/services/academic-years.service';
import { residentFullName } from '../../../core/models/residents.models';
import { ACADEMIC_YEAR_TONES, AcademicYear, AcademicYearStatus, daysBetween } from '../../../core/models/academic-years.models';

/** What the owner chose in the detail view; the list opens the matching dialog or confirmation. */
export type AcademicYearViewAction = 'edit' | 'correct' | AcademicYearStatus;

export interface AcademicYearViewData {
  id: string;
}

type AssignFilter = 'All' | 'Assigned' | 'Unassigned';

const STATUS_ICONS: Record<AcademicYearStatus, string> = {
  Upcoming: 'event_upcoming',
  Active: 'play_circle',
  Completed: 'task_alt',
  Archived: 'inventory_2',
  Draft: 'edit_note',
};

/** Academic year detail: dates, rules, status actions, and who is assigned (assigning never touches beds). */
@Component({
  selector: 'app-academic-year-view-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './academic-year-view-dialog.component.html',
  styleUrl: './academic-year-view-dialog.component.scss',
})
export class AcademicYearViewDialogComponent {
  private readonly data = inject<AcademicYearViewData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AcademicYearViewDialogComponent, AcademicYearViewAction>);
  readonly service = inject(AcademicYearsService);
  readonly fmt = inject(AppFormatService);
  readonly tones = ACADEMIC_YEAR_TONES;
  readonly icons = STATUS_ICONS;
  readonly filters: AssignFilter[] = ['All', 'Assigned', 'Unassigned'];

  search = '';
  filter: AssignFilter = 'All';
  error = '';

  get y(): AcademicYear {
    return this.service.byId(this.data.id)!;
  }

  get ready(): boolean {
    return this.service.isReadyToActivate(this.y);
  }

  get days(): number {
    return daysBetween(this.y.startDate, this.y.endDate) + 1;
  }

  get editable(): boolean {
    return this.service.canEdit(this.y);
  }

  get canAssign(): boolean {
    return this.editable;
  }

  get next(): AcademicYearStatus[] {
    return this.service.nextStatuses(this.y);
  }

  get history() {
    return [...this.y.history].reverse();
  }

  /** Residents that can be assigned, plus anyone already assigned who has since left. */
  get rows() {
    const y = this.y;
    const q = this.search.trim().toLowerCase();
    const ids = new Set([...this.service.assignableResidents.map((r) => r.residentId), ...y.residentIds]);
    return [...ids]
      .map((id) => this.service.resident(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .filter((r) => !q || `${residentFullName(r)} ${r.residentId} ${r.collegeOrCompany ?? ''}`.toLowerCase().includes(q))
      .filter((r) => this.filter === 'All' || (this.filter === 'Assigned') === y.residentIds.includes(r.residentId))
      .map((r) => ({
        id: r.residentId,
        name: residentFullName(r),
        group: r.collegeOrCompany || r.residentType,
        status: r.status,
        location: this.service.location(r.residentId),
        assigned: y.residentIds.includes(r.residentId),
        elsewhere: this.service.assignedElsewhere(r.residentId, y),
        matches: this.service.matchesEligibility(r, y),
        blocked: this.service.assignProblem(y, r.residentId),
      }));
  }

  get eligibleCount(): number {
    return this.service.assignableResidents.length;
  }

  toggle(row: { id: string; assigned: boolean }): void {
    this.error = '';
    try {
      if (row.assigned) this.service.unassignResident(this.y.id, row.id);
      else this.service.assignResident(this.y.id, row.id);
    } catch (err: any) {
      this.error = err?.message ?? 'Could not update the assignment.';
    }
  }

  act(a: AcademicYearViewAction): void {
    this.dialogRef.close(a);
  }

  close(): void {
    this.dialogRef.close();
  }
}
