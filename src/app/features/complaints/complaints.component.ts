import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { map } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ComplaintsService, NewComplaintInput } from './complaints.service';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  Complaint,
  ComplaintPriority,
  STAFF,
  STATUS_TONES,
  isActive,
  staffById,
} from './complaints.models';
import { ComplaintFormDialogComponent } from './complaint-form-dialog/complaint-form-dialog.component';
import { ComplaintViewDialogComponent, ComplaintViewDialogData } from './complaint-view-dialog/complaint-view-dialog.component';

const PRIORITY_RANK: Record<ComplaintPriority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const AVATAR_TONES = ['blue', 'purple', 'green', 'amber'] as const;
/** Days shown in each KPI sparkline. */
const TREND_DAYS = 14;

interface ComplaintFilters {
  search: string;
  status: string;
  category: string;
  priority: string;
  assignee: string;
}

/** 'smart' = active work first (urgent → low, overdue first), then resolved, then closed. */
type SortKey = 'smart' | 'created' | 'target';

interface Kpi {
  key: string;
  label: string;
  sub?: string;
  value: string | number;
  icon: string;
  tone: 'teal' | 'blue' | 'red' | 'amber' | 'green';
  trend: { line: string; area: string };
}

const DEFAULT_FILTERS: ComplaintFilters = { search: '', status: 'All', category: 'All', priority: 'All', assignee: 'All' };

const localDay = (iso: string): string => iso.slice(0, 10);

@Component({
  selector: 'app-complaints',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatTableModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './complaints.component.html',
  styleUrl: './complaints.component.scss',
})
export class ComplaintsComponent {
  readonly complaints = inject(ComplaintsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['complaint', 'resident', 'issue', 'priority', 'assignee', 'target', 'status', 'actions'];

  readonly statusOptions = [
    { value: 'All', label: 'All Status' },
    { value: 'Active', label: 'Active (not resolved)' },
    ...COMPLAINT_STATUSES.map((s) => ({ value: s, label: s })),
    { value: 'Overdue', label: 'Overdue' },
  ];
  readonly categories = COMPLAINT_CATEGORIES;
  readonly priorities = COMPLAINT_PRIORITIES;
  readonly staff = STAFF;

  filters: ComplaintFilters = { ...DEFAULT_FILTERS };
  sortKey: SortKey = 'smart';
  sortDir: 'asc' | 'desc' = 'desc';
  pageSize = 10;
  currentPage = 0;

  /** KPI cards with a 14-day trend built from the complaint history. */
  readonly kpis$ = this.complaints.stats$.pipe(
    map((s): Kpi[] => {
      const list = this.complaints.complaints;
      const days = this.lastDays(TREND_DAYS);
      // 3-day rolling total, so sparse daily counts read as a trend rather than spikes
      const perDay = (dates: string[]) =>
        days.map((_, i) => days.slice(Math.max(0, i - 2), i + 1).reduce((n, d) => n + dates.filter((x) => localDay(x) === d).length, 0));
      const eventsOf = (pred: (text: string, type: string) => boolean) =>
        list.flatMap((c) => c.history.filter((h) => pred(h.text, h.type)).map((h) => h.at));

      const avg = s.avgResolutionHours;
      return [
        {
          key: 'open', label: 'Open', sub: 'Including reopened', value: s.open, icon: 'chat_bubble_outline', tone: 'teal',
          trend: this.spark(perDay(list.map((c) => c.createdAt))),
        },
        {
          key: 'progress', label: 'In Progress', sub: 'Being worked on', value: s.inProgress, icon: 'construction', tone: 'blue',
          trend: this.spark(perDay(eventsOf((t, type) => type === 'status' && t.includes('In Progress')))),
        },
        {
          key: 'urgent', label: 'Urgent', sub: 'Needs attention now', value: s.urgent, icon: 'notification_important', tone: 'red',
          trend: this.spark(perDay(list.filter((c) => c.priority === 'Urgent').map((c) => c.createdAt))),
        },
        {
          key: 'overdue', label: 'Overdue', sub: 'Past target date', value: s.overdue, icon: 'schedule', tone: 'amber',
          trend: this.spark(perDay(list.filter((c) => c.targetDate).map((c) => c.targetDate!))),
        },
        {
          key: 'resolved', label: 'Resolved this month', value: s.resolvedThisMonth, icon: 'task_alt', tone: 'green',
          sub: avg === null ? 'No resolutions yet' : `Avg. resolution ${avg < 48 ? avg + ' h' : (avg / 24).toFixed(1) + ' days'}`,
          trend: this.spark(perDay(eventsOf((_, type) => type === 'resolved'))),
        },
      ];
    }),
  );

  get filtered(): Complaint[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    const rows = this.complaints.complaints.filter((c) => {
      if (q && ![c.id, c.title, c.description, c.residentName, c.residentId, c.location ?? '', c.category].join(' ').toLowerCase().includes(q)) return false;
      if (f.status === 'Active' && !isActive(c)) return false;
      if (f.status === 'Overdue' && !this.complaints.isOverdue(c)) return false;
      if (!['All', 'Active', 'Overdue'].includes(f.status) && c.status !== f.status) return false;
      if (f.category !== 'All' && c.category !== f.category) return false;
      if (f.priority !== 'All' && c.priority !== f.priority) return false;
      if (f.assignee === 'Unassigned' && c.assignedTo) return false;
      if (f.assignee !== 'All' && f.assignee !== 'Unassigned' && c.assignedTo !== f.assignee) return false;
      return true;
    });
    return rows.sort((a, b) => this.compare(a, b));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.category !== 'All' || f.priority !== 'All' || f.assignee !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Complaint[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  /** Header click: newest/oldest first, then back to the default (priority) order. */
  sortBy(key: Exclude<SortKey, 'smart'>): void {
    if (this.sortKey !== key) {
      this.sortKey = key;
      this.sortDir = key === 'created' ? 'desc' : 'asc';
    } else if (this.sortDir === (key === 'created' ? 'desc' : 'asc')) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = 'smart';
    }
    this.currentPage = 0;
  }

  sortIcon(key: Exclude<SortKey, 'smart'>): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  ariaSort(key: Exclude<SortKey, 'smart'>): string {
    return this.sortKey !== key ? 'none' : this.sortDir === 'asc' ? 'ascending' : 'descending';
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Actions ----------------------------------------------------------------

  openNew(): void {
    this.dialog
      .open<ComplaintFormDialogComponent, unknown, NewComplaintInput>(ComplaintFormDialogComponent, {
        width: '720px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
      })
      .afterClosed()
      .subscribe((input) => {
        if (!input) return;
        try {
          const c = this.complaints.create(input);
          this.snackBar
            .open(`${c.id} logged${c.priority === 'Urgent' ? ' as Urgent' : ''}.`, 'View', { duration: 4000 })
            .onAction()
            .subscribe(() => this.openView(c));
        } catch (err: any) {
          this.snackBar.open(err?.message ?? 'Could not log the complaint.', 'Close', { duration: 4500 });
        }
      });
  }

  openView(c: Complaint): void {
    this.dialog.open<ComplaintViewDialogComponent, ComplaintViewDialogData>(ComplaintViewDialogComponent, {
      width: '1100px',
      maxWidth: '94vw',
      autoFocus: false,
      data: { complaintId: c.id },
    });
  }

  // ---- View helpers -----------------------------------------------------------

  isUrgent(c: Complaint): boolean {
    return c.priority === 'Urgent' && isActive(c);
  }

  statusTone(c: Complaint): string {
    return STATUS_TONES[c.status];
  }

  assigneeName(c: Complaint): string {
    return staffById(c.assignedTo)?.name ?? '';
  }

  assigneeRole(c: Complaint): string {
    return staffById(c.assignedTo)?.role ?? '';
  }

  /** "Due today", "In 2 days", "Overdue by 3 days" — only while the complaint is active. */
  targetHint(c: Complaint): string {
    if (!c.targetDate || !isActive(c)) return '';
    const days = Math.round((new Date(c.targetDate).getTime() - new Date(this.today()).getTime()) / 86_400_000);
    if (days === 0) return 'Due today';
    if (days > 0) return `In ${days} day${days === 1 ? '' : 's'}`;
    return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  tone(id: string): string {
    const n = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return AVATAR_TONES[n % AVATAR_TONES.length];
  }

  categoryKey(category: string): string {
    return category.toLowerCase().replace(/[^a-z]/g, '');
  }

  // ---------------------------------------------------------------------------

  private compare(a: Complaint, b: Complaint): number {
    if (this.sortKey === 'created') {
      const d = a.createdAt.localeCompare(b.createdAt);
      return this.sortDir === 'asc' ? d : -d;
    }
    if (this.sortKey === 'target') {
      // Complaints without a target always go last
      if (!a.targetDate || !b.targetDate) return a.targetDate ? -1 : b.targetDate ? 1 : 0;
      const d = a.targetDate.localeCompare(b.targetDate);
      return this.sortDir === 'asc' ? d : -d;
    }
    return this.rank(a) - this.rank(b) || b.createdAt.localeCompare(a.createdAt);
  }

  private rank(c: Complaint): number {
    if (!isActive(c)) return c.status === 'Resolved' ? 100 : 200;
    return PRIORITY_RANK[c.priority] * 10 + (this.complaints.isOverdue(c) ? 0 : 1);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Last n local dates (yyyy-mm-dd), oldest first. */
  private lastDays(n: number): string[] {
    const out: string[] = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
    }
    return out;
  }

  /** Smoothed sparkline paths for a 120×32 viewBox. */
  private spark(values: number[]): { line: string; area: string } {
    const w = 120;
    const h = 32;
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
    let line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      line += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
  }
}
