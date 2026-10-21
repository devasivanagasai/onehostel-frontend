import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { provideNativeDateAdapter } from '@angular/material/core';
import { HOSTEL_TYPES, REPORT_HOSTELS, ReportHostel } from '../reports/report.models';
import { MOCK_PAYMENTS, MOCK_SUBSCRIPTIONS } from '../subscription-payments/subscription-payment.models';
import { AdminService } from '../admin-management/admin.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { AuditEvent, AuditLog } from '../../core/models/audit.models';
import { AuthService } from '../../core/services/auth.service';
import { AppNotification, NotificationService, relativeTime } from '../../core/services/notification.service';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

const ALL = 'All';
const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 30;
const RECENT_ACTIVITY_LIMIT = 8;
const RECENT_NOTIFICATION_LIMIT = 5;

type CardFormat = 'count' | 'inr';

/** Icon colour for a stat tile (visual only). */
type CardTone = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal';

interface SummaryCard {
  label: string;
  tone?: CardTone;
  value: number;
  format: CardFormat;
  icon: string;
  sub: string;
  route: string;
  queryParams?: Record<string, string>;
}

interface CardGroup {
  title: string;
  /** Snapshot groups ignore the date range; shown so the numbers aren't misread. */
  scope: 'today' | 'period';
  cards: SummaryCard[];
}

/** One bar in "Occupancy by Hostel". */
interface HostelOccupancy {
  name: string;
  occupied: number;
  beds: number;
  /** 0–100 */
  pct: number;
}

interface QuickAction {
  label: string;
  icon: string;
  route: string;
  /** The primary action gets the dashed "+" tile. */
  primary?: boolean;
}

/** Shortcuts to the most common Admin tasks. */
const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Onboard Hostel', icon: 'add', route: '/hostel-onboarding/new', primary: true },
  { label: 'Create Template', icon: 'post_add', route: '/communication-templates/new' },
  { label: 'Subscription Plans', icon: 'card_membership', route: '/subscription-plans' },
  { label: 'Admin Management', icon: 'manage_accounts', route: '/admins' },
  { label: 'Payments', icon: 'payments', route: '/subscription-payments' },
  { label: 'Reports', icon: 'bar_chart', route: '/reports' },
];

interface ActivityRow {
  timestamp: string;
  activity: string;
  hostel: string;
  user: string;
  status: 'Success' | 'Failed';
  details?: string;
}

interface AttentionItem {
  icon: string;
  tone: 'danger' | 'warning';
  text: string;
  route: string;
  queryParams?: Record<string, string>;
}

/** Audit events shown as "Recent Activity", with their dashboard wording. Sign-ins are left out as noise. */
const ACTIVITY_LABELS: Partial<Record<AuditEvent, string>> = {
  'Create Hostel': 'Hostel Created',
  'Update Hostel': 'Hostel Updated',
  'Activate Hostel': 'Hostel Activated',
  'Deactivate Hostel': 'Hostel Deactivated',
  'Create Admin': 'Hostel Owner Created',
  'Update Admin': 'Hostel Owner Updated',
  'Activate Admin': 'Hostel Owner Activated',
  'Deactivate Admin': 'Hostel Owner Deactivated',
  'Lock Admin': 'Hostel Owner Locked',
  'Unlock Admin': 'Hostel Owner Unlocked',
  'Reset Password': 'Password Reset',
  'Create Plan': 'Plan Created',
  'Update Plan': 'Plan Updated',
  'Activate Plan': 'Plan Activated',
  'Deactivate Plan': 'Plan Deactivated',
  'Create Template': 'Template Created',
  'Update Template': 'Template Updated',
  'Change Settings': 'System Defaults Changed',
};

const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Admin landing page: platform-wide counts, money and recent activity,
 * computed from the same data the individual modules use so every number here
 * matches the module it links to.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    AppDatePipe,
    AppCurrencyPipe,
    AppButtonComponent,
    CommonModule,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatIconModule,
    MatTooltipModule,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  // ---- Filters ----
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  hostelFilter = ALL;
  typeFilter = ALL;
  planFilter = ALL;
  statusFilter = ALL;

  readonly hostelNames = REPORT_HOSTELS.map((h) => h.hostelName).sort();
  readonly hostelTypes = HOSTEL_TYPES;
  readonly plans = [...new Set(REPORT_HOSTELS.map((h) => h.plan))].sort();
  readonly statuses = ['Active', 'Inactive'];
  readonly expiringWindowDays = EXPIRING_WINDOW_DAYS;

  /** Shortcuts the signed-in user may open (they all lead to Admin modules). */
  get quickActions(): QuickAction[] {
    return QUICK_ACTIONS.filter((q) => this.auth.canAccess(q.route));
  }

  /** Admin modules are Admin-only; links to them are hidden or inactive for other roles. */
  canAccess(route: string): boolean {
    return this.auth.canAccess(route);
  }
  readonly relativeTime = relativeTime;
  readonly today = new Date();

  constructor(
    private adminService: AdminService,
    private auditLog: AuditLogService,
    private auth: AuthService,
    private notificationService: NotificationService,
    private router: Router,
  ) {}

  // ---- Greeting ----

  /** First name of the signed-in Admin, for "Hello, Rakesh". */
  get firstName(): string {
    return (this.auth.currentUser?.name || 'Admin').trim().split(/\s+/)[0];
  }

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // ---- Recent notifications (same feed as the header bell) ----

  get recentNotifications(): AppNotification[] {
    return this.notificationService.notifications.slice(0, RECENT_NOTIFICATION_LIMIT);
  }

  get unreadNotifications(): number {
    return this.notificationService.unreadCount;
  }

  markAllNotificationsRead(): void {
    this.notificationService.markAllRead();
  }

  openNotification(n: AppNotification): void {
    this.notificationService.markRead(n.id);
    if (n.route) this.router.navigateByUrl(n.route);
  }

  get hasFilters(): boolean {
    return !!(
      this.dateFrom ||
      this.dateTo ||
      this.hostelFilter !== ALL ||
      this.typeFilter !== ALL ||
      this.planFilter !== ALL ||
      this.statusFilter !== ALL
    );
  }

  get hasDateRange(): boolean {
    return !!(this.dateFrom || this.dateTo);
  }

  resetFilters(): void {
    this.dateFrom = this.dateTo = null;
    this.hostelFilter = this.typeFilter = this.planFilter = this.statusFilter = ALL;
  }

  private inRange(isoDate: string): boolean {
    const day = isoDate.slice(0, 10);
    if (this.dateFrom && day < toIsoDate(this.dateFrom)) return false;
    if (this.dateTo && day > toIsoDate(this.dateTo)) return false;
    return true;
  }

  /** Hostels matching the hostel-level filters; every card is scoped to these. */
  get hostels(): ReportHostel[] {
    return REPORT_HOSTELS.filter(
      (h) =>
        (this.hostelFilter === ALL || h.hostelName === this.hostelFilter) &&
        (this.typeFilter === ALL || h.hostelType === this.typeFilter) &&
        (this.planFilter === ALL || h.plan === this.planFilter) &&
        (this.statusFilter === ALL || h.status === this.statusFilter),
    );
  }

  private get hostelNameSet(): Set<string> {
    return new Set(this.hostels.map((h) => h.hostelName));
  }

  // ---- Summary cards ----

  get groups(): CardGroup[] {
    const hostels = this.hostels;
    const names = this.hostelNameSet;
    const ids = new Set(hostels.map((h) => h.hostelId));

    const active = hostels.filter((h) => h.status === 'Active').length;
    const admins = this.adminService.admins.filter((a) => ids.has(a.hostelId));
    const activeAdmins = admins.filter((a) => a.status === 'Active').length;

    const current = hostels.reduce((s, h) => s + h.activeResidents, 0);
    const checkedOut = hostels.reduce((s, h) => s + h.checkedOutResidents, 0);
    const beds = hostels.reduce((s, h) => s + h.totalBeds, 0);
    const occupancy = beds ? Math.round((current / beds) * 100) : 0;

    const subs = MOCK_SUBSCRIPTIONS.filter((s) => names.has(s.hostelName));
    const activeSubs = subs.filter((s) => s.status === 'Active').length;
    const trialSubs = subs.filter((s) => s.status === 'Trial').length;
    const expiring = this.expiringSubscriptions.length;

    const payments = MOCK_PAYMENTS.filter((p) => names.has(p.hostelName) && this.inRange(p.paymentDate));
    const paid = payments.filter((p) => p.paymentStatus === 'Paid');
    const pending = payments.filter((p) => p.paymentStatus === 'Pending');
    const revenue = paid.reduce((s, p) => s + p.totalAmount, 0);
    const pendingAmount = pending.reduce((s, p) => s + p.totalAmount, 0);

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    return [
      {
        title: 'Hostels',
        scope: 'today',
        cards: [
          { label: 'Total Hostels', tone: 'blue', value: hostels.length, format: 'count', icon: 'apartment', sub: `${plural(new Set(hostels.map((h) => h.city)).size, 'city')}`, route: '/hostel-onboarding' },
          { label: 'Active Hostels', tone: 'green', value: active, format: 'count', icon: 'check_circle', sub: hostels.length ? `${Math.round((active / hostels.length) * 100)}% of hostels` : '—', route: '/reports' },
          { label: 'Inactive Hostels', tone: 'amber', value: hostels.length - active, format: 'count', icon: 'pause_circle', sub: 'Suspended or cancelled', route: '/reports' },
          { label: 'Total Hostel Owners', tone: 'purple', value: admins.length, format: 'count', icon: 'manage_accounts', sub: `${activeAdmins} active`, route: '/admins' },
        ],
      },
      {
        title: 'Tenants & Beds',
        scope: 'today',
        cards: [
          { label: 'Total Tenants', tone: 'teal', value: current + checkedOut, format: 'count', icon: 'groups', sub: `${current.toLocaleString('en-IN')} currently staying`, route: '/reports' },
          { label: 'Total Beds', tone: 'blue', value: beds, format: 'count', icon: 'bed', sub: `Across ${plural(hostels.length, 'hostel')}`, route: '/reports' },
          { label: 'Occupied Beds', tone: 'green', value: current, format: 'count', icon: 'hotel', sub: `${occupancy}% occupancy`, route: '/reports' },
          { label: 'Available Beds', tone: 'amber', value: beds - current, format: 'count', icon: 'event_available', sub: `${100 - occupancy}% free`, route: '/reports' },
        ],
      },
      {
        title: 'Subscriptions & Revenue',
        scope: 'period',
        cards: [
          { label: 'Active Subscriptions', tone: 'green', value: activeSubs, format: 'count', icon: 'card_membership', sub: trialSubs ? `+ ${plural(trialSubs, 'trial')}` : 'Paid plans', route: '/subscription-payments' },
          { label: 'Expiring Subscriptions', tone: 'red', value: expiring, format: 'count', icon: 'event_busy', sub: `In the next ${EXPIRING_WINDOW_DAYS} days`, route: '/subscription-payments' },
          { label: 'Total Revenue', tone: 'teal', value: revenue, format: 'inr', icon: 'account_balance_wallet', sub: `${plural(paid.length, 'paid transaction')}, incl. GST`, route: '/reports' },
          { label: 'Pending Payments', tone: 'amber', value: pendingAmount, format: 'inr', icon: 'pending_actions', sub: pending.length ? `${plural(pending.length, 'invoice')} awaiting payment` : 'Nothing pending', route: '/subscription-payments' },
        ],
      },
    ];
  }

  // ---- Bed occupancy (charts) ----

  /** Occupied vs total beds across the filtered hostels (same numbers as the Residents & Beds tiles). */
  get bedStats(): { occupied: number; beds: number; available: number; pct: number } {
    const occupied = this.hostels.reduce((s, h) => s + h.activeResidents, 0);
    const beds = this.hostels.reduce((s, h) => s + h.totalBeds, 0);
    return { occupied, beds, available: beds - occupied, pct: beds ? Math.round((occupied / beds) * 100) : 0 };
  }

  /** Donut ring geometry: circumference for r = 52. */
  readonly ringCircumference = 2 * Math.PI * 52;

  /** Per-hostel occupancy, fullest first. */
  get hostelOccupancy(): HostelOccupancy[] {
    return this.hostels
      .map((h) => ({
        name: h.hostelName,
        occupied: h.activeResidents,
        beds: h.totalBeds,
        pct: h.totalBeds ? Math.round((h.activeResidents / h.totalBeds) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }

  /** Live subscriptions whose expiry falls within the window, soonest first. */
  get expiringSubscriptions() {
    const names = this.hostelNameSet;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return MOCK_SUBSCRIPTIONS.filter((s) => names.has(s.hostelName) && ['Active', 'Trial', 'Payment Pending'].includes(s.status))
      .map((s) => ({ ...s, daysLeft: Math.round((new Date(`${s.expiryDate}T00:00:00`).getTime() - today.getTime()) / DAY_MS) }))
      .filter((s) => s.daysLeft >= 0 && s.daysLeft <= EXPIRING_WINDOW_DAYS)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  // ---- Recent activity ----

  /** Resolves an audit entry to the hostel it concerns: hostel name directly, or via the admin's username. */
  private hostelFor(log: AuditLog): string {
    if (REPORT_HOSTELS.some((h) => h.hostelName === log.entity)) return log.entity;
    const admin = this.adminService.admins.find((a) => a.username === log.entity);
    return admin?.hostelName ?? '—';
  }

  get recentActivity(): ActivityRow[] {
    const names = this.hostelNameSet;
    const hostelScoped = this.hostelFilter !== ALL || this.typeFilter !== ALL || this.planFilter !== ALL || this.statusFilter !== ALL;

    return this.auditLog.logs
      .filter((l) => ACTIVITY_LABELS[l.event] && this.inRange(l.timestamp))
      .map((l) => ({
        timestamp: l.timestamp,
        activity: ACTIVITY_LABELS[l.event]!,
        hostel: this.hostelFor(l),
        user: l.user,
        status: l.status,
        details: l.details,
      }))
      // Platform-wide entries (plans, templates, settings) have no hostel; hide them once the view is narrowed to hostels.
      .filter((r) => !hostelScoped || names.has(r.hostel))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, RECENT_ACTIVITY_LIMIT);
  }

  // ---- Needs attention ----

  get attention(): AttentionItem[] {
    const ids = new Set(this.hostels.map((h) => h.hostelId));
    const names = this.hostelNameSet;
    const items: AttentionItem[] = [];

    const locked = this.adminService.admins.filter((a) => ids.has(a.hostelId) && a.status === 'Locked');
    if (locked.length) {
      items.push({
        icon: 'lock',
        tone: 'danger',
        text: `${locked.length} hostel owner account${locked.length > 1 ? 's are' : ' is'} locked`,
        route: '/admins',
      });
    }

    const pendingSubs = MOCK_SUBSCRIPTIONS.filter((s) => names.has(s.hostelName) && s.status === 'Payment Pending');
    pendingSubs.forEach((s) =>
      items.push({ icon: 'pending_actions', tone: 'warning', text: `${s.hostelName} — payment pending`, route: '/subscription-payments' }),
    );

    this.expiringSubscriptions
      .filter((s) => s.daysLeft <= 7)
      .forEach((s) =>
        items.push({
          icon: 'event_busy',
          tone: s.daysLeft <= 2 ? 'danger' : 'warning',
          text: `${s.hostelName} — ${s.status === 'Trial' ? 'trial' : 'subscription'} ${s.daysLeft === 0 ? 'expires today' : `expires in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`}`,
          route: '/subscription-payments',
        }),
      );

    const weekAgo = toIsoDate(new Date(Date.now() - 7 * DAY_MS));
    const failedLogins = this.auditLog.logs.filter((l) => l.event === 'Login' && l.status === 'Failed' && l.timestamp.slice(0, 10) >= weekAgo);
    if (failedLogins.length) {
      items.push({
        icon: 'gpp_bad',
        tone: 'danger',
        text: `${failedLogins.length} failed platform login${failedLogins.length > 1 ? 's' : ''} in the last 7 days`,
        route: '/audit-logs',
        queryParams: { event: 'Login' },
      });
    }

    // Every item opens an Admin module, so only Admins see them.
    return items.filter((item) => this.auth.canAccess(item.route));
  }
}
