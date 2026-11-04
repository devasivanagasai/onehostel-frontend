import { Component, EventEmitter, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { TenantNotificationService } from '../../core/services/tenant-notification.service';

interface BottomItem {
  label: string;
  icon: string;
  route: string;
  /** Tenant module key; the tab is left out when that module is off for the hostel. */
  module?: string;
  badge?: boolean;
}

/**
 * Phone navigation for Tenants: the five things they open most, within thumb reach, plus a "More" tab for
 * everything else (opens the full menu). Hidden on larger screens, where the sidebar is always visible.
 */
@Component({
  selector: 'app-tenant-bottom-nav',
  standalone: true,
  imports: [AsyncPipe, RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <nav class="tbn" aria-label="Main">
      @for (item of items; track item.route) {
        <a class="tbn__item" [routerLink]="item.route" routerLinkActive="tbn__item--active" #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
          <span class="tbn__icon">
            <mat-icon fontSet="material-icons-outlined">{{ item.icon }}</mat-icon>
            @if (item.badge && (unread$ | async); as n) {
              <span class="tbn__badge" [attr.aria-label]="n + ' unread'">{{ n > 9 ? '9+' : n }}</span>
            }
          </span>
          <span class="tbn__label">{{ item.label }}</span>
        </a>
      }
      <button type="button" class="tbn__item" (click)="more.emit()" aria-haspopup="true">
        <span class="tbn__icon"><mat-icon fontSet="material-icons-outlined">menu</mat-icon></span>
        <span class="tbn__label">More</span>
      </button>
    </nav>
  `,
  styles: [
    `
      .tbn { display: flex; align-items: stretch; justify-content: space-around; height: 60px; background: #fff; border-top: 1px solid #e2e8f0; box-shadow: 0 -4px 16px rgba(15, 34, 74, 0.06); padding-bottom: env(safe-area-inset-bottom); }
      .tbn__item { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; background: none; border: 0; text-decoration: none; color: #64748b; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      .tbn__item--active { color: #2563eb; }
      .tbn__item--active .tbn__label { font-weight: 700; }
      .tbn__item:focus-visible { outline: 2px solid #2563eb; outline-offset: -4px; border-radius: 8px; }
      .tbn__icon { position: relative; display: grid; place-items: center; width: 44px; height: 28px; border-radius: 14px; }
      .tbn__item--active .tbn__icon { background: #eff6ff; }
      .tbn__label { font-size: 11px; line-height: 1; }
      .tbn__badge { position: absolute; top: -2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #dc2626; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; }
    `,
  ],
})
export class TenantBottomNavComponent {
  private readonly tenant = inject(TenantContextService);
  private readonly notifications = inject(TenantNotificationService);

  @Output() readonly more = new EventEmitter<void>();

  readonly unread$ = this.notifications.unreadCount$;

  private readonly all: BottomItem[] = [
    { label: 'Home', icon: 'home', route: '/dashboard' },
    { label: 'Fees', icon: 'payments', route: '/my/fees', module: 'fees' },
    { label: 'Complaints', icon: 'build_circle', route: '/my/complaints', module: 'complaints' },
    { label: 'Alerts', icon: 'notifications', route: '/my/notifications', badge: true },
  ];

  /** Built once: a fresh array every check would re-create the links (see the sidebar). */
  readonly items: BottomItem[] = this.visibleItems();

  private visibleItems(): BottomItem[] {
    const on = new Set(this.tenant.enabledModules.map((m) => m.key));
    return this.all.filter((i) => !i.module || on.has(i.module));
  }
}
