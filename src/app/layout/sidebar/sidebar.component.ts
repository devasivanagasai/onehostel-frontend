import { Component, DestroyRef, Input, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { TENANT_MODULES, tenantRoute } from '../../core/models/tenant.models';

export interface NavItem {
  label: string;
  icon: string;
  route: string;
  hasSubmenu?: boolean;
}

export interface NavSection {
  sectionTitle?: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  /** When true, shrinks to an icon-only rail (labels shown as tooltips instead). */
  @Input() collapsed = false;

  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  private readonly router = inject(Router);

  /** Titled groups (the Tenant menu) fold away; the group holding the current page opens by itself. */
  private open: Record<string, boolean> = this.loadOpen();

  constructor() {
    this.openGroupOf(this.router.url);
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((e) => this.openGroupOf((e as NavigationEnd).urlAfterRedirects));
  }

  isOpen(section: NavSection): boolean {
    return !section.sectionTitle || this.collapsed || !!this.open[section.sectionTitle];
  }

  toggle(section: NavSection): void {
    if (!section.sectionTitle) return;
    this.open = { ...this.open, [section.sectionTitle]: !this.open[section.sectionTitle] };
    this.saveOpen();
  }

  private openGroupOf(url: string): void {
    const path = url.split(/[?#]/)[0];
    const group = this.navSections.find((s) => s.sectionTitle && s.items.some((i) => path === i.route || path.startsWith(i.route + '/')));
    if (group?.sectionTitle && !this.open[group.sectionTitle]) {
      this.open = { ...this.open, [group.sectionTitle]: true };
      this.saveOpen();
    }
  }

  private loadOpen(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(GROUPS_KEY);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* use the defaults */
    }
    return { 'My Stay': true, 'Requests & Updates': true };
  }

  private saveOpen(): void {
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(this.open));
    } catch {
      /* not remembered */
    }
  }

  /**
   * Menu for the signed-in user, filtered by role through AuthService.canAccess():
   * Hostel Owner modules (Rooms & Beds, Residents, Fees & Payments, Complaints, Announcements, Reports,
   * Hostel Settings) for Hostel Owners only,
   * Admin modules for Admins only.
   */
  get navSections(): NavSection[] {
    // Built once per role combination and reused: a fresh array on every check would re-create the menu links,
    // and each new routerLinkActive schedules another check — an endless render loop (white screen).
    const cacheKey = `${this.auth.isAdmin}_${this.auth.isHostelOwner}_${this.auth.isTenant}`;
    if (!this.cachedSections || this.cachedRoleKey !== cacheKey) {
      this.cachedRoleKey = cacheKey;
      this.cachedSections = ALL_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => this.auth.canAccess(item.route) && this.tenant.isRouteEnabled(item.route)),
      })).filter((section) => section.items.length > 0); // drop sections the role sees nothing in
    }
    return this.cachedSections;
  }

  private cachedSections?: NavSection[];
  private cachedRoleKey?: string;
}

const GROUPS_KEY = 'onehostel_sidebar_groups_v1';

/** Tenant pages, grouped as in the FRD navigation (Home / My Hostel / Payments / Services / Updates / Profile). */
const TENANT_SECTIONS: NavSection[] = (['My Stay', 'Requests & Updates', 'Daily Services', 'More'] as const).map((group) => ({
  sectionTitle: group,
  items: TENANT_MODULES.filter((m) => m.group === group).map((m) => ({ label: m.label, icon: m.icon, route: tenantRoute(m.key) })),
}));

const ALL_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: 'home', route: '/dashboard' },
      { label: 'Rooms & Beds', icon: 'meeting_room', route: '/rooms' },
      { label: 'Residents', icon: 'groups', route: '/residents' },
      { label: 'Fees & Payments', icon: 'payments', route: '/fees' },
      { label: 'Complaints', icon: 'build_circle', route: '/complaints' },
      { label: 'Laundry & Machines', icon: 'local_laundry_service', route: '/laundry' },
      { label: 'Visitors', icon: 'badge', route: '/visitors' },
      { label: 'Mess & Food', icon: 'restaurant_menu', route: '/mess' },
      { label: 'Leave & Outpass', icon: 'exit_to_app', route: '/leave-outpass' },
      { label: 'Attendance', icon: 'fact_check', route: '/attendance' },
      { label: 'Parcels', icon: 'inventory_2', route: '/parcels' },
      { label: 'Announcements', icon: 'campaign', route: '/announcements' },
      { label: 'Reports', icon: 'bar_chart', route: '/hostel-reports' },
      { label: 'Staff', icon: 'badge', route: '/staff' },
      { label: 'Guardians', icon: 'family_restroom', route: '/guardians' },
      { label: 'Academic Years', icon: 'school', route: '/academic-years' },
      { label: 'Disciplinary', icon: 'gavel', route: '/disciplinary' },
      { label: 'Analytics', icon: 'insights', route: '/analytics' },
      { label: 'Permissions & Audit', icon: 'admin_panel_settings', route: '/permissions' },
      { label: 'Hostel Settings', icon: 'settings', route: '/hostel-settings' },
      { label: 'Onboard Hostel', icon: 'apartment', route: '/hostel-onboarding' },
      { label: 'Subscription Plans', icon: 'credit_card', route: '/subscription-plans' },
      { label: 'Communication Templates', icon: 'campaign', route: '/communication-templates' },
      { label: 'Admin Management', icon: 'manage_accounts', route: '/admins' },
      { label: 'Subscription & Payment', icon: 'payments', route: '/subscription-payments' },
      { label: 'Reports', icon: 'bar_chart', route: '/reports' },
      { label: 'Audit Logs', icon: 'assignment', route: '/audit-logs' },
      { label: 'System Defaults', icon: 'settings', route: '/settings' },
    ],
  },
  ...TENANT_SECTIONS,
];
