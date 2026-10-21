import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminStatus, HostelAdmin, adminFullName } from '../admin-management/admin.models';
import { AdminService } from '../admin-management/admin.service';
import { AdminDetailPanelComponent, AdminPanelTab } from '../admin-management/admin-detail-panel.component';
import { Resident, residentFullName } from './resident.models';
import { ResidentService } from './resident.service';
import { isOnboardedHostel } from '../hostel-onboarding/onboarded-hostels';
import { RESIDENT_STATUS_TONE, ResidentDetailPanelComponent } from './resident-detail-panel.component';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

const ALL = 'All';

export type UserRole = 'Hostel Owner' | 'Tenant';

/** One row in a hostel card: either a Hostel Owner or a Tenant. */
interface UserRow {
  id: string;
  name: string;
  role: UserRole;
  hostelName: string;
  /** End users only: "101 / A". */
  roomBed: string | null;
  lastLogin?: string;
  status: string;
  tone: string;
  /** Extra text the search box matches (username, room). */
  searchText: string;
}

interface HostelGroup {
  hostel: string;
  rows: UserRow[];
  total: number;
  admins: number;
  residents: number;
}

const ADMIN_STATUS_TONE: Record<AdminStatus, 'success' | 'neutral' | 'danger'> = {
  Active: 'success',
  Inactive: 'neutral',
  Locked: 'danger',
};

/**
 * Every user of each onboarded hostel — its Hostel Owners and Tenants —
 * listed together under one card per hostel. Hostel Owners share data (and the view
 * panel) with the admin-management feature folder.
 */
@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    AppDatePipe,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    AdminDetailPanelComponent,
    ResidentDetailPanelComponent,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss',
})
export class UserManagementComponent {
  search = '';
  hostelFilter = ALL;
  roleFilter: UserRole | 'All' = ALL;
  statusFilter = ALL;

  readonly roles: UserRole[] = ['Hostel Owner', 'Tenant'];
  readonly statusOptions = ['Active', 'Inactive', 'Locked', 'Blocked'];

  /** Hostel cards the user has opened. Cards start closed. */
  private expanded = new Set<string>();

  adminPanelOpen = false;
  selectedAdminId?: string;
  adminPanelTab: AdminPanelTab = 'details';
  residentPanelOpen = false;
  selectedResidentId?: string;

  constructor(
    private adminService: AdminService,
    private residentService: ResidentService,
  ) {}

  // ---- Rows (onboarded hostels only) ------------------------------------------

  private get allRows(): UserRow[] {
    const admins: UserRow[] = this.adminService.admins
      .filter((a) => isOnboardedHostel(a.hostelId))
      .map((a: HostelAdmin) => ({
        id: a.adminId,
        name: adminFullName(a),
        role: 'Hostel Owner',
        hostelName: a.hostelName,
        roomBed: null,
        lastLogin: a.lastLogin,
        status: a.status,
        tone: ADMIN_STATUS_TONE[a.status],
        searchText: a.username,
      }));

    const residents: UserRow[] = this.residentService.residents
      .filter((r) => isOnboardedHostel(r.hostelId))
      .map((r: Resident) => ({
        id: r.residentId,
        name: residentFullName(r),
        role: 'Tenant',
        hostelName: r.hostelName,
        roomBed: `${r.roomNo} / ${r.bedNo}`,
        lastLogin: r.lastLogin,
        status: r.status,
        tone: RESIDENT_STATUS_TONE[r.status],
        searchText: `${r.roomNo} ${r.email}`,
      }));

    return [...admins, ...residents];
  }

  /** Summary tiles, over every user of the onboarded hostels (not just the filtered ones). */
  get tiles(): { label: string; count: number; icon: string; tone: string }[] {
    const rows = this.allRows;
    const admins = rows.filter((r) => r.role === 'Hostel Owner').length;
    const locked = rows.filter((r) => r.status === 'Locked' || r.status === 'Blocked').length;
    return [
      { label: 'Total Users', count: rows.length, icon: 'group', tone: 'blue' },
      { label: 'Total Hostel Owners', count: admins, icon: 'admin_panel_settings', tone: 'green' },
      { label: 'Total Tenants', count: rows.length - admins, icon: 'groups', tone: 'purple' },
      { label: 'Locked Accounts', count: locked, icon: 'lock', tone: 'amber' },
    ];
  }

  get hostelOptions(): string[] {
    return [...new Set(this.allRows.map((r) => r.hostelName))].sort();
  }

  // ---- Filters ---------------------------------------------------------------

  get hasFilters(): boolean {
    return !!this.search || this.hostelFilter !== ALL || this.roleFilter !== ALL || this.statusFilter !== ALL;
  }

  resetFilters(): void {
    this.search = '';
    this.hostelFilter = ALL;
    this.roleFilter = ALL;
    this.statusFilter = ALL;
  }

  private get filteredRows(): UserRow[] {
    const term = this.search.trim().toLowerCase();
    return this.allRows.filter((r) => {
      if (this.hostelFilter !== ALL && r.hostelName !== this.hostelFilter) return false;
      if (this.roleFilter !== ALL && r.role !== this.roleFilter) return false;
      if (this.statusFilter !== ALL && r.status !== this.statusFilter) return false;
      return !term || [r.id, r.name, r.searchText].some((v) => v.toLowerCase().includes(term));
    });
  }

  // ---- Grouping (one card per hostel) ---------------------------------------

  /** All matching users in display order: hostels A–Z; inside each, Hostel Owners first, then Tenants, each by ID. */
  private get sortedRows(): UserRow[] {
    return [...this.filteredRows].sort(
      (a, b) =>
        a.hostelName.localeCompare(b.hostelName) ||
        (a.role === b.role ? a.id.localeCompare(b.id) : a.role === 'Hostel Owner' ? -1 : 1),
    );
  }

  /** Every matching hostel as a card (all its users), hostels A–Z. All cards show on one page (no paging). */
  get groups(): HostelGroup[] {
    const map = new Map<string, UserRow[]>();
    this.sortedRows.forEach((r) => map.set(r.hostelName, [...(map.get(r.hostelName) ?? []), r]));
    return [...map.entries()].map(([hostel, rows]) => ({
      hostel,
      rows,
      total: rows.length,
      admins: rows.filter((r) => r.role === 'Hostel Owner').length,
      residents: rows.filter((r) => r.role === 'Tenant').length,
    }));
  }

  isCollapsed(hostel: string): boolean {
    return !this.expanded.has(hostel);
  }

  toggleGroup(hostel: string): void {
    this.expanded.has(hostel) ? this.expanded.delete(hostel) : this.expanded.add(hostel);
  }

  // ---- Panels ----------------------------------------------------------------


  edit(row: UserRow): void {
    if (row.role !== 'Hostel Owner') return;
    this.selectedAdminId = row.id;
    this.adminPanelTab = 'edit';
    this.adminPanelOpen = true;
  }

  /** The row's lock-type action for its status (Lock/Unlock admins, Block/Unblock residents); none when Inactive. */
  lockAction(row: UserRow): { label: string; icon: string } | null {
    if (row.role === 'Hostel Owner') {
      if (row.status === 'Active') return { label: 'Lock', icon: 'lock' };
      if (row.status === 'Locked') return { label: 'Unlock', icon: 'lock_open' };
    } else {
      if (row.status === 'Active') return { label: 'Block', icon: 'block' };
      if (row.status === 'Blocked') return { label: 'Unblock', icon: 'lock_open' };
    }
    return null;
  }

  /** Runs the lock-type action through the service's confirm dialog. */
  toggleLock(row: UserRow): void {
    if (row.role === 'Hostel Owner') {
      const admin = this.adminService.byId(row.id);
      if (admin) this.adminService.perform(admin, row.status === 'Locked' ? 'unlock' : 'lock').subscribe();
    } else {
      const resident = this.residentService.byId(row.id);
      if (resident) this.residentService.perform(resident, row.status === 'Blocked' ? 'unblock' : 'block').subscribe();
    }
  }

  view(row: UserRow): void {
    if (row.role === 'Hostel Owner') {
      this.selectedAdminId = row.id;
      this.adminPanelTab = 'details';
      this.adminPanelOpen = true;
    } else {
      this.selectedResidentId = row.id;
      this.residentPanelOpen = true;
    }
  }
}
