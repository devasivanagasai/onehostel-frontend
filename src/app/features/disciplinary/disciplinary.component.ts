import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../core/services/app-format.service';
import { DisciplinaryService } from '../../core/services/disciplinary.service';
import {
  ACCESS_CLASSIFICATIONS,
  INCIDENT_CATEGORIES,
  Incident,
  RETENTION_NOTE,
  REVIEW_STATUSES,
  REVIEW_TONES,
} from '../../core/models/disciplinary.models';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { IncidentFormDialogComponent, IncidentFormData } from './incident-form-dialog/incident-form-dialog.component';
import { IncidentViewAction, IncidentViewDialogComponent } from './incident-view-dialog/incident-view-dialog.component';

interface IncidentFilters {
  search: string;
  status: string;
  category: string;
  classification: string;
  from: string;
  to: string;
}

const DEFAULT_FILTERS: IncidentFilters = { search: '', status: 'All', category: 'All', classification: 'All', from: '', to: '' };

/**
 * Disciplinary Records (Section 6.5). Hostel Owner only. The list shows resident name, category,
 * status and date; descriptions and evidence are only in the detail dialog.
 */
@Component({
  selector: 'app-disciplinary',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatDialogModule, MatTooltipModule, MatSnackBarModule, MatTableModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './disciplinary.component.html',
  styleUrl: './disciplinary.component.scss',
})
export class DisciplinaryComponent {
  readonly service = inject(DisciplinaryService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['id', 'resident', 'category', 'occurred', 'classification', 'status', 'actions'];
  readonly statuses = REVIEW_STATUSES;
  readonly categories = INCIDENT_CATEGORIES;
  readonly classifications = ACCESS_CLASSIFICATIONS;
  readonly tones = REVIEW_TONES;
  readonly retention = RETENTION_NOTE;

  filters: IncidentFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;

  get allowed(): boolean {
    return this.service.canAccess;
  }

  /** From later than To: shown as an error; the other filters are left alone. */
  get rangeError(): string {
    const { from, to } = this.filters;
    return from && to && to < from ? 'The end date is before the start date.' : '';
  }

  get filtered(): Incident[] {
    if (!this.allowed) return [];
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    const rangeOk = !this.rangeError;
    return this.service.incidents
      .filter((i) => {
        if (f.status !== 'All' && i.status !== f.status) return false;
        if (f.category !== 'All' && i.category !== f.category) return false;
        if (f.classification !== 'All' && i.classification !== f.classification) return false;
        const day = i.occurredAt.slice(0, 10);
        if (rangeOk && f.from && day < f.from) return false;
        if (rangeOk && f.to && day > f.to) return false;
        if (q && ![i.id, this.service.residentName(i), i.residentId, i.category].join(' ').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  tone(i: Incident): string {
    return REVIEW_TONES[i.status];
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.category !== 'All' || f.classification !== 'All' || !!f.from || !!f.to;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Incident[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Actions ----------------------------------------------------------------

  openReport(): void {
    this.openForm({ mode: 'create' }, (i) => this.snackBar.open(`${i.id} recorded.`, 'Close', { duration: 3500 }));
  }

  openView(i: Incident): void {
    this.dialog
      .open<IncidentViewDialogComponent, { id: string }, IncidentViewAction>(IncidentViewDialogComponent, { width: '760px', maxWidth: '94vw', autoFocus: false, data: { id: i.id } })
      .afterClosed()
      .subscribe((action) => {
        if (action === 'edit') this.openEdit(i);
        else if (action === 'correct') this.openForm({ mode: 'correct', id: i.id }, (s) => this.snackBar.open(`Correction to ${s.id} recorded.`, 'Close', { duration: 3500 }));
      });
  }

  openEdit(i: Incident): void {
    this.openForm({ mode: 'edit', id: i.id }, (s) => this.snackBar.open(`${s.id} updated.`, 'Close', { duration: 3500 }));
  }

  private openForm(data: IncidentFormData, done: (i: Incident) => void): void {
    this.dialog
      .open<IncidentFormDialogComponent, IncidentFormData, Incident>(IncidentFormDialogComponent, { width: '720px', maxWidth: '94vw', autoFocus: false, disableClose: true, data })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) done(saved);
      });
  }
}
