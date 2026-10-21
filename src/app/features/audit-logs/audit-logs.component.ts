import { Component, OnInit, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { provideNativeDateAdapter } from '@angular/material/core';
import { AuditLogService } from '../../core/services/audit-log.service';
import {
  AUDIT_EVENT_NAMES,
  AUDIT_MODULES,
  AuditLog,
  auditAction,
  auditEventLabel,
  auditModule,
} from '../../core/models/audit.models';
import { AuditLogDetailPanelComponent } from './audit-log-detail-panel.component';
import { ReportExportService } from '../reports/report-export.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';

const ALL = 'All';

const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [
    AppDatePipe,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    MatTooltipModule,
    AuditLogDetailPanelComponent,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  providers: [provideNativeDateAdapter()],
  template: `
    <div class="onboarding-page audit-page">
      <!-- Summary KPIs (display only) -->
      <div class="stats">
        @for (tile of tiles; track tile.label) {
          <div class="stat-tile stat-tile--{{ tile.tone }}">
            <span class="stat-tile__icon"><mat-icon fontSet="material-icons-outlined">{{ tile.icon }}</mat-icon></span>
            <span class="stat-tile__text">
              <span class="stat-tile__label">{{ tile.label }}</span>
              <span class="stat-tile__value">{{ tile.value | number }}</span>
              <span class="stat-tile__sub">{{ tile.sub }}</span>
            </span>
            <svg class="stat-tile__spark" viewBox="0 0 80 28" preserveAspectRatio="none" aria-hidden="true">
              <path class="stat-tile__area" [attr.d]="tile.spark + ' L80 28 L0 28 Z'" />
              <path class="stat-tile__line" [attr.d]="tile.spark" />
            </svg>
          </div>
        }
      </div>

      <app-table-card
        [empty]="filteredLogs.length === 0"
        emptyIcon="manage_search"
        [emptyMessage]="hasFilters ? 'No audit entries match your filters' : 'No Data Found'"
        [emptyHint]="hasFilters ? 'Try a different search, date range or filter, or clear the filters.' : ''"
        [clearable]="hasFilters"
        (clear)="resetFilters()"
        [page]="safePage"
        [totalPages]="totalPages"
        [pageSize]="pageSize"
        (pageChange)="setPage($event)"
        (pageSizeChange)="pageSize = $event; setPage(0)"
      >
        <!-- Filters · Export -->
        <div class="filter-bar" tableToolbar>
          <mat-form-field appearance="outline" class="filter-field filter-field--search">
            <mat-icon matPrefix>search</mat-icon>
            <input matInput type="text" placeholder="Search log ID, user, IP..." [(ngModel)]="searchTerm" (ngModelChange)="currentPage = 0" />
            <button
              *ngIf="searchTerm"
              mat-icon-button
              matSuffix
              type="button"
              class="filter-clear-btn"
              aria-label="Clear search"
              (click)="searchTerm = ''"
            >
              <mat-icon>close</mat-icon>
            </button>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field filter-field--date">
            <mat-date-range-input [rangePicker]="picker">
              <input matStartDate placeholder="From" [(ngModel)]="dateFrom" (ngModelChange)="currentPage = 0" />
              <input matEndDate placeholder="To" [(ngModel)]="dateTo" (ngModelChange)="currentPage = 0" />
            </mat-date-range-input>
            <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-date-range-picker #picker></mat-date-range-picker>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">layers</mat-icon>
            <mat-select [(ngModel)]="moduleFilter" (ngModelChange)="onModuleChange()" aria-label="Module">
              <mat-option value="All">All Modules</mat-option>
              <mat-option *ngFor="let m of modules" [value]="m">{{ m }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">bolt</mat-icon>
            <mat-select [(ngModel)]="eventFilter" (ngModelChange)="currentPage = 0" aria-label="Action">
              <mat-option value="All">All Actions</mat-option>
              <mat-option *ngFor="let e of eventOptions" [value]="e">{{ eventLabel(e) }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-icon matPrefix fontSet="material-icons-outlined">filter_alt</mat-icon>
            <mat-select [(ngModel)]="statusFilter" (ngModelChange)="currentPage = 0" aria-label="Status">
              <mat-option value="All">All Statuses</mat-option>
              <mat-option value="Success">Success</mat-option>
              <mat-option value="Failed">Failed</mat-option>
            </mat-select>
          </mat-form-field>

          @if (hasFilters) {
            <app-button variant="text" size="sm" icon="restart_alt" (clicked)="resetFilters()">Reset</app-button>
          }

          <app-button
            class="filter-bar__export"
            variant="success"
            icon="description"
            [iconOutlined]="true"
            [disabled]="filteredLogs.length === 0"
            (clicked)="exportExcel()"
          >Export Excel</app-button>
        </div>

        <!-- Table (header always shown, so columns stay put when nothing matches) -->
          <table mat-table [dataSource]="pagedLogs" class="saas-table">
            <ng-container matColumnDef="logId">
              <th mat-header-cell *matHeaderCellDef> Log ID </th>
              <td mat-cell *matCellDef="let el" class="text-strong"> {{ el.logId }} </td>
            </ng-container>

            <ng-container matColumnDef="timestamp">
              <th mat-header-cell *matHeaderCellDef> Date &amp; Time </th>
              <td mat-cell *matCellDef="let el" class="nowrap"> {{ el.timestamp | appDate: 'datetime' }} </td>
            </ng-container>

            <ng-container matColumnDef="user">
              <th mat-header-cell *matHeaderCellDef> User </th>
              <td mat-cell *matCellDef="let el">
                <div class="list-entity">
                  <span class="list-entity__avatar list-entity__avatar--sm list-avatar--{{ userTone(el.user) }}">{{ initials(el.user) }}</span>
                  <span class="list-entity__name">{{ el.user }}</span>
                </div>
              </td>
            </ng-container>

            <ng-container matColumnDef="module">
              <th mat-header-cell *matHeaderCellDef> Module </th>
              <td mat-cell *matCellDef="let el">
                <span class="with-icon">
                  <mat-icon fontSet="material-icons-outlined" class="module-icon module-icon--{{ moduleTone(el) }}">{{ moduleIcon(el) }}</mat-icon>{{ module(el) }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="action">
              <th mat-header-cell *matHeaderCellDef> Action </th>
              <td mat-cell *matCellDef="let el">
                <span class="with-icon">
                  <mat-icon class="action-icon action-icon--{{ actionClass(el) }}">{{ actionIcon(el) }}</mat-icon>{{ action(el) }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="entity">
              <th mat-header-cell *matHeaderCellDef> Entity </th>
              <td mat-cell *matCellDef="let el" class="entity-cell" [title]="el.entity"> {{ el.entity }} </td>
            </ng-container>

            <ng-container matColumnDef="ipAddress">
              <th mat-header-cell *matHeaderCellDef> IP Address </th>
              <td mat-cell *matCellDef="let el" class="nowrap"> {{ el.ipAddress }} </td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef> Status </th>
              <td mat-cell *matCellDef="let el">
                <span class="status-badge" [class.status-badge--success]="el.status === 'Success'" [class.status-badge--danger]="el.status === 'Failed'">
                  {{ el.status }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions-header"> View </th>
              <td mat-cell *matCellDef="let el" class="actions-cell">
                @if (el.changes?.length) {
                  <span
                    class="changes-pill"
                    [matTooltip]="el.changes.length + ' field change' + (el.changes.length > 1 ? 's' : '') + ' recorded'"
                  >
                    <mat-icon>difference</mat-icon>{{ el.changes.length }}
                  </span>
                }
                <app-button
                  variant="icon-outline"
                  size="sm"
                  icon="visibility"
                  [ariaLabel]="'View ' + el.logId"
                  matTooltip="View details"
                  (clicked)="openLog(el)"
                ></app-button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr
              mat-row
              *matRowDef="let row; columns: displayedColumns;"
              class="table-row"
              [class.table-row--failed]="row.status === 'Failed'"
            ></tr>
          </table>
      </app-table-card>
    </div>

    <app-audit-log-detail-panel
      [isOpen]="isPanelOpen"
      [log]="selectedLog"
      (closePanel)="isPanelOpen = false"
    ></app-audit-log-detail-panel>
  `,
  styles: [`
    /* Table, card, badges, empty state and pagination: src/styles/_table.scss */

    .audit-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ---- KPI tiles ---- */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 20px;
    }

    @media (max-width: 1100px) {
      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .stats {
        grid-template-columns: 1fr;
      }
    }

    .stat-tile {
      --tone: #2563eb;
      --tone-bg: #eaf1ff;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 18px 20px;
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04);
    }

    .stat-tile--blue { --tone: #2563eb; --tone-bg: #eaf1ff; }
    .stat-tile--green { --tone: #16a34a; --tone-bg: #e8f7ee; }
    .stat-tile--red { --tone: #dc2626; --tone-bg: #fdecec; }
    .stat-tile--indigo { --tone: #4f46e5; --tone-bg: #eceefe; }

    .stat-tile__icon {
      width: 52px;
      height: 52px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stat-tile__icon mat-icon {
      font-size: 25px;
      width: 25px;
      height: 25px;
    }

    .stat-tile__text {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .stat-tile__label {
      font-size: 13px;
      font-weight: 500;
      color: #334155;
    }

    .stat-tile__value {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      color: #0f172a;
    }

    .stat-tile--red .stat-tile__value {
      color: #dc2626;
    }

    .stat-tile__sub {
      font-size: 12px;
      color: #64748b;
    }

    .stat-tile__spark {
      flex: 1;
      min-width: 48px;
      max-width: 90px;
      height: 32px;
      margin-left: auto;
      align-self: flex-end;
    }

    .stat-tile__line {
      fill: none;
      stroke: var(--tone);
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .stat-tile__area {
      fill: var(--tone);
      opacity: 0.1;
    }

    /* ---- Filters ---- */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .filter-bar .filter-field {
      width: 150px;
    }

    .filter-bar .filter-field--search {
      width: 210px;
    }

    .filter-bar .filter-field--date {
      width: 205px;
    }

    .filter-bar mat-icon[matPrefix] {
      color: #64748b;
    }

    .filter-bar__export {
      flex-shrink: 0;
      margin-left: auto;
    }

    /* ---- Table cells ---- */
    .text-strong {
      color: #0f172a !important;
      font-weight: 500;
    }

    .nowrap {
      white-space: nowrap;
      color: #334155 !important;
    }

    .list-entity__avatar--sm {
      width: 32px;
      height: 32px;
      font-size: 12px;
    }

    .module-icon,
    .action-icon {
      font-size: 18px !important;
      width: 18px !important;
      height: 18px !important;
    }

    .module-icon--blue { color: #2563eb; }
    .module-icon--purple { color: #7c3aed; }
    .module-icon--teal { color: #0d9488; }
    .module-icon--amber { color: #d97706; }
    .module-icon--slate { color: #475569; }

    .action-icon--create { color: #16a34a; }
    .action-icon--update { color: #f59e0b; }
    .action-icon--activate { color: #0d9488; }
    .action-icon--deactivate { color: #dc2626; }
    .action-icon--auth { color: #2563eb; }

    .saas-table .table-row--failed {
      background: #fffafb;
    }

    .entity-cell {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #334155 !important;
    }

    .changes-pill {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-right: 8px;
      font-size: 12px;
      font-weight: 700;
      color: #6d28d9;
      vertical-align: middle;
    }

    .changes-pill mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `],
})
export class AuditLogsComponent implements OnInit {
  /** Currency, date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  readonly modules = AUDIT_MODULES;
  readonly module = auditModule;
  readonly action = auditAction;
  readonly eventLabel = auditEventLabel;

  searchTerm = '';
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  moduleFilter = ALL;
  eventFilter = ALL;
  statusFilter = ALL;

  pageSize = 10;
  currentPage = 0;

  displayedColumns = ['logId', 'timestamp', 'user', 'module', 'action', 'entity', 'ipAddress', 'status', 'actions'];

  isPanelOpen = false;
  selectedLog?: AuditLog;

  constructor(
    private auditLog: AuditLogService,
    private exporter: ReportExportService,
    private route: ActivatedRoute,
  ) {}

  /** Other screens deep-link here with ?module=&event=&q= to show a pre-filtered history. */
  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const module = params.get('module');
    const event = params.get('event');
    if (module && (AUDIT_MODULES as string[]).includes(module)) this.moduleFilter = module;
    if (event && (AUDIT_EVENT_NAMES as string[]).includes(event)) this.eventFilter = event;
    this.searchTerm = params.get('q') ?? '';
  }

  /** Action options narrow to the chosen module's events. */
  get eventOptions(): string[] {
    return this.moduleFilter === ALL
      ? AUDIT_EVENT_NAMES
      : AUDIT_EVENT_NAMES.filter((e) => auditModule({ event: e } as AuditLog) === this.moduleFilter);
  }

  onModuleChange(): void {
    if (this.eventFilter !== ALL && !this.eventOptions.includes(this.eventFilter)) this.eventFilter = ALL;
    this.currentPage = 0;
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.dateFrom ||
      this.dateTo ||
      this.moduleFilter !== ALL ||
      this.eventFilter !== ALL ||
      this.statusFilter !== ALL
    );
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.dateFrom = this.dateTo = null;
    this.moduleFilter = this.eventFilter = this.statusFilter = ALL;
    this.currentPage = 0;
  }

  // ---- KPI tiles ----

  /** Summary over every entry (not the filtered view). */
  get tiles(): { label: string; value: number; sub: string; icon: string; tone: string; spark: string }[] {
    const logs = this.auditLog.logs;
    const total = logs.length;
    const ok = logs.filter((l) => l.status === 'Success').length;
    const failed = total - ok;
    const today = toIsoDate(new Date());
    const todayCount = logs.filter((l) => l.timestamp.slice(0, 10) === today).length;
    const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
    return [
      { label: 'Total Logs', value: total, sub: 'All time activities', icon: 'description', tone: 'blue', spark: 'M0 24 C8 20 12 22 20 16 S32 18 40 12 S52 14 60 8 S72 10 80 4' },
      { label: 'Successful', value: ok, sub: `${pct(ok)}% success rate`, icon: 'check', tone: 'green', spark: 'M0 24 L10 20 L18 22 L28 14 L36 17 L46 9 L54 12 L64 5 L72 8 L80 2' },
      { label: 'Failed', value: failed, sub: `${pct(failed)}% failure rate`, icon: 'gpp_bad', tone: 'red', spark: 'M0 20 L10 18 L18 21 L26 14 L34 19 L42 12 L50 18 L58 16 L66 19 L80 17' },
      { label: 'Activity Today', value: todayCount, sub: 'Logs recorded today', icon: 'bar_chart', tone: 'indigo', spark: 'M0 22 L8 18 L16 20 L24 14 L32 17 L40 12 L48 15 L56 10 L64 13 L72 9 L80 11' },
    ];
  }

  // ---- Table cells ----

  /** "Admin User" → "AU"; single words give one letter. */
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  }

  /** A stable avatar colour per user name. */
  userTone(name: string): string {
    const tones = ['blue', 'purple', 'green', 'amber'];
    return tones[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tones.length];
  }

  moduleIcon(log: AuditLog): string {
    return (
      {
        Auth: 'shield',
        Hostel: 'apartment',
        'Hostel Owner': 'manage_accounts',
        Tenant: 'person',
        'Subscription Plan': 'workspace_premium',
        'Subscription & Payment': 'payments',
        'Communication Template': 'campaign',
        'System Defaults': 'settings',
      } as Record<string, string>
    )[auditModule(log)] ?? 'layers';
  }

  moduleTone(log: AuditLog): string {
    return (
      {
        Auth: 'blue',
        Hostel: 'teal',
        'Hostel Owner': 'purple',
        Tenant: 'purple',
        'Subscription Plan': 'amber',
        'Subscription & Payment': 'teal',
        'Communication Template': 'blue',
      } as Record<string, string>
    )[auditModule(log)] ?? 'slate';
  }

  actionIcon(log: AuditLog): string {
    const action = auditAction(log);
    return (
      {
        Login: 'login',
        Logout: 'logout',
        Create: 'add_circle',
        Update: 'edit',
        Activate: 'check_circle',
        Deactivate: 'block',
        Lock: 'lock',
        Unlock: 'lock_open',
        Block: 'block',
        Unblock: 'lock_open',
        'Reset Password': 'lock_reset',
        'Change Password': 'password',
        'Update Profile': 'manage_accounts',
        'Record Payment': 'payments',
      } as Record<string, string>
    )[action] ?? 'bolt';
  }

  actionClass(log: AuditLog): string {
    const action = auditAction(log);
    if (action === 'Create') return 'create';
    if (action === 'Update') return 'update';
    if (action === 'Activate') return 'activate';
    if (action === 'Deactivate') return 'deactivate';
    return 'auth';
  }

  get filteredLogs(): AuditLog[] {
    const term = this.searchTerm.trim().toLowerCase();
    const from = this.dateFrom ? toIsoDate(this.dateFrom) : '';
    const to = this.dateTo ? toIsoDate(this.dateTo) : '';

    return this.auditLog.logs.filter((l) => {
      const day = l.timestamp.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (this.moduleFilter !== ALL && auditModule(l) !== this.moduleFilter) return false;
      if (this.eventFilter !== ALL && l.event !== this.eventFilter) return false;
      if (this.statusFilter !== ALL && l.status !== this.statusFilter) return false;
      if (!term) return true;
      return [l.logId, l.user, l.entity, l.ipAddress, l.event, auditEventLabel(l.event), auditModule(l), l.details ?? ''].some((v) =>
        v.toLowerCase().includes(term),
      );
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredLogs.length / this.pageSize));
  }

  /** Clamps the page so it stays valid after a filter change shrinks the result set. */
  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  setPage(page: number): void {
    this.currentPage = Math.min(Math.max(0, page), this.totalPages - 1);
  }

  get pagedLogs(): AuditLog[] {
    const start = this.safePage * this.pageSize;
    return this.filteredLogs.slice(start, start + this.pageSize);
  }

  openLog(log: AuditLog): void {
    this.selectedLog = log;
    this.isPanelOpen = true;
  }

  exportExcel(): void {
    const changesText = (l: AuditLog) =>
      (l.changes ?? []).map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`).join('; ');

    this.exporter.exportExcel({
      title: 'Audit Logs',
      filterSummary: '',
      rows: this.filteredLogs,
      columns: [
        { header: 'Log ID', value: (l: AuditLog) => l.logId },
        { header: 'Date & Time', value: (l: AuditLog) => this.fmt.date(l.timestamp, 'datetimeSeconds') },
        { header: 'User', value: (l: AuditLog) => l.user },
        { header: 'Module', value: (l: AuditLog) => auditModule(l) },
        { header: 'Action', value: (l: AuditLog) => auditAction(l) },
        { header: 'Entity', value: (l: AuditLog) => l.entity },
        { header: 'IP Address', value: (l: AuditLog) => l.ipAddress },
        { header: 'Status', value: (l: AuditLog) => l.status },
        { header: 'Details', value: (l: AuditLog) => l.details ?? '' },
        { header: 'Changes (Old → New)', value: changesText },
      ],
    });
  }
}
