import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ACTIVITY_TYPES, ActivityEntry, ActivityType, RETENTION_NOTE, TenantActivityService } from '../../../core/services/tenant-activity.service';
import { AppPaginationComponent } from '../../../shared/components/pagination/app-pagination.component';
import { errMsg, fmtDateTime, fmtMoney, toneOf } from '../guardians/tn-ui';

const ICONS: Record<ActivityType, string> = { Payment: 'payments', Complaint: 'build_circle', Booking: 'local_laundry_service', Visitor: 'badge', Leave: 'exit_to_app', Parcel: 'inventory_2', Room: 'meeting_room' };

@Component({
  selector: 'app-tenant-activity',
  standalone: true,
  imports: [FormsModule, MatIconModule, AppPaginationComponent],
  styleUrl: './tenant-activity.component.scss',
  template: `
    <div class="tn-page">
      <div class="tn-banner" role="note"><mat-icon aria-hidden="true">history</mat-icon><div>{{ retention }}</div></div>

      <section class="tn-card" aria-label="Filters">
        <div class="tn-chip-row" role="group" aria-label="Filter by type">
          <button type="button" class="tn-chip" [attr.aria-pressed]="!types.size" (click)="clearTypes()">All</button>
          @for (t of allTypes; track t) { <button type="button" class="tn-chip" [attr.aria-pressed]="types.has(t)" (click)="toggleType(t)">{{ t === 'Room' ? 'Room Allocations' : t === 'Booking' ? 'Bookings' : t + 's' }}</button> }
        </div>
        <div class="tn-form" style="margin-top:12px">
          <div class="tn-field"><label for="act-from">From</label><input id="act-from" type="date" [(ngModel)]="from" (ngModelChange)="page = 0" [max]="to || ''" /></div>
          <div class="tn-field"><label for="act-to">To</label><input id="act-to" type="date" [(ngModel)]="to" (ngModelChange)="page = 0" [min]="from || ''" /></div>
          <div class="tn-field"><label for="act-q">Search</label><input id="act-q" type="search" [(ngModel)]="query" (ngModelChange)="page = 0" placeholder="Title, reference or status" autocomplete="off" /></div>
        </div>
        @if (filtering) { <button type="button" class="tn-btn tn-btn--ghost" style="margin-top:10px" (click)="reset()">Clear filters</button> }
      </section>

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading activity"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else if (!all.length) {
        <div class="tn-card tn-state" role="status"><mat-icon aria-hidden="true">history</mat-icon><p><strong>No activity yet</strong></p><p class="tn-sub">Payments, complaints, bookings, visits, leave and parcels will appear here.</p></div>
      } @else if (!filtered.length) {
        <div class="tn-card tn-state" role="status"><mat-icon aria-hidden="true">search_off</mat-icon><p><strong>Nothing matches your filters</strong></p><button type="button" class="tn-btn tn-btn--ghost" (click)="reset()">Clear filters</button></div>
      } @else {
        <section class="tn-card" aria-label="Activity timeline">
          <ul class="tn-list">
            @for (e of pageRows; track e.id) {
              <li class="tn-row" style="flex-wrap:nowrap;align-items:flex-start">
                <mat-icon aria-hidden="true" style="color:#0d9488;flex-shrink:0">{{ icon(e.type) }}</mat-icon>
                <div style="flex:1;min-width:0">
                  <div class="tn-row tn-row--between">
                    <strong>{{ e.title }}</strong>
                    <span class="tn-pill tn-pill--{{ tone(e.status) }}">{{ e.status }}</span>
                  </div>
                  <div class="tn-sub">{{ e.type }} · {{ dateTime(e.at) }}@if (e.reference) { · Ref {{ e.reference }} }</div>
                  <div>{{ e.detail }}@if (e.amount !== undefined) { · <strong>{{ money(e.amount) }}</strong> }</div>
                </div>
              </li>
            }
          </ul>
          <app-pagination [page]="safePage" [totalPages]="totalPages" [pageSize]="pageSize" (pageChange)="page = $event" (pageSizeChange)="pageSize = $event; page = 0">
            <span class="tn-sub">Showing {{ safePage * pageSize + 1 }}-{{ Math.min((safePage + 1) * pageSize, filtered.length) }} of {{ filtered.length }}</span>
          </app-pagination>
        </section>
      }
    </div>
  `,
})
export class TenantActivityComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantActivityService);
  readonly retention = RETENTION_NOTE;
  readonly allTypes = ACTIVITY_TYPES;
  readonly tone = toneOf;
  readonly dateTime = fmtDateTime;
  readonly money = fmtMoney;
  readonly Math = Math;
  readonly icon = (t: ActivityType): string => ICONS[t];

  all: ActivityEntry[] = [];
  types = new Set<ActivityType>();
  from = '';
  to = '';
  query = '';
  page = 0;
  pageSize = 10;
  loading = true;
  loadError = '';
  private sub?: Subscription;

  get filtering(): boolean {
    return !!(this.types.size || this.from || this.to || this.query.trim());
  }

  get filtered(): ActivityEntry[] {
    const q = this.query.trim().toLowerCase();
    return this.all.filter((e) => {
      if (this.types.size && !this.types.has(e.type)) return false;
      const day = e.at.slice(0, 10);
      if (this.from && day < this.from) return false;
      if (this.to && day > this.to) return false;
      return !q || `${e.title} ${e.detail} ${e.status} ${e.reference ?? ''} ${e.type}`.toLowerCase().includes(q);
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.page, this.totalPages - 1);
  }

  get pageRows(): ActivityEntry[] {
    return this.filtered.slice(this.safePage * this.pageSize, (this.safePage + 1) * this.pageSize);
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.sub?.unsubscribe();
    setTimeout(() => {
      try {
        this.sub = this.service.entries$.subscribe((e) => (this.all = e));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  toggleType(t: ActivityType): void {
    const next = new Set(this.types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    this.types = next;
    this.page = 0;
  }

  clearTypes(): void {
    this.types = new Set();
    this.page = 0;
  }

  reset(): void {
    this.types = new Set();
    this.from = '';
    this.to = '';
    this.query = '';
    this.page = 0;
  }
}
