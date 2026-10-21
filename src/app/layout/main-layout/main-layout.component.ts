import { Component, DestroyRef, ElementRef, ViewChild } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { filter, map, shareReplay, take } from 'rxjs';
import { AppHeaderComponent } from '../../shared/components/header/app-header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BreadcrumbComponent } from '../../shared/components/breadcrumb/breadcrumb.component';
import { AuthService } from '../../core/services/auth.service';
import { AccountService } from '../../core/services/account.service';
import { SessionTimeoutService } from '../../core/services/session-timeout.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet, MatSidenavModule, AppHeaderComponent, SidebarComponent, BreadcrumbComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
})
export class MainLayoutComponent {
  @ViewChild('pageScroller') private pageScroller?: ElementRef<HTMLElement>;

  sidenavOpened = true;
  /** Icon-only rail mode for the desktop sidebar, toggled from the header's menu button. */
  sidebarCollapsed = false;
  pageTitle = 'Institution';
  pageSubtitle?: string;

  readonly currentUser$ = this.authService.currentUser$;

  readonly isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset).pipe(
    map((result) => result.matches),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  constructor(
    private breakpointObserver: BreakpointObserver,
    private authService: AuthService,
    private router: Router,
    // Injected so the signed-in user's profile name/photo is applied to the header from the start.
    _account: AccountService,
    sessionTimeout: SessionTimeoutService,
    destroyRef: DestroyRef,
  ) {
    // Settings → Security → Session Timeout: sign out after that much inactivity.
    sessionTimeout.start();
    destroyRef.onDestroy(() => sessionTimeout.stop());

    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;
      this.pageSubtitle = undefined;
      // Only the page area scrolls (headers are fixed), so start each new page at the top.
      this.pageScroller?.nativeElement.scrollTo({ top: 0 });

      if (url.includes('change-password')) {
        this.pageTitle = 'Change Password';
        this.pageSubtitle = 'Keep your account secure with a strong, unique password';
      } else if (url.includes('profile')) {
        this.pageTitle = 'My Profile';
        this.pageSubtitle = 'View and update your personal details';
      } else if (url.includes('hostel-onboarding/new')) {
        this.pageTitle = 'Onboard New Hostel';
        this.pageSubtitle = 'Complete all 7 steps to add a new hostel and its owner to the platform.';
      } else if (url.includes('hostel-onboarding') && url.includes('/edit')) {
        this.pageTitle = 'Edit Hostel';
        this.pageSubtitle = 'Update this hostel and its owner details across all 7 steps.';
      } else if (url.includes('dashboard')) {
        this.pageTitle = 'Dashboard';
      } else if (url.startsWith('/laundry')) {
        this.pageTitle = 'Laundry & Washing Machines';
        this.pageSubtitle = 'Configure services and machines, manage slots, bookings and charges';
      } else if (url.startsWith('/visitors')) {
        this.pageTitle = 'Visitor Management';
        this.pageSubtitle = 'Register visitors, approve requests and record entry and exit';
      } else if (url.startsWith('/mess')) {
        this.pageTitle = 'Mess & Food Management';
        this.pageSubtitle = 'Plan and publish menus, track meal attendance and dietary notes';
      } else if (url.startsWith('/leave-outpass')) {
        this.pageTitle = 'Leave & Outpass';
        this.pageSubtitle = 'Review leave and outpass requests and record resident movement';
      } else if (url.startsWith('/attendance')) {
        this.pageTitle = 'Attendance & Check-in';
        this.pageSubtitle = 'Daily attendance, check-ins, check-outs and corrections';
      } else if (url.startsWith('/parcels')) {
        this.pageTitle = 'Parcel Management';
        this.pageSubtitle = 'Log parcels, notify residents and record pickups';
      } else if (url.startsWith('/announcements')) {
        this.pageTitle = 'Announcements & Communication';
        this.pageSubtitle = 'Compose, schedule and publish notices to your residents';
      } else if (url.startsWith('/hostel-reports')) {
        this.pageTitle = 'Reports';
        this.pageSubtitle = 'Residents, occupancy, collections, dues and complaints for your hostel';
      } else if (url.startsWith('/hostel-settings')) {
        this.pageTitle = 'Hostel Profile & Settings';
        this.pageSubtitle = 'Hostel details, rules, facilities, notifications and subscription';
      } else if (url.startsWith('/complaints')) {
        this.pageTitle = 'Complaints & Maintenance';
        this.pageSubtitle = 'Review resident complaints, assign staff, track progress and resolve issues';
      } else if (url.startsWith('/fees')) {
        this.pageTitle = 'Fees & Payments';
        this.pageSubtitle = 'Configure resident fees, generate charges, record payments and send reminders';
      } else if (url.includes('residents')) {
        this.pageTitle = 'Residents';
        this.pageSubtitle = 'Add residents, allocate beds, send activation invites and manage check-outs';
      } else if (url.includes('rooms')) {
        this.pageTitle = 'Rooms & Beds Management';
        this.pageSubtitle = 'Configure floors, room types, monitor bed allocations, and manage tenant check-ins';
      } else if (url.includes('hostel-onboarding')) {
        this.pageTitle = 'Onboard Hostel';
      } else if (url.includes('subscription-plans')) {
        this.pageTitle = 'Subscription Plans';
        this.pageSubtitle = 'Create, manage and customize your pricing plans.';
      } else if (url.includes('subscription-payments')) {
        this.pageTitle = 'Subscription & Payment';
      } else if (url.includes('communication-templates/new')) {
        this.pageTitle = 'Create New Template';
        this.pageSubtitle = 'Set up the message sent to users when an event happens';
      } else if (url.includes('communication-templates/') && url.includes('/edit')) {
        this.pageTitle = 'Edit Template';
        this.pageSubtitle = 'Update the message sent to users when this event happens';
      } else if (url.includes('communication-templates/')) {
        this.pageTitle = 'View Template';
        this.pageSubtitle = 'Review the message sent to users when this event happens';
      } else if (url.includes('communication-templates')) {
        this.pageTitle = 'Communication Templates';
        this.pageSubtitle = 'Manage and customize all your email, SMS and push notification templates';
      } else if (url.includes('institution') || url.includes('hostels')) {
        this.pageTitle = 'Institution';
      } else if (url.startsWith('/admins')) {
        this.pageTitle = 'Admin Management';
        this.pageSubtitle = 'Manage hostel owners and tenants across all onboarded hostels';
      } else if (url.includes('reports')) {
        this.pageTitle = 'Reports';
      } else if (url.includes('audit-logs')) {
        this.pageTitle = 'Audit Logs';
      } else if (url.includes('settings')) {
        this.pageTitle = 'System Defaults';
        this.pageSubtitle = 'Platform-wide defaults for branding, security, payments and fees.';
      } else {
        this.pageTitle = 'Institution';
      }
    });
  }

  /** On mobile this opens/closes the overlay drawer; on desktop it collapses/expands the rail instead. */
  toggleSidenav(): void {
    this.isHandset$.pipe(take(1)).subscribe((isHandset) => {
      if (isHandset) {
        this.sidenavOpened = !this.sidenavOpened;
      } else {
        this.sidebarCollapsed = !this.sidebarCollapsed;
      }
    });
  }

  onLogout(): void {
    this.authService.logout();
  }

  onProfile(): void {
    this.router.navigate(['/profile']);
  }

  onChangePassword(): void {
    this.router.navigate(['/change-password']);
  }

  onGlobalSearchNavigate(route: string): void {
    this.router.navigate([route]);
  }
}
