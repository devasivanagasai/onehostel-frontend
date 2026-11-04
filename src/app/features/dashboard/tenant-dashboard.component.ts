import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { TenantHomeService } from '../../core/services/tenant-home.service';
import { TenantPreferencesService } from '../../core/services/tenant-preferences.service';
import { TenantComplaintsService } from '../../core/services/tenant-complaints.service';
import { HostelSettingsService } from '../../core/services/hostel-settings.service';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';

/**
 * Tenant home (FRD 5.2). It leads with what needs the Tenant's attention now (with one clear action each),
 * then the stay at a glance, what is coming up, and the latest notifications. Everything is the signed-in
 * Tenant's own data; pages whose module is off for the hostel are left out.
 */
@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [AsyncPipe, RouterLink, MatIconModule, AppCurrencyPipe],
  template: `
    @if (home.view$ | async; as vm) {
      <div class="td">
        <header class="td-head">
          <div>
            <h1>{{ greeting }}, {{ vm.firstName }}</h1>
            <p class="td-head__sub">
              {{ hostelName }}
              @if (vm.room) { <span class="td-chip"><mat-icon fontSet="material-icons-outlined">meeting_room</mat-icon>Room {{ vm.room.number }} · Bed {{ vm.room.bed }}</span> }
            </p>
          </div>
        </header>

        @if (!vm.found) {
          <p class="td-note td-note--bad" role="alert">We could not find your resident record. Please contact your hostel office.</p>
        } @else {
          <!-- What needs you now -->
          <section class="td-card td-attn" aria-labelledby="td-attn-title">
            <h2 id="td-attn-title">
              @if (vm.attention.length) { Needs your attention <span class="td-count">{{ vm.attention.length }}</span> } @else { You're all caught up }
            </h2>
            @for (a of vm.attention; track a.id) {
              <div class="td-attn__row td-attn__row--{{ a.tone }}">
                <span class="td-attn__icon" aria-hidden="true"><mat-icon fontSet="material-icons-outlined">{{ a.icon }}</mat-icon></span>
                <div class="td-attn__text">
                  <strong>{{ a.title }}</strong>
                  <span>{{ a.detail }}</span>
                </div>
                <a class="td-btn td-btn--{{ a.tone }}" [routerLink]="a.route">{{ a.actionLabel }}</a>
              </div>
            } @empty {
              <p class="td-attn__ok">
                <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
                No dues, parcels or notices need you right now.
              </p>
            }
          </section>

          <!-- Quick actions -->
          <nav class="td-actions" aria-label="Quick actions">
            @for (a of actions; track a.label) {
              <a class="td-action" [routerLink]="a.route">
                <span class="td-action__icon" aria-hidden="true"><mat-icon fontSet="material-icons-outlined">{{ a.icon }}</mat-icon></span>
                <span>{{ a.label }}</span>
              </a>
            }
          </nav>

          <!-- At a glance -->
          <section class="td-stats" aria-label="At a glance">
            <a class="td-stat" routerLink="/my/hostel">
              <span class="td-stat__label">My room</span>
              <strong>{{ vm.room ? 'Room ' + vm.room.number : 'Not allocated' }}</strong>
              <span class="td-stat__sub">{{ vm.room ? 'Bed ' + vm.room.bed + ' · ' + vm.room.where : 'Your hostel office will assign one' }}</span>
            </a>
            @if (feature('fees')) {
              <a class="td-stat" routerLink="/my/fees">
                <span class="td-stat__label">Outstanding fees</span>
                <strong [class.td-bad]="vm.fees.overdueCount > 0">{{ vm.fees.outstanding | appCurrency }}</strong>
                <span class="td-stat__sub">
                  @if (vm.fees.overdueCount > 0) { {{ vm.fees.overdueAmount | appCurrency }} overdue · }
                  Last payment: {{ vm.fees.latestPayment }}
                </span>
              </a>
            }
            @if (feature('complaints')) {
              <a class="td-stat" routerLink="/my/complaints">
                <span class="td-stat__label">Open complaints</span>
                <strong>{{ vm.complaints.active }}</strong>
                <span class="td-stat__sub">{{ vm.complaints.latest }}</span>
              </a>
            }
            <a class="td-stat" routerLink="/my/notifications">
              <span class="td-stat__label">Unread notifications</span>
              <strong>{{ vm.unreadNotifications }}</strong>
              <span class="td-stat__sub">{{ vm.unreadNotifications ? 'Tap to review' : 'Nothing new' }}</span>
            </a>
          </section>

          <div class="td-cols">
            <section class="td-card" aria-labelledby="td-up-title">
              <h2 id="td-up-title">Coming up</h2>
              @for (u of vm.upcoming; track u.id) {
                <a class="td-row" [routerLink]="u.route">
                  <span class="td-row__icon" aria-hidden="true"><mat-icon fontSet="material-icons-outlined">{{ u.icon }}</mat-icon></span>
                  <span class="td-row__main"><strong>{{ u.title }}</strong><small>{{ u.detail }}</small></span>
                  <mat-icon class="td-row__go" aria-hidden="true">chevron_right</mat-icon>
                </a>
              } @empty {
                <p class="td-empty">Nothing planned in the next two weeks. Bookings, leave, visitors and events you set up will show here.</p>
              }
            </section>

            <section class="td-card" aria-labelledby="td-note-title">
              <h2 id="td-note-title">Recent notifications <a class="td-link" routerLink="/my/notifications">See all</a></h2>
              @for (n of vm.recent; track n.id) {
                <a class="td-row" [routerLink]="n.route || '/my/notifications'">
                  <span class="td-dot" [class.td-dot--on]="!n.read" [attr.aria-label]="n.read ? 'Read' : 'Unread'"></span>
                  <span class="td-row__main"><strong>{{ n.title }}</strong><small>{{ n.body }}</small></span>
                  <small class="td-row__time">{{ when(n.createdAt) }}</small>
                </a>
              } @empty {
                <p class="td-empty">No notifications yet.</p>
              }
            </section>
          </div>

          <p class="td-help">
            <mat-icon fontSet="material-icons-outlined">support_agent</mat-icon>
            <span>
              Need help? Call the hostel office on <a [href]="'tel:' + contact.phone">{{ contact.phone || 'the number on the notice board' }}</a>
              or open <a routerLink="/my/support">Help &amp; Support</a>. In an emergency call 112 first; this app is not a replacement for emergency services.
            </span>
          </p>
        }
      </div>
    } @else {
      <div class="td" role="status" aria-label="Loading your dashboard">
        <div class="td-skel td-skel--head"></div>
        <div class="td-skel td-skel--card"></div>
        <div class="td-skel td-skel--card"></div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .td { display: flex; flex-direction: column; gap: 18px; max-width: 1100px; }
      .td-head h1 { margin: 0; font-size: 24px; line-height: 1.2; color: #0f172a; font-weight: 700; }
      .td-head__sub { margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #475569; font-size: 14px; }
      .td-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 6px; border-radius: 999px; background: #e8f6ec; color: #166534; font-size: 12.5px; font-weight: 600; }
      .td-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }

      .td-card { background: #fff; border-radius: 16px; padding: 18px 20px; box-shadow: 0 1px 2px rgba(15, 34, 74, 0.04), 0 0 0 1px #eef2f7; }
      .td-card h2 { margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
      .td-count { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #fee2e2; color: #b91c1c; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; }
      .td-link { margin-left: auto; font-size: 12.5px; font-weight: 600; color: #2563eb; text-decoration: none; }
      .td-link:hover { text-decoration: underline; }

      .td-attn__row { display: flex; align-items: center; gap: 12px; padding: 12px; margin-top: 8px; border-radius: 12px; border: 1px solid transparent; }
      .td-attn__row--danger { background: #fef2f2; border-color: #fecaca; }
      .td-attn__row--warn { background: #fffbeb; border-color: #fde68a; }
      .td-attn__row--info { background: #eff6ff; border-color: #bfdbfe; }
      .td-attn__icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: #fff; flex-shrink: 0; }
      .td-attn__row--danger .td-attn__icon { color: #dc2626; }
      .td-attn__row--warn .td-attn__icon { color: #d97706; }
      .td-attn__row--info .td-attn__icon { color: #2563eb; }
      .td-attn__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .td-attn__text strong { font-size: 14px; color: #0f172a; }
      .td-attn__text span { font-size: 12.5px; color: #475569; }
      .td-attn__ok { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; color: #166534; font-size: 14px; }

      .td-btn { flex-shrink: 0; min-height: 40px; padding: 0 16px; border-radius: 10px; display: inline-flex; align-items: center; font-size: 13.5px; font-weight: 700; text-decoration: none; color: #fff; background: #2563eb; }
      .td-btn--danger { background: #dc2626; }
      .td-btn--warn { background: #d97706; }
      .td-btn:hover { filter: brightness(0.94); }

      .td-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
      .td-action { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px; border-radius: 14px; background: #fff; color: #0f172a; text-decoration: none; font-size: 13.5px; font-weight: 600; box-shadow: 0 0 0 1px #e2e8f0; }
      .td-action:hover { background: #f8fafc; box-shadow: 0 0 0 1px #cbd5e1; }
      .td-action__icon { width: 32px; height: 32px; border-radius: 10px; background: #e8f6ec; color: #16a34a; display: grid; place-items: center; flex-shrink: 0; }

      .td-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
      .td-stat { display: flex; flex-direction: column; gap: 3px; padding: 14px 16px; border-radius: 14px; background: #fff; text-decoration: none; color: #0f172a; box-shadow: 0 0 0 1px #eef2f7; }
      .td-stat:hover { box-shadow: 0 0 0 1px #cbd5e1; }
      .td-stat__label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; }
      .td-stat strong { font-size: 22px; line-height: 1.2; }
      .td-stat__sub { font-size: 12.5px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .td-bad { color: #dc2626; }

      .td-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .td-row { display: flex; align-items: center; gap: 12px; padding: 10px 6px; border-top: 1px solid #eef2f7; text-decoration: none; color: inherit; border-radius: 8px; }
      .td-row:first-of-type { border-top: 0; }
      .td-row:hover { background: #f8fafc; }
      .td-row__icon { width: 34px; height: 34px; border-radius: 10px; background: #eff6ff; color: #2563eb; display: grid; place-items: center; flex-shrink: 0; }
      .td-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .td-row__main strong { font-size: 13.5px; color: #0f172a; font-weight: 600; }
      .td-row__main small { font-size: 12.5px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .td-row__time { color: #94a3b8; font-size: 12px; flex-shrink: 0; }
      .td-row__go { color: #94a3b8; }
      .td-dot { width: 8px; height: 8px; border-radius: 50%; background: #e2e8f0; flex-shrink: 0; margin: 0 8px 0 4px; }
      .td-dot--on { background: #2563eb; }
      .td-empty { margin: 4px 0 0; font-size: 13px; color: #64748b; }

      .td-help { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px 14px; border-radius: 12px; background: #f1f5f9; color: #334155; font-size: 13px; line-height: 1.5; }
      .td-help a { color: #2563eb; font-weight: 600; }
      .td-help mat-icon { color: #64748b; flex-shrink: 0; }
      .td-note { padding: 12px 14px; border-radius: 12px; font-size: 14px; }
      .td-note--bad { background: #fef2f2; color: #b91c1c; }

      .td-skel { border-radius: 16px; background: linear-gradient(90deg, #eef2f7 25%, #f8fafc 37%, #eef2f7 63%); background-size: 400% 100%; animation: td-shimmer 1.4s ease infinite; }
      .td-skel--head { height: 46px; width: 60%; }
      .td-skel--card { height: 120px; }
      @keyframes td-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

      a:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { .td-skel { animation: none; } }

      @media (max-width: 760px) {
        .td-head h1 { font-size: 21px; }
        .td-cols { grid-template-columns: 1fr; }
        .td-attn__row { flex-wrap: wrap; }
        .td-attn__row .td-btn { width: 100%; justify-content: center; }
        .td-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `,
  ],
})
export class TenantDashboardComponent {
  readonly home = inject(TenantHomeService);
  private readonly tenant = inject(TenantContextService);
  private readonly hostelSettings = inject(HostelSettingsService);
  // Created here so the demo complaints are seeded, and the Tenant's saved theme and text size are applied on sign-in.
  private readonly seedComplaints = inject(TenantComplaintsService);
  private readonly preferences = inject(TenantPreferencesService);

  readonly hostelName = this.hostelSettings.state.value.profile.hostelName;
  readonly contact = { phone: this.hostelSettings.state.value.profile.phone, email: this.hostelSettings.state.value.profile.email };

  readonly actions = [
    { label: 'Pay fees', icon: 'payments', route: '/my/fees', key: 'fees' },
    { label: 'Raise a complaint', icon: 'build_circle', route: '/my/complaints', key: 'complaints' },
    { label: 'Book laundry', icon: 'local_laundry_service', route: '/my/laundry', key: 'laundry' },
    { label: 'Request a visitor', icon: 'badge', route: '/my/visitors', key: 'visitors' },
    { label: 'Apply for leave', icon: 'exit_to_app', route: '/my/leave', key: 'leave' },
    { label: 'My room', icon: 'meeting_room', route: '/my/hostel', key: 'hostel' },
  ].filter((a) => this.tenant.enabledModules.some((m) => m.key === a.key));

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  feature(key: string): boolean {
    return this.tenant.enabledModules.some((m) => m.key === key);
  }

  /** "Today 10:30" / "Yesterday" / "2 Nov" for a local date-time. */
  when(at: string): string {
    const d = new Date(at);
    const today = new Date();
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (same(d, today)) return `Today ${at.slice(11, 16)}`;
    if (same(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
}
