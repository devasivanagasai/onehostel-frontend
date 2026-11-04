import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { combineLatest, map } from 'rxjs';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { TenantNotificationService } from '../../core/services/tenant-notification.service';
import { FeesService } from '../../core/services/fees.service';
import { ComplaintsService } from '../../core/services/complaints.service';
import { HostelSettingsService } from '../../core/services/hostel-settings.service';
import { TenantComplaintsService } from '../../core/services/tenant-complaints.service';
import { TenantPreferencesService } from '../../core/services/tenant-preferences.service';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { localDateIso } from '../../shared/utils/local-date';

/**
 * Tenant home (FRD 5.2): room, dues, complaints, notices, notifications and quick actions, all for the
 * signed-in Tenant only. Cards open their detail pages; pages whose module is off for the hostel are hidden.
 */
@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [AsyncPipe, RouterLink, MatIconModule, AppCurrencyPipe],
  template: `
    @if (vm$ | async; as vm) {
      <div class="td">
        <header class="td__head">
          <h1>Hello, {{ vm.firstName }} 👋</h1>
          <p>{{ vm.hostel }} · {{ vm.today }}</p>
        </header>

        @if (vm.noRecord) {
          <p class="td__empty" role="alert">We could not find your resident record. Please contact your hostel office.</p>
        } @else {
          <section class="td__actions" aria-label="Quick actions">
            @for (a of vm.actions; track a.label) {
              <a class="td__action" [routerLink]="a.route"><mat-icon fontSet="material-icons-outlined">{{ a.icon }}</mat-icon>{{ a.label }}</a>
            }
          </section>

          <section class="td__grid">
            <a class="td__card" routerLink="/my/hostel" aria-label="My hostel and room">
              <mat-icon fontSet="material-icons-outlined">meeting_room</mat-icon>
              <h2>My Room</h2>
              @if (vm.room) {
                <strong>Room {{ vm.room.number }} · Bed {{ vm.room.bed }}</strong>
                <span>{{ vm.room.where }}</span>
              } @else {
                <strong>No bed allocated yet</strong>
                <span>Your hostel office will allocate one.</span>
              }
            </a>

            @if (vm.feesOn) {
              <a class="td__card" routerLink="/my/fees" aria-label="Fees and payments">
                <mat-icon fontSet="material-icons-outlined">payments</mat-icon>
                <h2>Fees</h2>
                <strong [class.td__bad]="vm.fees.overdue > 0">{{ vm.fees.outstanding | appCurrency }}</strong>
                <span>
                  {{ vm.fees.outstanding > 0 ? 'outstanding' : 'all paid up' }}
                  @if (vm.fees.nextDue) { · next due {{ vm.fees.nextDue }} }
                  @if (vm.fees.overdue > 0) { · {{ vm.fees.overdue }} overdue }
                </span>
                <span>Latest payment: {{ vm.fees.latestPayment }}</span>
              </a>
            }

            @if (vm.complaintsOn) {
              <a class="td__card" routerLink="/my/complaints" aria-label="Complaints">
                <mat-icon fontSet="material-icons-outlined">build_circle</mat-icon>
                <h2>Complaints</h2>
                <strong>{{ vm.complaints.active }} open</strong>
                <span>{{ vm.complaints.latest }}</span>
              </a>
            }

            <a class="td__card" routerLink="/my/notifications" aria-label="Notifications">
              <mat-icon fontSet="material-icons-outlined">notifications</mat-icon>
              <h2>Notifications</h2>
              <strong>{{ vm.unread }} unread</strong>
              <span>{{ vm.recent.length ? 'Latest: ' + vm.recent[0].title : 'Nothing new' }}</span>
            </a>
          </section>

          <section class="td__card td__list">
            <h2>Recent notifications</h2>
            @for (n of vm.recent; track n.id) {
              <a class="td__row" [routerLink]="n.route || '/my/notifications'">
                <span class="td__dot" [class.on]="!n.read" aria-hidden="true"></span>
                <span class="td__row-main"><strong>{{ n.title }}</strong><small>{{ n.body }}</small></span>
                <small>{{ n.createdAt.slice(0, 10) }}</small>
              </a>
            } @empty {
              <p class="td__empty">No notifications yet.</p>
            }
          </section>

          <section class="td__card td__list" aria-label="Support contact">
            <h2>Need help?</h2>
            <p class="td__support">
              Hostel office: <strong>{{ vm.contact.phone || 'not set' }}</strong>
              @if (vm.contact.email) { · {{ vm.contact.email }} }
              — or open <a routerLink="/my/support">Help &amp; Support</a>. This is not a replacement for emergency services.
            </p>
          </section>
        }
      </div>
    } @else {
      <p class="td__empty" role="status">Loading…</p>
    }
  `,
  styles: [
    `
      .td { display: flex; flex-direction: column; gap: 18px; padding: 10px 0; }
      .td__head h1 { margin: 0; font-size: 22px; color: #0f172a; }
      .td__head p { margin: 4px 0 0; color: #475569; font-size: 14px; }
      .td__actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .td__action { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; background: #fff; color: #0f172a; text-decoration: none; font-size: 13px; font-weight: 600; box-shadow: 0 0 0 1px #e2e8f0; }
      .td__action:hover { background: #f1f5f9; }
      .td__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
      .td__card { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: 14px; background: #fff; text-decoration: none; color: #0f172a; box-shadow: 0 0 0 1px #eef2f7; }
      a.td__card:hover { box-shadow: 0 0 0 1px #cbd5e1; }
      .td__card mat-icon { color: #16a34a; }
      .td__card h2 { margin: 2px 0 0; font-size: 13px; color: #475569; font-weight: 600; }
      .td__card strong { font-size: 18px; }
      .td__card span { font-size: 12.5px; color: #64748b; }
      .td__bad { color: #dc2626; }
      .td__list { gap: 8px; }
      .td__row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #eef2f7; text-decoration: none; color: inherit; }
      .td__row-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .td__row-main small { color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .td__dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; }
      .td__dot.on { background: #2563eb; }
      .td__empty { color: #64748b; margin: 0; }
      .td__support { margin: 0; font-size: 13.5px; color: #334155; }
    `,
  ],
})
export class TenantDashboardComponent {
  private readonly tenant = inject(TenantContextService);
  private readonly notifications = inject(TenantNotificationService);
  private readonly fees = inject(FeesService);
  private readonly complaintsService = inject(ComplaintsService);
  private readonly hostelSettings = inject(HostelSettingsService);
  // Created here so the demo complaints are seeded, and the Tenant's saved theme and text size are applied on sign-in.
  private readonly seedComplaints = inject(TenantComplaintsService);
  private readonly preferences = inject(TenantPreferencesService);

  private readonly feature = (key: string) => this.tenant.enabledModules.some((m) => m.key === key);

  readonly vm$ = combineLatest([
    this.tenant.resident$,
    this.notifications.mine$,
    this.fees.charges$,
    this.fees.payments$,
    this.complaintsService.complaints$,
  ]).pipe(
    map(([resident, mine, charges, payments, complaints]) => {
      const id = this.tenant.residentId;
      const profile = this.hostelSettings.state.value.profile;
      const base = {
        hostel: profile.hostelName,
        today: new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        contact: { phone: profile.phone, email: profile.email },
        feesOn: this.feature('fees'),
        complaintsOn: this.feature('complaints'),
      };
      if (!resident || !id) {
        return { ...base, noRecord: true, firstName: 'there', actions: [], room: undefined, fees: this.emptyFees(), complaints: { active: 0, latest: '' }, unread: 0, recent: [] };
      }

      const today = localDateIso();
      const own = charges.filter((c) => c.residentId === id && this.fees.chargeStatus(c, today) !== 'Cancelled');
      const open = own.filter((c) => this.fees.balance(c) > 0);
      const overdue = open.filter((c) => this.fees.chargeStatus(c, today) === 'Overdue');
      const upcoming = open.filter((c) => c.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      const lastPayment = payments.filter((p) => p.residentId === id).sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];

      const mineComplaints = complaints.filter((c) => c.residentId === id);
      const active = mineComplaints.filter((c) => c.status === 'Open' || c.status === 'In Progress' || c.status === 'Reopened');
      const latest = [...mineComplaints].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      const allocation = this.tenant.allocation;
      const actions = [
        this.feature('fees') && { label: 'Pay Fees', icon: 'payments', route: '/my/fees' },
        this.feature('complaints') && { label: 'Raise Complaint', icon: 'build_circle', route: '/my/complaints' },
        { label: 'View Room', icon: 'meeting_room', route: '/my/hostel' },
        this.feature('announcements') && { label: 'Announcements', icon: 'campaign', route: '/my/announcements' },
      ].filter(Boolean) as { label: string; icon: string; route: string }[];

      return {
        ...base,
        noRecord: false,
        firstName: resident.firstName,
        actions,
        room: allocation
          ? { number: allocation.room.roomNumber, bed: allocation.bed.bedNumber, where: `${allocation.room.building} · ${allocation.room.floor}` }
          : undefined,
        fees: {
          outstanding: open.reduce((s, c) => s + this.fees.balance(c), 0),
          overdue: overdue.length,
          nextDue: upcoming?.dueDate ?? '',
          latestPayment: lastPayment ? `${lastPayment.status} (${lastPayment.paidAt.slice(0, 10)})` : 'none yet',
        },
        complaints: { active: active.length, latest: latest ? `Latest: ${latest.title} · ${latest.status}` : 'No complaints raised' },
        unread: mine.filter((n) => !n.read).length,
        recent: mine.slice(0, 4),
      };
    }),
  );

  get firstName(): string {
    return this.tenant.resident?.firstName ?? 'there';
  }

  private emptyFees() {
    return { outstanding: 0, overdue: 0, nextDue: '', latestPayment: 'none yet' };
  }
}
