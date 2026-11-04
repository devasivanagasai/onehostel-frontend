import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../core/services/app-format.service';
import { AcademicYearsService } from '../../core/services/academic-years.service';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { ConfirmDialogData } from '../../shared/components/confirm-dialog/app-confirm-dialog.component';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ACADEMIC_YEAR_STATUSES, ACADEMIC_YEAR_TONES, AcademicYear, AcademicYearStatus } from '../../core/models/academic-years.models';
import { AcademicYearFormData, AcademicYearFormDialogComponent } from './academic-year-form-dialog/academic-year-form-dialog.component';
import { AcademicYearViewAction, AcademicYearViewData, AcademicYearViewDialogComponent } from './academic-year-view-dialog/academic-year-view-dialog.component';

interface YearFilters {
  search: string;
  status: string;
}

const DEFAULT_FILTERS: YearFilters = { search: '', status: 'All' };

const NO_RESIDENT_CHANGE = 'This does NOT check out, move or reallocate any resident. Bed allocations stay exactly as they are.';

/** Academic Year Management for College Hostels. Other hostel types see an info state. */
@Component({
  selector: 'app-academic-years',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatDialogModule, MatTooltipModule, MatSnackBarModule, MatTableModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './academic-years.component.html',
  styleUrl: './academic-years.component.scss',
})
export class AcademicYearsComponent implements OnInit, OnDestroy {
  readonly service = inject(AcademicYearsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly columns = ['year', 'period', 'block', 'status', 'residents', 'actions'];
  readonly statuses = ACADEMIC_YEAR_STATUSES;
  readonly tones = ACADEMIC_YEAR_TONES;

  filters: YearFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;
  loading = true;
  private loadTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadTimer = setTimeout(() => (this.loading = false), 250);
  }

  ngOnDestroy(): void {
    clearTimeout(this.loadTimer);
  }

  get isCollege(): boolean {
    return this.service.isCollegeHostel;
  }

  get active(): AcademicYear | undefined {
    return this.service.activeYear();
  }

  /** Newest start date first. */
  get filtered(): AcademicYear[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.service.years
      .filter((y) => {
        if (q && ![y.id, y.name, y.block, y.eligibility.join(' ')].join(' ').toLowerCase().includes(q)) return false;
        return f.status === 'All' || y.status === f.status;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  get hasFilters(): boolean {
    return !!this.filters.search.trim() || this.filters.status !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): AcademicYear[] {
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

  // ---- View helpers -----------------------------------------------------------

  ready(y: AcademicYear): boolean {
    return this.service.isReadyToActivate(y);
  }

  tone(y: AcademicYear): string {
    return this.tones[y.status];
  }

  /** The forward step offered inline (never Archive; that stays in the detail view). */
  nextStep(y: AcademicYear): AcademicYearStatus | undefined {
    return this.service.nextStatuses(y).find((s) => s !== 'Archived');
  }

  // ---- Actions ----------------------------------------------------------------

  openAdd(): void {
    this.openForm({});
  }

  openEdit(y: AcademicYear, correction = false): void {
    this.openForm({ id: y.id, correction });
  }

  private openForm(data: AcademicYearFormData): void {
    this.dialog
      .open<AcademicYearFormDialogComponent, AcademicYearFormData, AcademicYear>(AcademicYearFormDialogComponent, { width: '720px', maxWidth: '94vw', autoFocus: false, disableClose: true, data })
      .afterClosed()
      .subscribe((y) => y && this.toast(data.correction ? `${y.name} corrected.` : data.id ? `${y.name} updated.` : `${y.name} created as a Draft.`, y));
  }

  openView(y: AcademicYear): void {
    this.dialog
      .open<AcademicYearViewDialogComponent, AcademicYearViewData, AcademicYearViewAction>(AcademicYearViewDialogComponent, { width: '880px', maxWidth: '94vw', autoFocus: false, data: { id: y.id } })
      .afterClosed()
      .subscribe((action) => action && this.run(y, action));
  }

  run(y: AcademicYear, action: AcademicYearViewAction): void {
    if (action === 'edit') this.openEdit(y);
    else if (action === 'correct') this.openEdit(y, true);
    else this.changeStatus(y, action);
  }

  /** Confirms first (Activate / Complete say plainly that no resident is touched), then moves the year forward. */
  changeStatus(y: AcademicYear, next: AcademicYearStatus): void {
    this.confirmDialog.confirm(this.confirmCopy(y, next)).subscribe((ok) => {
      if (!ok) return;
      try {
        const updated = this.service.changeStatus(y.id, next);
        this.toast(`${updated.name} is now ${updated.status}.`, updated);
      } catch (err: any) {
        this.snackBar.open(err?.message ?? 'Could not change the status.', 'Close', { duration: 5000 });
      }
    });
  }

  private confirmCopy(y: AcademicYear, next: AcademicYearStatus): ConfirmDialogData {
    switch (next) {
      case 'Active':
        return { title: `Activate ${y.name}?`, message: `${y.name} becomes the Active academic year for ${y.block || 'the whole hostel'}. ${NO_RESIDENT_CHANGE}`, confirmLabel: 'Activate', tone: 'success', icon: 'play_circle', cancelLabel: 'Cancel' };
      case 'Completed':
        return { title: `Mark ${y.name} as Completed?`, message: `The year becomes read-only, except authorized corrections. ${NO_RESIDENT_CHANGE}`, confirmLabel: 'Mark Completed', tone: 'warning', icon: 'task_alt', cancelLabel: 'Cancel' };
      case 'Archived':
        return {
          title: y.status === 'Draft' ? `Cancel ${y.name}?` : `Archive ${y.name}?`,
          message: y.status === 'Draft' ? 'The draft is archived and becomes read-only.' : 'Archived years are fully read-only and cannot be changed again.',
          confirmLabel: y.status === 'Draft' ? 'Cancel Year' : 'Archive',
          danger: true,
          cancelLabel: 'Keep',
        };
      default:
        return { title: `Mark ${y.name} as ${next}?`, message: 'It is published as an upcoming year. Nothing changes for residents.', confirmLabel: `Mark ${next}`, tone: 'primary', cancelLabel: 'Cancel' };
    }
  }

  private toast(text: string, y: AcademicYear): void {
    this.snackBar.open(text, 'View', { duration: 4500 }).onAction().subscribe(() => this.openView(y));
  }
}
