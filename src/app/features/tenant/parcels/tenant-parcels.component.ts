import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { ParcelsService, TenantParcelView } from '../../parcels/parcels.service';
import { OVERDUE_DAYS, PICKUP_STATUSES, PICKUP_TONES } from '../../parcels/parcels.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase } from '../daily-kit/tenant-page.base';

@Component({
  selector: 'app-tenant-parcels',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading your parcels..." (retry)="reload()">
        @if (awaiting.length) {
          <div class="td-banner td-banner--warn" role="status">
            <mat-icon>inventory_2</mat-icon>
            <p><strong>{{ awaiting.length }} parcel{{ awaiting.length === 1 ? '' : 's' }} waiting for you.</strong>
              Collect {{ awaiting.length === 1 ? 'it' : 'them' }} from the pickup location shown below. Staff record the pickup when they hand it over; bring a photo ID.</p>
          </div>
        } @else if (all.length) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>You have no parcels waiting for pickup.</p></div>
        }

        <div class="td-filters">
          <label class="sr-only" for="pc-status">Pickup status</label>
          <select id="pc-status" [(ngModel)]="status" (ngModelChange)="apply()">
            <option value="All">All statuses</option>
            @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
          </select>
          <label class="sr-only" for="pc-courier">Courier</label>
          <select id="pc-courier" [(ngModel)]="courier" (ngModelChange)="apply()">
            <option value="All">All couriers</option>
            @for (c of couriers; track c) { <option [value]="c">{{ c }}</option> }
          </select>
          <label class="sr-only" for="pc-search">Search parcels</label>
          <input id="pc-search" type="search" placeholder="Search reference or tracking number" [(ngModel)]="search" (ngModelChange)="apply()" />
          @if (hasFilters) { <app-button variant="text" size="sm" icon="restart_alt" (clicked)="clearFilters()">Reset</app-button> }
        </div>

        <section class="td-card" aria-label="My parcels">
          @if (shown.length === 0) {
            <app-empty-state
              [icon]="hasFilters ? 'search_off' : 'inventory_2'"
              [message]="hasFilters ? 'No parcels match your filters' : 'No parcels yet'"
              [hint]="hasFilters ? 'Try a different status, courier or search.' : 'When the hostel receives a parcel for you, it will appear here and you will get a notification.'"
              [clearable]="hasFilters"
              (clear)="clearFilters()"></app-empty-state>
          } @else {
            <ul class="td-list">
              @for (p of shown; track p.id) {
                <li class="td-row">
                  <div class="td-row__main">
                    <div class="td-row__title">{{ p.courier }} <span class="td-small td-muted">{{ p.id }}</span></div>
                    <div class="td-row__meta">
                      <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">confirmation_number</mat-icon>{{ p.tracking || 'No tracking number' }}</span>
                      <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">place</mat-icon>{{ p.pickupLocation || 'Ask at reception' }}</span>
                      <span class="td-meta-item"><mat-icon fontSet="material-icons-outlined">schedule</mat-icon>Received {{ dt(p.receivedAt) }}</span>
                    </div>
                    <div class="td-row__sub">Recorded by {{ p.recordedBy }}</div>
                    @if (p.status === 'Awaiting Pickup' && p.overdue) {
                      <div class="td-row__sub" style="color: #b45309;">Waiting {{ p.ageDays }} days. Please collect it soon or it may be returned to the sender.</div>
                    }
                    @if (p.pickup; as k) {
                      <dl class="td-kv" style="margin-top: 8px;">
                        <dt>Pickup confirmed</dt><dd>{{ dt(k.at) }}</dd>
                        <dt>Collected by</dt><dd>{{ k.self ? 'You' : k.collectedBy + (k.relation ? ' (' + k.relation + ')' : '') }}</dd>
                        @if (k.confirmedBy) { <dt>Handed over by</dt><dd>{{ k.confirmedBy }} (staff)</dd> }
                      </dl>
                    }
                    @if (p.status === 'Returned') {
                      <div class="td-row__sub">Returned to the sender{{ p.returnedAt ? ' on ' + dt(p.returnedAt) : '' }}.</div>
                    }
                    @if (open === p.id) {
                      <h4 style="margin: 12px 0 0; font-size: 13px;">Notice history</h4>
                      @if (!p.notices.length) {
                        <p class="td-hint" style="margin: 4px 0 0;">No notifications were sent for this parcel.</p>
                      } @else {
                        <ul class="td-timeline" aria-label="Notice history">
                          @for (n of p.notices; track $index) {
                            <li><span class="t-at">{{ dt(n.at) }}</span>{{ n.kind === 'Arrival' ? 'Arrival notice' : 'Reminder' }} {{ n.status === 'Sent' ? 'sent' : 'could not be delivered' }}{{ n.status === 'Sent' ? ' via ' + n.channels : '' }}</li>
                          }
                        </ul>
                      }
                    }
                  </div>
                  <div class="td-row__side">
                    <span class="td-pill td-pill--{{ tone(p.status) }}">{{ p.status }}</span>
                    <app-button variant="text" size="sm" [icon]="open === p.id ? 'expand_less' : 'expand_more'" (clicked)="open = open === p.id ? '' : p.id">{{ open === p.id ? 'Hide notices' : 'Notices (' + p.notices.length + ')' }}</app-button>
                  </div>
                </li>
              }
            </ul>
          }
        </section>
        <p class="td-hint">Pickup is confirmed only by hostel staff. You cannot mark a parcel as collected here. Parcels not collected for more than {{ overdueDays }} days are flagged.</p>
      </app-tenant-state>
    </div>
  `,
})
export class TenantParcelsComponent extends TenantPageBase {
  readonly service = inject(ParcelsService);

  readonly statuses = PICKUP_STATUSES;
  readonly overdueDays = OVERDUE_DAYS;

  all: TenantParcelView[] = [];
  awaiting: TenantParcelView[] = [];
  shown: TenantParcelView[] = [];
  couriers: string[] = [];
  status = 'All';
  courier = 'All';
  search = '';
  open = '';

  constructor() {
    super();
    this.watch(this.service.parcels$);
    this.start();
  }

  get hasFilters(): boolean {
    return this.status !== 'All' || this.courier !== 'All' || !!this.search.trim();
  }

  protected refresh(): void {
    this.all = this.service.tenantParcels();
    this.awaiting = this.all.filter((p) => p.status === 'Awaiting Pickup');
    this.couriers = [...new Set(this.all.map((p) => p.courier))].sort();
    if (this.courier !== 'All' && !this.couriers.includes(this.courier)) this.courier = 'All';
    this.apply();
  }

  apply(): void {
    const q = this.search.trim().toLowerCase();
    this.shown = this.all.filter(
      (p) =>
        (this.status === 'All' || p.status === this.status) &&
        (this.courier === 'All' || p.courier === this.courier) &&
        (!q || `${p.id} ${p.tracking ?? ''}`.toLowerCase().includes(q)),
    );
  }

  clearFilters(): void {
    this.status = 'All';
    this.courier = 'All';
    this.search = '';
    this.apply();
  }

  tone(s: string): string {
    return PICKUP_TONES[s as keyof typeof PICKUP_TONES] ?? 'neutral';
  }
}
