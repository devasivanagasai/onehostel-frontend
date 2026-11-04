import { Component, inject } from '@angular/core';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { combineLatest, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ResidentsService } from '../../core/services/residents.service';
import { RoomsService } from '../../core/services/rooms.service';
import { FeesService } from '../../core/services/fees.service';
import { ComplaintsService } from '../../core/services/complaints.service';
import { HostelSettingsService } from '../../core/services/hostel-settings.service';
import { AppCurrencyPipe } from '../../shared/pipes/app-currency.pipe';
import { localDateIso } from '../../shared/utils/local-date';

interface Kpi {
  label: string;
  value: number;
  icon: string;
  tone: string;
  sub: string;
  route: string;
  query?: Record<string, string>;
  money?: boolean;
}

interface ActivityRow {
  at: string;
  action: string;
  who: string;
  details?: string;
}

/**
 * Hostel Owner dashboard: every figure is read from this hostel's own residents, rooms, fees and
 * complaints records, so it matches those screens. (The platform-wide dashboard is Admin-only.)
 */
@Component({
  selector: 'app-owner-dashboard',
  standalone: true,
  imports: [AsyncPipe, DecimalPipe, RouterLink, MatIconModule, AppCurrencyPipe],
  template: `
    @if (vm$ | async; as vm) {
      <div class="owner">
        <header class="owner__head">
          <h1>Welcome, {{ firstName }} 👋</h1>
          <p>{{ vm.hostel }} · {{ vm.today }}</p>
        </header>

        <section class="owner__actions" aria-label="Quick actions">
          @for (a of actions; track a.label) {
            <a class="action" [routerLink]="a.route">
              <mat-icon fontSet="material-icons-outlined">{{ a.icon }}</mat-icon>{{ a.label }}
            </a>
          }
        </section>

        <section class="owner__grid">
          @for (k of vm.kpis; track k.label) {
            <a class="kpi kpi--{{ k.tone }}" [routerLink]="k.route" [queryParams]="k.query">
              <mat-icon fontSet="material-icons-outlined">{{ k.icon }}</mat-icon>
              <span class="kpi__label">{{ k.label }}</span>
              <strong class="kpi__value">
                @if (k.money) {
                  {{ k.value | appCurrency }}
                } @else {
                  {{ k.value | number }}
                }
              </strong>
              <span class="kpi__sub">{{ k.sub }}</span>
            </a>
          }
        </section>

        <section class="card">
          <h2>Recent Activity</h2>
          @if (vm.activity.length) {
            <table>
              <thead>
                <tr><th>Date &amp; Time</th><th>Action</th><th>Resident</th><th>Details</th></tr>
              </thead>
              <tbody>
                @for (a of vm.activity; track $index) {
                  <tr>
                    <td>{{ a.at.replace('T', ' ').slice(0, 16) }}</td>
                    <td>{{ a.action }}</td>
                    <td>{{ a.who }}</td>
                    <td>{{ a.details || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="empty">No activity yet.</p>
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      .owner { display: flex; flex-direction: column; gap: 20px; padding: 10px 0; }
      .owner__head h1 { margin: 0; font-size: 22px; color: #0f172a; }
      .owner__head p { margin: 4px 0 0; color: #475569; font-size: 14px; }
      .owner__actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .action { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; background: #fff; color: #0f172a; text-decoration: none; font-size: 13px; font-weight: 600; box-shadow: 0 0 0 1px #e2e8f0; }
      .action:hover { background: #f1f5f9; }
      .owner__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
      .kpi { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: 14px; background: #fff; text-decoration: none; color: #0f172a; box-shadow: 0 0 0 1px #eef2f7; }
      .kpi:hover { box-shadow: 0 0 0 1px #cbd5e1; }
      .kpi mat-icon { color: #16a34a; }
      .kpi--amber mat-icon { color: #d97706; }
      .kpi--red mat-icon { color: #dc2626; }
      .kpi--blue mat-icon { color: #2563eb; }
      .kpi__label { font-size: 12.5px; color: #475569; }
      .kpi__value { font-size: 24px; }
      .kpi__sub { font-size: 12px; color: #94a3b8; }
      .card { background: #fff; border-radius: 16px; padding: 18px 20px; box-shadow: 0 0 0 1px #eef2f7; overflow-x: auto; }
      .card h2 { margin: 0 0 12px; font-size: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: #94a3b8; font-weight: 600; padding: 6px 8px; }
      td { padding: 8px; border-top: 1px solid #eef2f7; color: #0f172a; }
      .empty { color: #94a3b8; margin: 0; }
    `,
  ],
})
export class OwnerDashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly residents = inject(ResidentsService);
  private readonly rooms = inject(RoomsService);
  private readonly fees = inject(FeesService);
  private readonly complaints = inject(ComplaintsService);
  private readonly hostelSettings = inject(HostelSettingsService);

  readonly firstName = this.auth.currentUser?.name?.split(' ')[0] ?? 'there';

  readonly actions = [
    { label: 'Add Resident', icon: 'person_add', route: '/residents' },
    { label: 'Allocate Bed', icon: 'bed', route: '/rooms' },
    { label: 'Record Payment', icon: 'payments', route: '/fees' },
    { label: 'Create Announcement', icon: 'campaign', route: '/announcements' },
    { label: 'View Complaints', icon: 'report_problem', route: '/complaints' },
  ];

  readonly vm$ = combineLatest([
    this.residents.residents$,
    this.residents.stats$,
    this.rooms.stats$,
    this.fees.stats$,
    this.complaints.stats$,
  ]).pipe(
    map(([residents, resident, room, fee, complaint]) => {
      const today = localDateIso();
      const live = residents.filter((r) => !r.deactivatedAt);
      const checkedOut = live.filter((r) => r.status === 'Checked Out').length;
      const checkIns = live.filter((r) => r.joiningDate === today).length;
      const checkOuts = live.filter((r) => r.checkOutDate === today).length;
      const openComplaints = complaint.open + complaint.inProgress;

      const kpis: Kpi[] = [
        { label: 'Total Residents', value: resident.total, icon: 'groups', tone: 'green', sub: `${resident.active} active · ${checkedOut} checked out`, route: '/residents' },
        { label: 'Total Rooms', value: room.totalRooms, icon: 'meeting_room', tone: 'blue', sub: `${room.maintenanceBeds} bed(s) under maintenance`, route: '/rooms' },
        { label: 'Total Beds', value: room.totalBeds, icon: 'bed', tone: 'blue', sub: `${room.occupancyRate}% occupancy`, route: '/rooms' },
        { label: 'Occupied Beds', value: room.occupiedBeds, icon: 'hotel', tone: 'green', sub: 'Active allocations', route: '/rooms' },
        { label: 'Available Beds', value: room.availableBeds, icon: 'event_available', tone: 'green', sub: 'Ready to allocate', route: '/rooms' },
        { label: "Today's Check-ins", value: checkIns, icon: 'login', tone: 'blue', sub: 'Joining today', route: '/residents' },
        { label: "Today's Check-outs", value: checkOuts, icon: 'logout', tone: 'amber', sub: 'Leaving today', route: '/residents' },
        { label: 'Fees Collected', value: fee.collectedThisMonth, icon: 'payments', tone: 'green', sub: `${fee.paymentsThisMonth} payment(s) this month`, route: '/fees', money: true },
        { label: 'Outstanding Dues', value: fee.outstanding, icon: 'account_balance_wallet', tone: fee.outstanding > 0 ? 'red' : 'green', sub: `${fee.overdueCount} overdue`, route: '/fees', money: true },
        { label: 'Open Complaints', value: openComplaints, icon: 'report_problem', tone: openComplaints > 0 ? 'amber' : 'green', sub: `${complaint.urgent} urgent · ${complaint.overdue} overdue`, route: '/complaints' },
      ];

      const activity: ActivityRow[] = live
        .flatMap((r) =>
          (r.activity ?? []).map((a) => ({
            at: a.at,
            action: a.action,
            who: `${r.firstName} ${r.lastName}`.trim(),
            details: a.details,
          })),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8);

      return {
        hostel: this.hostelSettings.state.value.profile.hostelName,
        today: new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        kpis,
        activity,
      };
    }),
  );
}
