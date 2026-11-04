import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { AppPaginationComponent } from '../../../shared/components/pagination/app-pagination.component';
import { TenantAnnouncementLists, TenantAnnouncementView, TenantAnnouncementsService } from '../../../core/services/tenant-announcements.service';
import { TenantAnnouncementDetailDialogComponent } from './tenant-announcement-detail-dialog.component';

/** Tenant Announcements: Published notices addressed to this Tenant; expired ones sit in the Archive tab. */
@Component({
  selector: 'app-tenant-announcements',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppButtonComponent, AppEmptyStateComponent, AppPaginationComponent],
  templateUrl: './tenant-announcements.component.html',
  styleUrl: './tenant-announcements.component.scss',
})
export class TenantAnnouncementsComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantAnnouncementsService);
  private readonly dialog = inject(MatDialog);
  readonly fmt = inject(AppFormatService);

  state: 'loading' | 'ready' | 'error' = 'loading';
  errorMessage = '';
  lists: TenantAnnouncementLists = { live: [], archive: [] };
  tab: 'current' | 'archive' = 'current';
  search = '';
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
    this.sub = this.service.lists$.subscribe({
      next: (l) => {
        this.lists = l;
        this.state = 'ready';
      },
      error: (e: unknown) => {
        this.errorMessage = e instanceof Error ? e.message : 'Could not load announcements.';
        this.state = 'error';
      },
    });
  }

  get unread(): number {
    return this.lists.live.filter((a) => !a.read).length;
  }

  get source(): TenantAnnouncementView[] {
    return this.tab === 'current' ? this.lists.live : this.lists.archive;
  }

  get filtered(): TenantAnnouncementView[] {
    const q = this.search.trim().toLowerCase();
    return q ? this.source.filter((a) => `${a.title} ${a.message}`.toLowerCase().includes(q)) : this.source;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): TenantAnnouncementView[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  setTab(tab: 'current' | 'archive'): void {
    this.tab = tab;
    this.currentPage = 0;
  }

  markAllRead(): void {
    try {
      this.service.markAllRead();
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Could not update.';
      this.state = 'error';
    }
  }

  open(a: TenantAnnouncementView): void {
    this.dialog.open(TenantAnnouncementDetailDialogComponent, { width: '640px', maxWidth: '96vw', data: { id: a.id }, autoFocus: 'first-tabbable' });
  }
}
