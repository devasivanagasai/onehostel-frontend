import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { HostelSettingsService } from '../../../core/services/hostel-settings.service';
import { RoomsService } from '../../../core/services/rooms.service';
import { TenantContextService } from '../../../core/services/tenant-context.service';
import { HostelProfile, HostelRules } from '../../../core/models/hostel-settings.models';
import { HostelResident } from '../../../core/models/residents.models';
import { Bed, BedAllocationHistory, Room } from '../../../core/models/rooms.models';

type LoadState = 'loading' | 'ready' | 'error';

interface HistoryRow {
  entry: BedAllocationHistory;
  room: Room;
  bed: Bed;
}

/** My Hostel & Room (FRD 5.4): read-only. The Tenant can see the allocation but never change it. */
@Component({
  selector: 'app-tenant-hostel',
  standalone: true,
  imports: [RouterLink, MatIconModule, AppButtonComponent],
  templateUrl: './tenant-hostel.component.html',
  styleUrl: './tenant-hostel.component.scss',
})
export class TenantHostelComponent implements OnInit {
  readonly tenant = inject(TenantContextService);
  readonly fmt = inject(AppFormatService);
  private readonly settings = inject(HostelSettingsService);
  private readonly rooms = inject(RoomsService);
  private readonly destroyRef = inject(DestroyRef);

  state: LoadState = 'loading';
  resident?: HostelResident;
  allocation?: { room: Room; bed: Bed };
  hostel?: HostelProfile;
  rules?: HostelRules;
  hostelFacilities: string[] = [];
  roomFacilities: string[] = [];
  /** Current stay first, then earlier ones. Only this Tenant's own entries. */
  history: HistoryRow[] = [];

  ngOnInit(): void {
    combineLatest([this.tenant.resident$, this.rooms.rooms$, this.settings.state$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.read();
        if (this.state !== 'loading') this.state = this.resident ? 'ready' : 'error';
      });
    this.load();
  }

  load(): void {
    this.state = 'loading';
    setTimeout(() => {
      this.read();
      this.state = this.resident ? 'ready' : 'error';
    }, 250);
  }

  get address(): string {
    const h = this.hostel;
    return h ? [h.addressLine1, h.addressLine2, h.city, h.state, h.pincode].filter(Boolean).join(', ') : '';
  }

  allocationType(row: HistoryRow): string {
    return row.entry.checkOutDate ? 'Ended' : 'Current';
  }

  private read(): void {
    const me = this.tenant.residentId;
    this.resident = this.tenant.resident;
    this.allocation = this.tenant.allocation;
    const value = this.settings.state.value;
    this.hostel = value.profile;
    this.rules = value.rules;
    this.hostelFacilities = value.facilities;
    const room = this.allocation?.room;
    const roomFacilities = new Set(room?.facilities ?? []);
    if (room?.hasAC) roomFacilities.add('AC');
    if (room?.hasAttachedWashroom) roomFacilities.add('Attached Washroom');
    if (room?.hasBalcony) roomFacilities.add('Balcony');
    this.roomFacilities = [...roomFacilities];
    this.history = me ? this.rooms.allocationHistoryFor(me) : [];
  }
}
