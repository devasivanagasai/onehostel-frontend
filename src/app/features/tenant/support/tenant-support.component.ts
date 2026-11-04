import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { Subscription } from 'rxjs';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { HostelContact, TenantSupportService } from '../../../core/services/tenant-support.service';
import { SUPPORT_STATUSES, SUPPORT_STATUS_LABELS, SUPPORT_STATUS_TONES, SupportTicket } from '../../../core/models/tenant-support.models';
import { TenantSupportNewDialogComponent } from './tenant-support-new-dialog.component';
import { TenantSupportDetailDialogComponent } from './tenant-support-detail-dialog.component';

/** Tenant Help & Support: hostel contact details plus the Tenant's own support requests. */
@Component({
  selector: 'app-tenant-support',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTableModule, AppButtonComponent, AppTableCardComponent],
  templateUrl: './tenant-support.component.html',
  styleUrl: './tenant-support.component.scss',
})
export class TenantSupportComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantSupportService);
  private readonly dialog = inject(MatDialog);
  readonly fmt = inject(AppFormatService);

  readonly statuses = SUPPORT_STATUSES;
  readonly labels = SUPPORT_STATUS_LABELS;
  readonly tones = SUPPORT_STATUS_TONES;
  readonly columns = ['ref', 'subject', 'topic', 'status', 'updated', 'actions'];

  state: 'loading' | 'ready' | 'error' = 'loading';
  errorMessage = '';
  tickets: SupportTicket[] = [];
  contact: HostelContact = { hostelName: '', phone: '', email: '', address: '' };

  search = '';
  status = 'All';
  currentPage = 0;
  pageSize = 10;

  private sub?: Subscription;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.sub?.unsubscribe();
    this.state = 'loading';
    try {
      this.contact = this.service.hostelContact;
    } catch {
      // contact card simply stays empty
    }
    this.sub = this.service.mine$.subscribe({
      next: (list) => {
        this.tickets = list;
        this.state = 'ready';
      },
      error: (e: unknown) => {
        this.errorMessage = e instanceof Error ? e.message : 'Could not load your requests.';
        this.state = 'error';
      },
    });
  }

  get hasFilters(): boolean {
    return !!this.search.trim() || this.status !== 'All';
  }

  get filtered(): SupportTicket[] {
    const q = this.search.trim().toLowerCase();
    return this.tickets.filter((t) => (this.status === 'All' || t.status === this.status) && (!q || `${t.id} ${t.subject} ${t.topic}`.toLowerCase().includes(q)));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): SupportTicket[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  get waitingCount(): number {
    return this.tickets.filter((t) => t.status === 'Waiting for Resident').length;
  }

  tone(t: SupportTicket): string {
    return this.tones[t.status];
  }

  label(t: SupportTicket): string {
    return this.labels[t.status];
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

  create(): void {
    this.dialog.open(TenantSupportNewDialogComponent, { width: '600px', maxWidth: '96vw', autoFocus: 'first-tabbable' });
  }

  view(t: SupportTicket): void {
    this.dialog.open(TenantSupportDetailDialogComponent, { width: '680px', maxWidth: '96vw', data: { id: t.id }, autoFocus: 'first-tabbable' });
  }
}
