import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import {
  COMMUNICATION_CHANNELS,
  CommunicationChannel,
  CommunicationTemplateRow,
} from './communication-template.models';
import { CommunicationTemplateService } from './communication-template.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';

type ChannelFilter = CommunicationChannel | 'All';

/** Icon tile colour per channel (table + filter pills). */
const CHANNEL_TONE: Record<CommunicationChannel, string> = {
  Email: 'blue',
  SMS: 'green',
  'Push Notification': 'purple',
};

@Component({
  selector: 'app-communication-templates',
  standalone: true,
  imports: [
    AppDatePipe,
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    AppTableCardComponent,
    AppButtonComponent,
  ],
  template: `
    <div class="onboarding-page templates-page">
      <!-- Summary KPIs (display only) -->
      <div class="stats">
        @for (tile of tiles; track tile.label) {
          <div class="stat-tile stat-tile--{{ tile.tone }}">
            <span class="stat-tile__icon"><mat-icon fontSet="material-icons-outlined">{{ tile.icon }}</mat-icon></span>
            <span class="stat-tile__text">
              <span class="stat-tile__label">{{ tile.label }}</span>
              <span class="stat-tile__value">{{ tile.count }}</span>
            </span>
            <svg class="stat-tile__spark" viewBox="0 0 48 20" aria-hidden="true">
              <path d="M2 13 C7 13 8 7 13 8 S19 15 24 12 S30 6 35 9 S42 12 46 8" />
            </svg>
          </div>
        }
      </div>

      <!-- Toolbar: search · channel filters · New -->
      <div class="list-toolbar">
        <mat-form-field appearance="outline" class="filter-field filter-field--search">
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            type="text"
            placeholder="Search templates by name, ID or trigger..."
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

        <div class="channel-pills" role="group" aria-label="Filter by communication type">
          <button
            type="button"
            class="channel-pill"
            [class.channel-pill--selected]="channelFilter === 'All'"
            [attr.aria-pressed]="channelFilter === 'All'"
            (click)="setChannel('All')"
          >
            <mat-icon fontSet="material-icons-outlined">grid_view</mat-icon>
            All
          </button>
          @for (ch of channels; track ch.value) {
            <button
              type="button"
              class="channel-pill"
              [class.channel-pill--selected]="channelFilter === ch.value"
              [attr.aria-pressed]="channelFilter === ch.value"
              (click)="setChannel(ch.value)"
            >
              <mat-icon fontSet="material-icons-outlined">{{ pillIcon(ch.value) }}</mat-icon>
              {{ ch.value }}
            </button>
          }
        </div>

        <app-button class="list-toolbar__add" icon="add" (clicked)="onAddTemplate()">New</app-button>
      </div>

      <!-- Table (header always shown, so columns stay put when nothing matches) -->
      <app-table-card
        class="templates-table-card"
        [empty]="filteredRows.length === 0"
        [emptyIcon]="isFiltering ? 'search_off' : 'forum'"
        [emptyMessage]="isFiltering ? 'No templates match your filters' : 'No templates yet'"
        [emptyHint]="isFiltering ? 'Try a different name, ID or trigger, or clear the filters.' : 'Create your first template to see it here.'"
        [clearable]="isFiltering"
        (clear)="clearFilters()"
        [page]="safePage"
        [totalPages]="totalPages"
        [pageSize]="pageSize"
        (pageChange)="currentPage = $event"
        (pageSizeChange)="pageSize = $event; currentPage = 0"
      >
          <table mat-table [dataSource]="pagedRows" class="saas-table templates-table">
            <ng-container matColumnDef="template">
              <th mat-header-cell *matHeaderCellDef> Template </th>
              <td mat-cell *matCellDef="let element">
                <div class="list-entity">
                  <span class="list-entity__avatar list-avatar--{{ channelTone(element.channel) }}">{{ initials(element.templateName) }}</span>
                  <span class="list-entity__text">
                    <span class="list-entity__name">{{ element.templateName }}</span>
                    <span class="list-entity__sub">{{ element.templateId }}</span>
                  </span>
                </div>
              </td>
            </ng-container>

            <ng-container matColumnDef="channel">
              <th mat-header-cell *matHeaderCellDef> Communication Type </th>
              <td mat-cell *matCellDef="let element">
                <span class="with-icon">
                  <mat-icon class="list-icon--{{ channelTone(element.channel) }}">{{ channelIcon(element.channel) }}</mat-icon>{{ element.channel }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="trigger">
              <th mat-header-cell *matHeaderCellDef> Trigger / Event </th>
              <td mat-cell *matCellDef="let element" class="text-cell"> {{ element.trigger }} </td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef> Status </th>
              <td mat-cell *matCellDef="let element">
                <span class="status-badge status-badge--{{ element.status === 'Active' ? 'success' : 'danger' }}">{{ element.status }}</span>
              </td>
            </ng-container>

            <ng-container matColumnDef="lastModified">
              <th mat-header-cell *matHeaderCellDef> Last Modified </th>
              <td mat-cell *matCellDef="let element" class="text-cell date-cell"> {{ element.lastModified | appDate }} </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions-header"> Actions </th>
              <td mat-cell *matCellDef="let element" class="actions-cell">
                <app-button variant="outline" size="sm" icon="edit" [ariaLabel]="'Edit ' + element.templateName" (clicked)="onEditTemplate(element)">
                  Edit
                </app-button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns" class="table-row"></tr>
          </table>
      </app-table-card>
    </div>
  `,
  styles: [
    `
      .templates-page {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      /* ---- KPI tiles ---- */
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
        padding: 14px 18px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04);
      }

      .stat-tile--blue { --tone: #2563eb; --tone-bg: #e8f0ff; }
      .stat-tile--green { --tone: #16a34a; --tone-bg: #e7f8ee; }
      .stat-tile--red { --tone: #ef4444; --tone-bg: #feecec; }

      .stat-tile__icon {
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 10px;
        background: var(--tone-bg);
        color: var(--tone);
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 23px;
          width: 23px;
          height: 23px;
        }
      }

      .stat-tile__text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }

      .stat-tile__label {
        font-size: 13px;
        color: #64748b;
      }

      .stat-tile__value {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
        color: #0f172a;
      }

      /* Small decorative trend line in a soft circle. */
      .stat-tile__spark {
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        padding: 12px 4px;
        border-radius: 50%;
        background: var(--tone-bg);
        opacity: 0.85;

        path {
          fill: none;
          stroke: var(--tone);
          stroke-width: 1.8;
          stroke-linecap: round;
        }
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

      .channel-pills {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .channel-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: var(--btn-height);
        padding: 0 16px;
        border: none;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px #e5eaf1;
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        color: #334155;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &:hover:not(.channel-pill--selected) {
          background: #f8fafc;
        }

        &:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
      }

      .channel-pill--selected {
        background: #e8f0ff;
        color: #2563eb;
        box-shadow: 0 0 0 1px #93c5fd;
      }

      /* ---- Table ---- */
      .templates-table-card {
        padding-top: 8px;
      }

      .text-cell {
        color: #334155 !important;
      }

      .date-cell {
        white-space: nowrap;
      }
    `,
  ],
})
export class CommunicationTemplatesComponent {
  searchTerm = '';
  channelFilter: ChannelFilter = 'All';
  pageSize = 10;
  currentPage = 0;

  readonly channels = COMMUNICATION_CHANNELS;

  displayedColumns: string[] = [
    'template',
    'channel',
    'trigger',
    'status',
    'lastModified',
    'actions',
  ];

  constructor(
    private router: Router,
    private templateService: CommunicationTemplateService,
  ) {}

  get rows(): CommunicationTemplateRow[] {
    return this.templateService.templates;
  }

  get tiles(): { label: string; count: number; icon: string; tone: string }[] {
    const active = this.rows.filter((r) => r.status === 'Active').length;
    return [
      { label: 'Total Templates', count: this.rows.length, icon: 'description', tone: 'blue' },
      { label: 'Active Templates', count: active, icon: 'check_circle', tone: 'green' },
      { label: 'Inactive Templates', count: this.rows.length - active, icon: 'cancel', tone: 'red' },
    ];
  }

  channelIcon(channel: CommunicationChannel): string {
    return COMMUNICATION_CHANNELS.find((c) => c.value === channel)?.icon ?? 'chat';
  }

  channelTone(channel: CommunicationChannel): string {
    return CHANNEL_TONE[channel] ?? 'blue';
  }

  /** Outlined icons for the filter pills (the table uses filled ones on coloured tiles). */
  pillIcon(channel: CommunicationChannel): string {
    return channel === 'Email' ? 'mail' : channel === 'SMS' ? 'sms' : 'notifications';
  }

  get filteredRows(): CommunicationTemplateRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.rows.filter((row) => {
      if (this.channelFilter !== 'All' && row.channel !== this.channelFilter) return false;
      if (!term) return true;
      return [row.templateId, row.templateName, row.templateCode, row.trigger, row.status].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }

  get isFiltering(): boolean {
    return !!this.searchTerm.trim() || this.channelFilter !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  /** Clamps `currentPage` so it stays valid after a search or filter change shrinks the result set. */
  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get pagedRows(): CommunicationTemplateRow[] {
    const start = this.safePage * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  /** "Hostel Owner Account Created (SMS)" → "HO" */
  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  setChannel(channel: ChannelFilter): void {
    this.channelFilter = channel;
    this.currentPage = 0;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.setChannel('All');
  }

  onAddTemplate(): void {
    this.router.navigate(['/communication-templates', 'new']);
  }

  onEditTemplate(row: CommunicationTemplateRow): void {
    this.router.navigate(['/communication-templates', row.templateId, 'edit']);
  }
}
