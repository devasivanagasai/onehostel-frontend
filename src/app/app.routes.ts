import { Routes } from '@angular/router';
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
    // Password expiry first, then the Admin-only modules (Hostel Owners and Tenants get the Dashboard).
    canActivateChild: [passwordExpiryGuard, adminGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
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
  { path: '**', redirectTo: 'dashboard' },
];
