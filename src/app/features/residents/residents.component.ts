import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { AuthService } from '../../core/services/auth.service';
import { AppFormatService } from '../../core/services/app-format.service';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { ResidentAllocation, ResidentsService } from './residents.service';
import { FeesService } from '../fees-payments/fees.service';
import {
  HostelResident,
  RESIDENT_STATUSES,
  RESIDENT_TYPES,
  ResidentFilterState,
  ResidentStatus,
  formatMobile,
  residentFullName,
} from './residents.models';
import {
  ResidentFormDialogComponent,
  ResidentFormDialogData,
  ResidentFormDialogResult,
} from './resident-form-dialog/resident-form-dialog.component';
import {
  ResidentBedDialogComponent,
  ResidentBedDialogData,
  ResidentBedDialogResult,
  ResidentBedMode,
} from './resident-bed-dialog/resident-bed-dialog.component';
import {
  ResidentViewAction,
  ResidentViewDialogComponent,
  ResidentViewDialogData,
} from './resident-view-dialog/resident-view-dialog.component';

/** Special status filter value: current residents who have no bed yet. */
const NEEDS_BED = 'Needs Bed';

const STATUS_TONES: Record<ResidentStatus, string> = {
  Active: 'success',
  Invited: 'info',
  'On Leave': 'warning',
  'Checked Out': 'neutral',
  Suspended: 'danger',
};

const AVATAR_TONES = ['blue', 'purple', 'green', 'amber'] as const;

interface ResidentRow {
  resident: HostelResident;
  name: string;
  allocation?: ResidentAllocation;
}

const DEFAULT_FILTERS: ResidentFilterState = {
  search: '',
  status: 'All',
  type: 'All',
  joined: 'All',
  showDeactivated: false,
};

@Component({
  selector: 'app-residents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    MatTableModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './residents.component.html',
  styleUrl: './residents.component.scss',
})
export class ResidentsComponent {
  private readonly residentsService = inject(ResidentsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);
  /** Instantiating the fees ledger syncs each resident's Outstanding balance from charges & payments. */
  private readonly fees = inject(FeesService);
  readonly fmt = inject(AppFormatService);

  readonly stats$ = this.residentsService.stats$;
  readonly formatMobile = formatMobile;

  /** Outstanding balances are visible to hostel staff only, never to tenants. */
  readonly canViewBalance = !this.auth.isTenant;

  pageSize = 10;
  currentPage = 0;

  filters: ResidentFilterState = { ...DEFAULT_FILTERS };

  readonly statusOptions = [
    { value: 'All', label: 'All Status' },
    ...RESIDENT_STATUSES.map((s) => ({ value: s, label: s })),
    { value: NEEDS_BED, label: 'Needs a bed' },
  ];

  readonly typeOptions = [{ value: 'All', label: 'All Types' }, ...RESIDENT_TYPES.map((t) => ({ value: t, label: t }))];

  readonly joinedOptions = [
    { value: 'All', label: 'Joined: Any time' },
    { value: 'upcoming', label: 'Joining soon' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'year', label: 'This year' },
  ];

  get filteredRows(): ResidentRow[] {
    const q = this.filters.search.trim().toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const joinedFrom = this.joinedFrom();

    return this.residentsService.residents
      .filter((r) => this.filters.showDeactivated || !r.deactivatedAt)
      .map((r) => ({ resident: r, name: residentFullName(r), allocation: this.residentsService.allocationFor(r.residentId) }))
      .filter(({ resident: r, name, allocation }) => {
        if (q) {
          const haystack = [
            r.residentId,
            name,
            r.mobile,
            r.email ?? '',
            allocation ? `room ${allocation.room.roomNumber} ${allocation.room.roomNumber} ${allocation.bed.bedNumber}` : '',
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        if (this.filters.status === NEEDS_BED) {
          if (!this.residentsService.needsBed(r)) return false;
        } else if (this.filters.status !== 'All' && r.status !== this.filters.status) {
          return false;
        }

        if (this.filters.type !== 'All' && r.residentType !== this.filters.type) return false;

        if (this.filters.joined === 'upcoming') {
          if (r.joiningDate <= today) return false;
        } else if (joinedFrom && (r.joiningDate < joinedFrom || r.joiningDate > today)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.resident.createdAt.localeCompare(a.resident.createdAt));
  }

  get totalPages(): number {
    return Math.ceil(this.filteredRows.length / this.pageSize);
  }

  get safePage(): number {
    return Math.min(this.currentPage, Math.max(0, this.totalPages - 1));
  }

  get pagedRows(): ResidentRow[] {
    const start = this.safePage * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get hasActiveFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.status !== 'All' || f.type !== 'All' || f.joined !== 'All' || f.showDeactivated;
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- Actions ---------------------------------------------------------------

  openAdd(): void {
    this.openForm({}).subscribe((res) => {
      if (!res) return;
      this.run(() => {
        const created = this.residentsService.create(res.input);
        let message = `${residentFullName(created)} added as ${created.residentId}.`;
        if (res.allocation) {
          try {
            this.residentsService.allocate(created.residentId, res.allocation.roomId, res.allocation.bedId, created.joiningDate);
            message += ` Bed allocated: ${this.residentsService.describe(this.residentsService.allocationFor(created.residentId))}.`;
          } catch (err: any) {
            message += ` Bed not allocated: ${err?.message ?? 'unknown error'}`;
          }
        }
        this.snackBar.open(message, 'Close', { duration: 5000 });
        this.offerInvite(created);
      });
    });
  }

  openEdit(r: HostelResident): void {
    this.openForm({ resident: r }).subscribe((res) => {
      if (!res) return;
      this.run(() => {
        this.residentsService.update(r.residentId, res.input);
        this.snackBar.open(`${residentFullName(res.input)} updated.`, 'Close', { duration: 3000 });
      });
    });
  }

  openView(r: HostelResident): void {
    this.dialog
      .open<ResidentViewDialogComponent, ResidentViewDialogData, ResidentViewAction>(ResidentViewDialogComponent, {
        width: '1040px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { residentId: r.residentId, canViewBalance: this.canViewBalance },
      })
      .afterClosed()
      .subscribe((action) => {
        const latest = this.residentsService.byId(r.residentId);
        if (!action || !latest) return;
        if (action === 'edit') this.openEdit(latest);
        else if (action === 'invite') this.sendInvite(latest);
        else if (action === 'deactivate' || action === 'reactivate') this.toggleDeactivate(latest);
        else this.openBedAction(latest, action);
      });
  }

  openBedAction(r: HostelResident, mode: ResidentBedMode): void {
    this.dialog
      .open<ResidentBedDialogComponent, ResidentBedDialogData, ResidentBedDialogResult>(ResidentBedDialogComponent, {
        width: '620px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { resident: r, mode },
      })
      .afterClosed()
      .subscribe((res) => {
        if (!res) return;
        const name = residentFullName(r);
        this.run(() => {
          if (res.mode === 'allocate') {
            this.residentsService.allocate(r.residentId, res.roomId!, res.bedId!, res.date, res.notes);
            this.snackBar.open(`${name} allocated to ${this.allocationLabel(r)}.`, 'Close', { duration: 3500 });
          } else if (res.mode === 'transfer') {
            this.residentsService.transfer(r.residentId, res.roomId!, res.bedId!, res.date, res.notes);
            this.snackBar.open(`${name} transferred to ${this.allocationLabel(r)}.`, 'Close', { duration: 3500 });
          } else {
            this.residentsService.checkOut(r.residentId, res.date, res.notes);
            this.snackBar.open(`${name} checked out. History has been kept.`, 'Close', { duration: 3500 });
          }
        });
      });
  }

  sendInvite(r: HostelResident): void {
    this.run(() => {
      this.residentsService.sendInvite(r.residentId);
      this.snackBar.open(`Activation link sent to ${residentFullName(r)} via ${r.email ? 'SMS & Email' : 'SMS'}.`, 'Close', {
        duration: 3500,
      });
    });
  }

  toggleDeactivate(r: HostelResident): void {
    const name = residentFullName(r);
    if (r.deactivatedAt) {
      this.confirm
        .confirm({
          title: `Reactivate ${name}?`,
          message: `${name} will appear in the resident list again.`,
          confirmLabel: 'Reactivate',
          tone: 'primary',
        })
        .subscribe((ok) => ok && this.run(() => this.residentsService.reactivate(r.residentId)));
      return;
    }

    if (this.residentsService.allocationFor(r.residentId)) {
      this.snackBar.open(`Check ${name} out of their bed before deactivating.`, 'Close', { duration: 4000 });
      return;
    }
    this.confirm
      .confirm({
        title: `Deactivate ${name}?`,
        message: 'The resident is hidden from active lists and can no longer be allocated a bed. Their history is kept and they can be reactivated later.',
        confirmLabel: 'Deactivate',
        tone: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.run(() => {
          this.residentsService.deactivate(r.residentId);
          this.snackBar.open(`${name} deactivated.`, 'Close', { duration: 3000 });
        });
      });
  }

  // ---- View helpers ----------------------------------------------------------

  get displayedColumns(): string[] {
    return ['resident', 'contact', 'room', 'type', 'joined', 'status', ...(this.canViewBalance ? ['balance'] : []), 'actions'];
  }

  canHoldBed(r: HostelResident): boolean {
    return !r.deactivatedAt && this.residentsService.canHoldBed(r.status);
  }

  /** Maps a resident status onto the shared status-badge tones. */
  statusTone(status: ResidentStatus): string {
    return STATUS_TONES[status];
  }

  /** A stable avatar colour per resident (same resident → same colour). */
  tone(r: HostelResident): string {
    const n = [...r.residentId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return AVATAR_TONES[n % AVATAR_TONES.length];
  }

  initials(r: HostelResident): string {
    return (r.firstName[0] + (r.lastName[0] ?? '')).toUpperCase();
  }

  // ---------------------------------------------------------------------------

  private openForm(data: ResidentFormDialogData) {
    return this.dialog
      .open<ResidentFormDialogComponent, ResidentFormDialogData, ResidentFormDialogResult>(ResidentFormDialogComponent, {
        width: '1180px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
        data,
      })
      .afterClosed();
  }

  /** New residents start as Invited: offer to send the activation link straight away. */
  private offerInvite(r: HostelResident): void {
    this.confirm
      .confirm({
        title: 'Send activation invite?',
        message: `${residentFullName(r)} needs to activate their account and set a password.`,
        confirmLabel: 'Send invite',
        cancelLabel: 'Later',
        tone: 'primary',
        icon: 'send',
        details: [
          { icon: 'smartphone', label: 'SMS', value: formatMobile(r.mobileCode, r.mobile) },
          ...(r.email ? [{ icon: 'mail', label: 'Email', value: r.email }] : []),
        ],
      })
      .subscribe((ok) => ok && this.sendInvite(r));
  }

  private allocationLabel(r: HostelResident): string {
    return this.residentsService.describe(this.residentsService.allocationFor(r.residentId));
  }

  private joinedFrom(): string | undefined {
    const d = new Date();
    switch (this.filters.joined) {
      case '30':
        d.setDate(d.getDate() - 30);
        break;
      case '90':
        d.setDate(d.getDate() - 90);
        break;
      case 'year':
        return `${d.getFullYear()}-01-01`;
      default:
        return undefined;
    }
    return d.toISOString().slice(0, 10);
  }

  private run(fn: () => void): void {
    try {
      fn();
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Something went wrong.', 'Close', { duration: 4500 });
    }
  }
}
