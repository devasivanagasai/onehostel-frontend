import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { COMPLAINT_STATUSES, STATUS_TONES } from '../../../core/models/complaints.models';
import { TENANT_CATEGORY_ICONS, TenantComplaintView, TenantComplaintsService } from '../../../core/services/tenant-complaints.service';
import { TenantComplaintRaiseDialogComponent } from './tenant-complaint-raise-dialog.component';
import { TenantComplaintDetailDialogComponent } from './tenant-complaint-detail-dialog.component';

/** Tenant "Complaints & Maintenance" page: the signed-in Tenant's own complaints only. */
@Component({
  selector: 'app-tenant-complaints',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTableModule, AppButtonComponent, AppTableCardComponent],
  templateUrl: './tenant-complaints.component.html',
  styleUrl: './tenant-complaints.component.scss',
})
export class TenantComplaintsComponent implements OnInit {
  readonly service = inject(TenantComplaintsService);
  private readonly dialog = inject(MatDialog);
  readonly fmt = inject(AppFormatService);

  readonly statuses = COMPLAINT_STATUSES;
  readonly tones = STATUS_TONES;
  readonly icons = TENANT_CATEGORY_ICONS;
  readonly columns = ['complaint', 'issue', 'location', 'status', 'updated', 'actions'];

  state: 'loading' | 'ready' | 'error' = 'loading';
  errorMessage = '';
  rows: TenantComplaintView[] = [];

  search = '';
  status = 'All';
  currentPage = 0;
  pageSize = 10;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state = 'loading';
    try {
      this.rows = this.service.mine;
      this.state = 'ready';
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Could not load your complaints.';
      this.state = 'error';
    }
  }

  get hasFilters(): boolean {
    return !!this.search.trim() || this.status !== 'All';
  }

  get filtered(): TenantComplaintView[] {
    const q = this.search.trim().toLowerCase();
    return this.rows.filter(
      (c) =>
        (this.status === 'All' || c.status === this.status) &&
        (!q || `${c.id} ${c.title} ${c.category} ${c.location}`.toLowerCase().includes(q)),
    );
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): TenantComplaintView[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  get openCount(): number {
    return this.rows.filter((c) => c.status !== 'Resolved' && c.status !== 'Closed').length;
  }

  clearFilters(): void {
    this.search = '';
    this.status = 'All';
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  icon(c: TenantComplaintView): string {
    return this.icons[c.category];
  }

  tone(c: TenantComplaintView): string {
    return this.tones[c.status] ?? 'neutral';
  }

  raise(): void {
    this.dialog
      .open(TenantComplaintRaiseDialogComponent, { width: '640px', maxWidth: '96vw', autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe(() => this.load());
  }

  view(c: TenantComplaintView): void {
    this.dialog
      .open(TenantComplaintDetailDialogComponent, { width: '720px', maxWidth: '96vw', data: { id: c.id }, autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe(() => this.load());
  }
}
