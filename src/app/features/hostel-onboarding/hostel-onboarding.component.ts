import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { HostelOnboardingRow, ONBOARDED_HOSTELS } from './onboarded-hostels';
import { MOCK_HOSTEL_RECORDS } from './add-hostel/mock-hostel-records';

export type { HostelOnboardingRow } from './onboarded-hostels';

type StatusFilter = 'All' | HostelOnboardingRow['status'];

/** Avatar / pin colours, picked per hostel so each row is easy to tell apart. */
const TONES = ['blue', 'purple', 'green', 'amber'] as const;

@Component({
  selector: 'app-hostel-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    MatTooltipModule,
    AppTableCardComponent,
    AppButtonComponent,
    AppDatePipe,
  ],
  template: `
    <div class="onboarding-page">
      <!-- Summary KPIs (display only) -->
      <div class="stats">
        @for (tile of tiles; track tile.status) {
          <div class="stat-tile stat-tile--{{ tile.tone }}">
            <span class="stat-tile__icon"><mat-icon [fontSet]="tile.outlined ? 'material-icons-outlined' : ''">{{ tile.icon }}</mat-icon></span>
            <span class="stat-tile__text">
              <span class="stat-tile__value">{{ countFor(tile.status) }}</span>
              <span class="stat-tile__label">{{ tile.label }}</span>
            </span>
          </div>
        }
      </div>

      <!-- Toolbar: search · status filters · New -->
      <div class="list-toolbar">
        <mat-form-field appearance="outline" class="filter-field filter-field--search">
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            type="text"
            placeholder="Search by name, ID, city or contact"
            [(ngModel)]="searchTerm"
            (ngModelChange)="currentPage = 0"
          />
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

        <div class="status-pills" role="group" aria-label="Filter by status">
          @for (s of statusOptions; track s) {
            <button
              type="button"
              class="status-pill status-pill--{{ s.toLowerCase() }}"
              [class.status-pill--selected]="statusFilter === s"
              [attr.aria-pressed]="statusFilter === s"
              (click)="setStatus(s)"
            >
              {{ s }}
              <span class="status-pill__dot" aria-hidden="true"></span>
              {{ countFor(s) }}
            </button>
          }
        </div>

        <app-button class="list-toolbar__add" icon="add" (clicked)="onAddHostel()">New</app-button>
      </div>

      <!-- Table (header always shown, so columns stay put when nothing matches) -->
      <app-table-card
        class="hostel-table-card"
        [empty]="filteredRows.length === 0"
        [emptyIcon]="isFiltering ? 'search_off' : 'apartment'"
        [emptyMessage]="emptyMessage"
        [emptyHint]="isFiltering ? 'Try a different name, ID, city or contact, or clear the filters.' : 'Onboard your first hostel to see it here.'"
        [clearable]="isFiltering"
        (clear)="clearFilters()"
        [page]="safePage"
        [totalPages]="totalPages"
        [pageSize]="pageSize"
        (pageChange)="currentPage = $event"
        (pageSizeChange)="pageSize = $event; currentPage = 0"
      >
        <table mat-table [dataSource]="pagedRows" class="saas-table hostel-table">
          <ng-container matColumnDef="hostel">
            <th mat-header-cell *matHeaderCellDef> Hostel </th>
            <td mat-cell *matCellDef="let element">
              <div class="list-entity">
                <span class="list-entity__avatar list-avatar--{{ tone(element) }}">{{ initials(element.hostelName) }}</span>
                <span class="list-entity__text">
                  <span class="list-entity__name">{{ element.hostelName }}</span>
                  <span class="list-entity__sub">{{ element.hostelId }}</span>
                </span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="city">
            <th mat-header-cell *matHeaderCellDef> City/Branch </th>
            <td mat-cell *matCellDef="let element">
              <span class="with-icon">
                <mat-icon class="list-icon--{{ tone(element) }}">place</mat-icon>{{ element.city }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="contact">
            <th mat-header-cell *matHeaderCellDef> Contact Person </th>
            <td mat-cell *matCellDef="let element">
              <span class="list-entity__text">
                <span class="list-entity__name">{{ element.contactPerson }}</span>
                <span class="list-entity__sub">{{ phone(element) }}</span>
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef> Status </th>
            <td mat-cell *matCellDef="let element">
              <span class="status-badge status-badge--{{ element.status === 'Active' ? 'success' : 'warning' }}">{{ element.status }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="createdDate">
            <th mat-header-cell *matHeaderCellDef> Onboarded On </th>
            <td mat-cell *matCellDef="let element" class="date-cell"> {{ element.createdDate | appDate }} </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef class="actions-header"> Actions </th>
            <td mat-cell *matCellDef="let element" class="actions-cell">
              <app-button variant="outline" size="sm" icon="edit" [ariaLabel]="'Edit ' + element.hostelName" (clicked)="onEditHostel(element)">
                Edit
              </app-button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <!-- Rows are not clickable; only the Edit button opens a hostel. -->
          <tr mat-row *matRowDef="let row; columns: displayedColumns" class="table-row"></tr>
        </table>
      </app-table-card>
    </div>
  `,
  styles: [
    `
      .onboarding-page {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      /* ---- KPI tiles: coloured accent edge + icon tile ---- */
      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;

        @media (max-width: 900px) {
          grid-template-columns: 1fr;
        }
      }

      .stat-tile {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 16px;
        background: #ffffff;
        border-radius: 12px;
        border-left: 3px solid var(--tone);
        box-shadow: 0 8px 24px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04);
      }

      .stat-tile--blue { --tone: #3b82f6; --tone-bg: #e0ecff; }
      .stat-tile--green { --tone: #22c55e; --tone-bg: #dcfce7; }
      .stat-tile--amber { --tone: #f59e0b; --tone-bg: #ffedd5; }

      .stat-tile__icon {
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        border-radius: 10px;
        background: var(--tone-bg);
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
        }
      }

      .stat-tile--blue .stat-tile__icon { color: #2563eb; }
      .stat-tile--green .stat-tile__icon { color: #16a34a; }
      .stat-tile--amber .stat-tile__icon { color: #ea580c; }

      .stat-tile__text {
        display: flex;
        flex-direction: column;
      }

      .stat-tile__value {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
        color: #0f172a;
      }

      .stat-tile__label {
        font-size: 13px;
        color: #64748b;
      }

      /* ---- Toolbar ---- */
      .list-toolbar {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;

        .filter-field--search {
          width: 360px;
          max-width: 100%;
        }

        .list-toolbar__add {
          margin-left: auto;
        }
      }

      .status-pills {
        display: flex;
        gap: 10px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: var(--btn-height);
        padding: 0 18px;
        border: none;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px #eef2f7;
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        color: #334155;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;

        &:hover:not(.status-pill--selected) {
          background: #f8fafc;
        }

        &:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
      }

      .status-pill__dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #94a3b8;
      }

      /* Dot colour per status; the selected pill is tinted blue. */
      .status-pill--all .status-pill__dot { background: #2563eb; }
      .status-pill--active .status-pill__dot { background: #22c55e; }
      .status-pill--draft .status-pill__dot { background: #f59e0b; }

      .status-pill--selected {
        background: #e8f0ff;
        color: #2563eb;
        box-shadow: none;
      }

      /* ---- Table ---- */
      .hostel-table-card {
        padding-top: 8px;
      }

      .date-cell {
        color: #334155 !important;
        white-space: nowrap;
      }
    `,
  ],
})
export class HostelOnboardingComponent {
  searchTerm = '';
  statusFilter: StatusFilter = 'All';
  pageSize = 10;
  currentPage = 0;

  readonly statusOptions: StatusFilter[] = ['All', 'Active', 'Draft'];

  readonly tiles: { status: StatusFilter; label: string; icon: string; tone: string; outlined: boolean }[] = [
    { status: 'All', label: 'Total Hostels', icon: 'apartment', tone: 'blue', outlined: true },
    { status: 'Active', label: 'Active', icon: 'check_circle', tone: 'green', outlined: false },
    { status: 'Draft', label: 'Draft', icon: 'description', tone: 'amber', outlined: false },
  ];

  displayedColumns: string[] = ['hostel', 'city', 'contact', 'status', 'createdDate', 'actions'];

  rows: HostelOnboardingRow[] = ONBOARDED_HOSTELS;

  get filteredRows(): HostelOnboardingRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.rows.filter(
      (row) =>
        (this.statusFilter === 'All' || row.status === this.statusFilter) &&
        (!term ||
          [row.hostelId, row.hostelName, row.city, row.contactPerson, row.mobileNumber].some((value) =>
            value.toLowerCase().includes(term),
          )),
    );
  }

  get isFiltering(): boolean {
    return !!this.searchTerm.trim() || this.statusFilter !== 'All';
  }

  get emptyMessage(): string {
    if (this.searchTerm) return 'No hostels match your search';
    if (this.statusFilter !== 'All') return `No ${this.statusFilter.toLowerCase()} hostels`;
    return 'No hostels onboarded yet';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  /** Clamps `currentPage` so it stays valid after a search or page-size change shrinks the result set. */
  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get pagedRows(): HostelOnboardingRow[] {
    const start = this.safePage * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  constructor(private router: Router) {}

  countFor(status: StatusFilter): number {
    return status === 'All' ? this.rows.length : this.rows.filter((r) => r.status === status).length;
  }

  setStatus(status: StatusFilter): void {
    this.statusFilter = status;
    this.currentPage = 0;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.setStatus('All');
  }

  /** "Grand Stay Hostel" → "GS" */
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  /** A stable colour per hostel (same hostel → same colour). */
  tone(row: HostelOnboardingRow): string {
    const n = [...row.hostelId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return TONES[n % TONES.length];
  }

  /** "+91 98765 43210" — country code from the hostel's saved details when known. */
  phone(row: HostelOnboardingRow): string {
    const digits = row.mobileNumber.replace(/\D/g, '');
    const grouped = digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : row.mobileNumber;
    const code = MOCK_HOSTEL_RECORDS[row.hostelId]?.hostelInfo.contactCountryCode;
    return code ? `${code} ${grouped}` : grouped;
  }

  onAddHostel(): void {
    this.router.navigate(['/hostel-onboarding/new']);
  }

  onEditHostel(row: HostelOnboardingRow): void {
    this.router.navigate(['/hostel-onboarding', row.hostelId, 'edit']);
  }
}
