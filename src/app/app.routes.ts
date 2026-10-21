import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';
import { passwordExpiryGuard } from './core/guards/password-expiry.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    // Password expiry first, then the role checks (AuthService.canAccess).
    canActivateChild: [passwordExpiryGuard, adminGuard],
    children: [
      // Each role's home page: Admin → onboarding, Hostel Owner → dashboard, Hostel Manager → branch overview.
      { path: '', pathMatch: 'full', redirectTo: () => inject(AuthService).landingRoute },
      {
        path: 'admin/onboarding',
        loadComponent: () =>
          import('./features/hostel-onboarding/hostel-onboarding.component').then(
            (m) => m.HostelOnboardingComponent,
          ),
      },
      {
        path: 'owner/dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        // The manager's own overview page isn't built yet; the Dashboard shows the hostel modules they can use.
        path: 'manager/branch-overview',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'rooms',
        loadComponent: () =>
          import('./features/rooms-management/rooms-management.component').then(
            (m) => m.RoomsManagementComponent,
          ),
      },
      {
        path: 'residents',
        loadComponent: () =>
          import('./features/residents/residents.component').then((m) => m.ResidentsComponent),
      },
      {
        path: 'fees',
        loadComponent: () =>
          import('./features/fees-payments/fees-payments.component').then((m) => m.FeesPaymentsComponent),
      },
      {
        path: 'complaints',
        loadComponent: () =>
          import('./features/complaints/complaints.component').then((m) => m.ComplaintsComponent),
      },
      {
        path: 'laundry',
        loadComponent: () => import('./features/laundry/laundry.component').then((m) => m.LaundryComponent),
      },
      {
        path: 'visitors',
        loadComponent: () => import('./features/visitors/visitors.component').then((m) => m.VisitorsComponent),
      },
      {
        path: 'mess',
        loadComponent: () => import('./features/mess/mess.component').then((m) => m.MessComponent),
      },
      {
        path: 'leave-outpass',
        loadComponent: () => import('./features/leave-outpass/leave-outpass.component').then((m) => m.LeaveOutpassComponent),
      },
      {
        path: 'attendance',
        loadComponent: () => import('./features/attendance/attendance.component').then((m) => m.AttendanceComponent),
      },
      {
        path: 'parcels',
        loadComponent: () => import('./features/parcels/parcels.component').then((m) => m.ParcelsComponent),
      },
      {
        path: 'announcements',
        loadComponent: () =>
          import('./features/announcements/announcements.component').then((m) => m.AnnouncementsComponent),
      },
      {
        path: 'hostel-reports',
        loadComponent: () =>
          import('./features/hostel-reports/hostel-reports.component').then((m) => m.HostelReportsComponent),
      },
      {
        path: 'hostel-settings',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/hostel-settings/hostel-settings.component').then((m) => m.HostelSettingsComponent),
      },
      {
        path: 'hostel-onboarding',
        loadComponent: () =>
          import('./features/hostel-onboarding/hostel-onboarding.component').then(
            (m) => m.HostelOnboardingComponent,
          ),
      },
      {
        path: 'hostel-onboarding/new',
        loadComponent: () =>
          import('./features/hostel-onboarding/add-hostel/add-hostel.component').then(
            (m) => m.AddHostelComponent,
          ),
      },
      {
        path: 'hostel-onboarding/:id/edit',
        loadComponent: () =>
          import('./features/hostel-onboarding/add-hostel/add-hostel.component').then(
            (m) => m.AddHostelComponent,
          ),
      },
      {
        path: 'subscription-plans',
        loadComponent: () =>
          import('./features/subscription-plans/subscription-plans.component').then(
            (m) => m.SubscriptionPlansComponent,
          ),
      },
      // Admin Management: Hostel Owners and Tenants.
      // "/users" was its address for a while; keep it working.
      { path: 'users', redirectTo: 'admins', pathMatch: 'full' },
      {
        path: 'admins',
        loadComponent: () =>
          import('./features/user-management/user-management.component').then((m) => m.UserManagementComponent),
      },
      {
        path: 'subscription-payments',
        loadComponent: () =>
          import('./features/subscription-payments/subscription-payments.component').then(
            (m) => m.SubscriptionPaymentsComponent,
          ),
      },
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'settings',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/system-defaults/system-defaults.component').then((m) => m.SystemDefaultsComponent),
      },
      {
        path: 'audit-logs',
        loadComponent: () =>
          import('./features/audit-logs/audit-logs.component').then((m) => m.AuditLogsComponent),
      },
      {
        path: 'communication-templates',
        loadComponent: () =>
          import('./features/communication-templates/communication-templates.component').then(
            (m) => m.CommunicationTemplatesComponent,
          ),
      },
      {
        path: 'communication-templates/new',
        canDeactivate: [unsavedChangesGuard],
        data: { mode: 'add' },
        loadComponent: () =>
          import('./features/communication-templates/template-editor.component').then(
            (m) => m.TemplateEditorComponent,
          ),
      },
      {
        path: 'communication-templates/:id/edit',
        canDeactivate: [unsavedChangesGuard],
        data: { mode: 'edit' },
        loadComponent: () =>
          import('./features/communication-templates/template-editor.component').then(
            (m) => m.TemplateEditorComponent,
          ),
      },
      {
        path: 'communication-templates/:id',
        data: { mode: 'view' },
        loadComponent: () =>
          import('./features/communication-templates/template-editor.component').then(
            (m) => m.TemplateEditorComponent,
          ),
      },
      {
        path: 'profile',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/account/profile/profile.component').then((m) => m.ProfileComponent),
      },
      {
        path: 'change-password',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/account/change-password/change-password.component').then(
            (m) => m.ChangePasswordComponent,
          ),
      },
      {
        path: 'institution',
        loadComponent: () =>
          import('./features/hostel-onboarding/hostel-onboarding.component').then(
            (m) => m.HostelOnboardingComponent,
          ),
      },
      {
        path: 'hostels',
        loadComponent: () =>
          import('./features/hostel-onboarding/hostel-onboarding.component').then(
            (m) => m.HostelOnboardingComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: () => inject(AuthService).landingRoute },
];
