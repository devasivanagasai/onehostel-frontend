import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';

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
        items: section.items.filter((item) => this.auth.canAccess(item.route)),
      }));
    }
    return this.cachedSections;
  }

  private cachedSections?: NavSection[];
  private cachedRoleKey?: string;
}

const ALL_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: 'home', route: '/dashboard' },
      { label: 'Rooms & Beds', icon: 'meeting_room', route: '/rooms' },
      { label: 'Residents', icon: 'groups', route: '/residents' },
      { label: 'Fees & Payments', icon: 'payments', route: '/fees' },
      { label: 'Complaints', icon: 'build_circle', route: '/complaints' },
      { label: 'Announcements', icon: 'campaign', route: '/announcements' },
      { label: 'Reports', icon: 'bar_chart', route: '/hostel-reports' },
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
];
