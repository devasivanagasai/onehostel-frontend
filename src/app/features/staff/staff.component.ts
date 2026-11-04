import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../core/services/app-format.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { StaffService } from '../../core/services/staff.service';
import { PermissionsService } from '../../core/services/permissions.service';
import {
  PRIORITY_TONES,
  STAFF_CATEGORIES,
  STAFF_STATUSES,
  STAFF_STATUS_TONES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_TONES,
  Staff,
  StaffStatus,
  Task,
  TaskStatus,
  initialsOf,
} from '../../core/models/staff.models';
import { StaffFormDialogComponent, StaffFormData } from './staff-form-dialog/staff-form-dialog.component';
import { TaskFormDialogComponent, TaskFormData } from './task-form-dialog/task-form-dialog.component';

type StaffTab = 'staff' | 'tasks';

interface StaffFilters {
  search: string;
  category: string;
  status: string;
}

interface TaskFilters {
  search: string;
  status: string;
  priority: string;
  assignee: string;
  overdueOnly: boolean;
}

const DEFAULT_STAFF_FILTERS: StaffFilters = { search: '', category: 'All', status: 'All' };
const DEFAULT_TASK_FILTERS: TaskFilters = { search: '', status: 'All', priority: 'All', assignee: 'All', overdueOnly: false };

@Component({
  selector: 'app-staff',
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
  templateUrl: './staff.component.html',
  styleUrl: './staff.component.scss',
})
export class StaffComponent implements OnDestroy {
  readonly service = inject(StaffService);
  readonly permissions = inject(PermissionsService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly staffColumns = ['staff', 'contact', 'duties', 'shift', 'employment', 'access', 'status', 'actions'];
  readonly taskColumns = ['task', 'assignee', 'due', 'priority', 'status', 'actions'];
  readonly categories = STAFF_CATEGORIES;
  readonly staffStatuses = STAFF_STATUSES;
  readonly taskStatuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;
  readonly initials = initialsOf;

  tab: StaffTab = 'staff';
  staffFilters: StaffFilters = { ...DEFAULT_STAFF_FILTERS };
  taskFilters: TaskFilters = { ...DEFAULT_TASK_FILTERS };
  staffPageSize = 10;
  staffPage = 0;
  taskPageSize = 10;
  taskPage = 0;

  /** Brief skeleton so the list never flashes empty while the (mock) data is read. */
  loading = true;
  private readonly loadTimer = setTimeout(() => (this.loading = false), 250);

  ngOnDestroy(): void {
    clearTimeout(this.loadTimer);
  }

  // ---- KPIs ----------------------------------------------------------------------

  get kpis() {
    const staff = this.service.staff;
    const t = this.service.statsOf(this.service.tasks);
    return {
      active: staff.filter((s) => s.status === 'Active').length,
      onLeave: staff.filter((s) => s.status === 'On Leave').length,
      open: t.open + t.inProgress,
      overdue: t.overdue,
    };
  }

  // ---- Staff list ----------------------------------------------------------------

  get filteredStaff(): Staff[] {
    const f = this.staffFilters;
    const q = f.search.trim().toLowerCase();
    return this.service.staff
      .filter((s) => {
        if (f.category !== 'All' && s.category !== f.category) return false;
        if (f.status !== 'All' && s.status !== f.status) return false;
        return !q || [s.id, s.name, s.mobile, s.email ?? ''].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get hasStaffFilters(): boolean {
    const f = this.staffFilters;
    return !!f.search.trim() || f.category !== 'All' || f.status !== 'All';
  }

  get staffTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredStaff.length / this.staffPageSize));
  }

  get staffSafePage(): number {
    return Math.min(this.staffPage, this.staffTotalPages - 1);
  }

  get pagedStaff(): Staff[] {
    const start = this.staffSafePage * this.staffPageSize;
    return this.filteredStaff.slice(start, start + this.staffPageSize);
  }

  clearStaffFilters(): void {
    this.staffFilters = { ...DEFAULT_STAFF_FILTERS };
    this.staffPage = 0;
  }

  // ---- Tasks list ----------------------------------------------------------------

  get filteredTasks(): Task[] {
    const f = this.taskFilters;
    const q = f.search.trim().toLowerCase();
    return this.service.tasks
      .filter((t) => {
        if (f.status !== 'All' && t.status !== f.status) return false;
        if (f.priority !== 'All' && t.priority !== f.priority) return false;
        if (f.assignee !== 'All' && t.assigneeId !== f.assignee) return false;
        if (f.overdueOnly && !this.service.isOverdue(t)) return false;
        return !q || [t.id, t.title, this.assigneeName(t)].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => Number(this.service.isPending(b)) - Number(this.service.isPending(a)) || a.dueDate.localeCompare(b.dueDate));
  }

  get hasTaskFilters(): boolean {
    const f = this.taskFilters;
    return !!f.search.trim() || f.status !== 'All' || f.priority !== 'All' || f.assignee !== 'All' || f.overdueOnly;
  }

  get taskTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredTasks.length / this.taskPageSize));
  }

  get taskSafePage(): number {
    return Math.min(this.taskPage, this.taskTotalPages - 1);
  }

  get pagedTasks(): Task[] {
    const start = this.taskSafePage * this.taskPageSize;
    return this.filteredTasks.slice(start, start + this.taskPageSize);
  }

  clearTaskFilters(): void {
    this.taskFilters = { ...DEFAULT_TASK_FILTERS };
    this.taskPage = 0;
  }

  setTab(tab: StaffTab): void {
    this.tab = tab;
  }

  /** Jump to the Tasks tab filtered to one person. */
  showTasksFor(s: Staff): void {
    this.taskFilters = { ...DEFAULT_TASK_FILTERS, assignee: s.id };
    this.taskPage = 0;
    this.tab = 'tasks';
  }

  // ---- View helpers --------------------------------------------------------------

  statusTone(s: StaffStatus): string {
    return STAFF_STATUS_TONES[s];
  }

  taskTone(s: TaskStatus): string {
    return TASK_STATUS_TONES[s];
  }

  priorityTone(p: Task['priority']): string {
    return PRIORITY_TONES[p];
  }

  assigneeName(t: Task): string {
    return this.service.byId(t.assigneeId)?.name ?? t.assigneeId;
  }

  assignee(t: Task): Staff | undefined {
    return this.service.byId(t.assigneeId);
  }

  pendingCount(s: Staff): number {
    return this.service.openTasksFor(s.id).length;
  }

  dutiesText(s: Staff): string {
    return s.duties.join(', ');
  }

  /** What the staff member's role template lets them do, e.g. "3 modules" (for the tooltip). */
  accessSummary(s: Staff): string {
    if (s.roleTemplate === 'None') return 'No role template';
    const modules = ['residents', 'rooms', 'fees', 'complaints', 'visitors', 'attendance', 'parcels', 'mess'] as const;
    const n = modules.filter((m) => this.permissions.staffCan(s, m, 'view')).length;
    return `${s.roleTemplate}: can view ${n} of ${modules.length} core modules`;
  }

  // ---- Actions -------------------------------------------------------------------

  openStaffForm(s?: Staff): void {
    this.dialog
      .open<StaffFormDialogComponent, StaffFormData, Staff>(StaffFormDialogComponent, {
        width: '720px', maxWidth: '94vw', autoFocus: false, disableClose: true, data: { id: s?.id },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.snackBar.open(s ? `${saved.name} updated.` : `${saved.name} added as ${saved.id}.`, 'Close', { duration: 3500 });
      });
  }

  openTaskForm(opts: { task?: Task; assigneeId?: string } = {}): void {
    this.dialog
      .open<TaskFormDialogComponent, TaskFormData, Task>(TaskFormDialogComponent, {
        width: '600px', maxWidth: '94vw', autoFocus: false, disableClose: true, data: { id: opts.task?.id, assigneeId: opts.assigneeId },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.snackBar.open(opts.task ? `${saved.id} updated.` : `${saved.id} created for ${this.assigneeName(saved)}.`, 'Close', { duration: 3500 });
      });
  }

  /** Activate / Deactivate / On Leave behind a confirmation; deactivating warns about open tasks. */
  changeStatus(s: Staff, status: StaffStatus): void {
    const open = this.service.deactivationImpact(s.id).length;
    const text = {
      Active: { title: 'Activate staff?', label: 'Activate', tone: 'success' as const, icon: 'check_circle_outline', message: `${s.name} will be active again and can be given new tasks.` },
      Inactive: { title: 'Deactivate staff?', label: 'Deactivate', tone: 'danger' as const, icon: 'person_off', message: `${s.name} will no longer be offered for new tasks or have system access. Their history is kept.` },
      'On Leave': { title: 'Mark as on leave?', label: 'Mark On Leave', tone: 'warning' as const, icon: 'beach_access', message: `${s.name} will not be offered for new tasks while on leave.` },
    }[status];
    const warnOpen = status !== 'Active' && open > 0;
    this.confirm
      .confirm({
        title: text.title,
        message: text.message,
        confirmLabel: text.label,
        tone: text.tone,
        icon: text.icon,
        details: [
          { icon: 'badge', label: 'Staff', value: `${s.name} (${s.id})` },
          { icon: 'task_alt', label: 'Open tasks', value: String(open) },
        ],
        note: warnOpen ? `${s.name} still has ${open} open task${open === 1 ? '' : 's'}. They stay visible and are flagged until reassigned or closed.` : undefined,
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          this.service.setStatus(s.id, status);
          this.snackBar.open(`${s.name} is now ${status}.`, 'Close', { duration: 3500 });
        } catch (err: any) {
          this.snackBar.open(err?.message ?? 'Could not change the status.', 'Close', { duration: 4500 });
        }
      });
  }

  moveTask(t: Task, status: TaskStatus): void {
    const run = () => {
      try {
        this.service.setTaskStatus(t.id, status);
        this.snackBar.open(`${t.id} marked ${status}.`, 'Close', { duration: 3000 });
      } catch (err: any) {
        this.snackBar.open(err?.message ?? 'Could not update the task.', 'Close', { duration: 4500 });
      }
    };
    if (status !== 'Cancelled') return run();
    this.confirm
      .confirm({
        title: 'Cancel task?',
        message: `${t.title} will be cancelled. A cancelled task can't be reopened.`,
        confirmLabel: 'Cancel Task',
        cancelLabel: 'Keep Task',
        tone: 'danger',
        details: [{ icon: 'person', label: 'Assigned to', value: this.assigneeName(t) }],
      })
      .subscribe((ok) => ok && run());
  }

  /** Icon + label for a forward move. */
  moveIcon(status: TaskStatus): string {
    return status === 'In Progress' ? 'play_arrow' : status === 'Done' ? 'check_circle' : 'cancel';
  }

  moveLabel(status: TaskStatus): string {
    return status === 'In Progress' ? 'Start' : status === 'Done' ? 'Mark done' : 'Cancel task';
  }
}
