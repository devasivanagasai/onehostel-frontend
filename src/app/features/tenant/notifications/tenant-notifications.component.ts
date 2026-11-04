import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { AppPaginationComponent } from '../../../shared/components/pagination/app-pagination.component';
import { TenantNotification, TenantNotificationCategory, TenantNotificationService } from '../../../core/services/tenant-notification.service';

const CATEGORY_ICONS: Record<TenantNotificationCategory, string> = {
  Account: 'account_circle',
  Invoice: 'receipt_long',
  Payment: 'payments',
  Complaint: 'build_circle',
  Announcement: 'campaign',
  Room: 'meeting_room',
  Profile: 'person',
  Booking: 'event_available',
  Visitor: 'badge',
  Leave: 'exit_to_app',
  Parcel: 'inventory_2',
  Transfer: 'swap_horiz',
  Support: 'support_agent',
  Event: 'event',
  Survey: 'rate_review',
};

const CATEGORIES = Object.keys(CATEGORY_ICONS) as TenantNotificationCategory[];

/** Tenant notification centre. "Read" means the Tenant opened or marked it here, nothing more. */
@Component({
  selector: 'app-tenant-notifications',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppButtonComponent, AppEmptyStateComponent, AppPaginationComponent],
  templateUrl: './tenant-notifications.component.html',
  styleUrl: './tenant-notifications.component.scss',
})
export class TenantNotificationsComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantNotificationService);
  private readonly router = inject(Router);
  readonly fmt = inject(AppFormatService);

  readonly categories = CATEGORIES;
  readonly icons = CATEGORY_ICONS;

  state: 'loading' | 'ready' | 'error' = 'loading';
  errorMessage = '';
  items: TenantNotification[] = [];

  category = 'All';
  unreadOnly = false;
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
    this.sub = this.service.mine$.subscribe({
      next: (list) => {
        this.items = list;
        this.state = 'ready';
      },
      error: (e: unknown) => {
        this.errorMessage = e instanceof Error ? e.message : 'Could not load notifications.';
        this.state = 'error';
      },
    });
  }

  get unread(): number {
    return this.items.filter((n) => !n.read).length;
  }

  get hasFilters(): boolean {
    return this.category !== 'All' || this.unreadOnly;
  }

  get filtered(): TenantNotification[] {
    return this.items.filter((n) => (this.category === 'All' || n.category === this.category) && (!this.unreadOnly || !n.read));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): TenantNotification[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.category = 'All';
    this.unreadOnly = false;
    this.currentPage = 0;
  }

  /** Relative time ("5 min ago") for recent items, otherwise a date. */
  relative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (!(diff >= 0)) return 'Just now';
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return this.fmt.date(iso);
  }

  absolute(iso: string): string {
    return `${this.fmt.date(iso)} ${this.fmt.date(iso, 'time')}`;
  }

  open(n: TenantNotification): void {
    try {
      this.service.markRead(n.id);
    } catch {
      return; // not this Tenant's notification
    }
    if (n.route) void this.router.navigateByUrl(n.route);
  }

  markAllRead(): void {
    try {
      this.service.markAllRead();
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Could not update.';
      this.state = 'error';
    }
  }

  dismiss(n: TenantNotification, event: Event): void {
    event.stopPropagation();
    try {
      this.service.remove(n.id);
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Could not remove.';
      this.state = 'error';
    }
  }
}
