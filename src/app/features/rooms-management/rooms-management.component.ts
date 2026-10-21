import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { Observable } from 'rxjs';
import { RoomsService } from './rooms.service';
import { ResidentsService } from '../residents/residents.service';
import { Bed, Room, RoomFilterState, RoomStats, RoomStatus } from './rooms.models';
import { RoomModalComponent } from './room-modal/room-modal.component';
import { BedModalComponent } from './bed-modal/bed-modal.component';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AppEmptyStateComponent } from '../../shared/components/empty-state/app-empty-state.component';
import { AppPaginationComponent } from '../../shared/components/pagination/app-pagination.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppFormatService } from '../../core/services/app-format.service';

@Component({
  selector: 'app-rooms-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    MatMenuModule,
    AppEmptyStateComponent,
    AppPaginationComponent,
    AppButtonComponent,
  ],
  templateUrl: './rooms-management.component.html',
  styleUrl: './rooms-management.component.scss',
})
export class RoomsManagementComponent implements OnInit {
  private readonly roomsService = inject(RoomsService);
  private readonly residentsService = inject(ResidentsService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly snackBar = inject(MatSnackBar);
  readonly fmt = inject(AppFormatService);

  readonly stats$: Observable<RoomStats> = this.roomsService.stats$;

  // Pagination
  readonly pageSize = 6;
  currentPage = 0;

  // Filters
  filters: RoomFilterState = {
    search: '',
    building: 'All',
    floor: 'All',
    roomType: 'All',
    status: 'All',
    gender: 'All',
    acOnly: false,
  };

  readonly buildings = [
    { value: 'All', label: 'All Buildings' },
    { value: 'Block A', label: 'Block A' },
    { value: 'Block B', label: 'Block B' },
    { value: 'Block C', label: 'Block C' },
    { value: 'Main Wing', label: 'Main Wing' },
  ];

  readonly floors = [
    { value: 'All', label: 'All Floors' },
    { value: 'Ground Floor', label: 'Ground Floor' },
    { value: '1st Floor', label: '1st Floor' },
    { value: '2nd Floor', label: '2nd Floor' },
    { value: '3rd Floor', label: '3rd Floor' },
    { value: '4th Floor', label: '4th Floor' },
  ];

  readonly roomTypes = [
    { value: 'All', label: 'All Types' },
    { value: 'Single', label: 'Single' },
    { value: 'Double', label: 'Double' },
    { value: 'Triple', label: 'Triple' },
    { value: 'Four Sharing', label: 'Four Sharing' },
    { value: 'Dormitory', label: 'Dormitory' },
  ];

  readonly statuses = [
    { value: 'All', label: 'All Status' },
    { value: 'Available', label: 'Available' },
    { value: 'Full', label: 'Full' },
    { value: 'Maintenance', label: 'Maintenance' },
    { value: 'Inactive', label: 'Inactive' },
  ];

  readonly genderOptions = [
    { value: 'All', label: 'All Genders' },
    { value: 'Any', label: 'Co-ed / Any' },
    { value: 'Male', label: 'Male Only' },
    { value: 'Female', label: 'Female Only' },
  ];

  ngOnInit(): void {}

  get filteredRooms(): Room[] {
    const list = this.roomsService.rooms;
    return list.filter((r) => {
      // Search
      if (this.filters.search.trim()) {
        const q = this.filters.search.toLowerCase().trim();
        const matchesRoom = r.roomNumber.toLowerCase().includes(q);
        const matchesBuilding = r.building.toLowerCase().includes(q);
        const matchesFloor = r.floor.toLowerCase().includes(q);
        const matchesTenant = r.beds.some(
          (b) => b.tenantName?.toLowerCase().includes(q) || b.tenantContact?.includes(q),
        );
        if (!matchesRoom && !matchesBuilding && !matchesFloor && !matchesTenant) return false;
      }

      // Building filter
      if (this.filters.building !== 'All' && r.building !== this.filters.building) {
        return false;
      }

      // Floor filter
      if (this.filters.floor !== 'All' && r.floor !== this.filters.floor) {
        return false;
      }

      // Room type
      if (this.filters.roomType !== 'All' && r.roomType !== this.filters.roomType) {
        return false;
      }

      // Status
      if (this.filters.status !== 'All' && r.status !== this.filters.status) {
        return false;
      }

      // Gender restriction
      if (this.filters.gender !== 'All' && r.genderRestriction !== this.filters.gender) {
        return false;
      }

      // AC
      if (this.filters.acOnly && !r.hasAC) {
        return false;
      }

      return true;
    });
  }

  get totalPages(): number {
    return Math.ceil(this.filteredRooms.length / this.pageSize);
  }

  get safePage(): number {
    return Math.min(this.currentPage, Math.max(0, this.totalPages - 1));
  }

  get pagedRooms(): Room[] {
    const start = this.safePage * this.pageSize;
    return this.filteredRooms.slice(start, start + this.pageSize);
  }

  get hasActiveFilters(): boolean {
    return (
      !!this.filters.search.trim() ||
      this.filters.building !== 'All' ||
      this.filters.floor !== 'All' ||
      this.filters.roomType !== 'All' ||
      this.filters.status !== 'All' ||
      this.filters.gender !== 'All' ||
      this.filters.acOnly
    );
  }

  clearFilters(): void {
    this.filters = {
      search: '',
      building: 'All',
      floor: 'All',
      roomType: 'All',
      status: 'All',
      gender: 'All',
      acOnly: false,
    };
    this.currentPage = 0;
  }

  openAddRoomModal(): void {
    const ref = this.dialog.open(RoomModalComponent, {
      width: '1100px',
      maxWidth: '95vw',
      data: {},
    });

    ref.afterClosed().subscribe((result) => {
      if (result) {
        try {
          this.roomsService.saveRoom(result);
          this.snackBar.open(`Room ${result.roomNumber} created successfully!`, 'Close', { duration: 3000 });
        } catch (err: any) {
          this.snackBar.open(err?.message || 'Error creating room.', 'Close', { duration: 4500 });
        }
      }
    });
  }

  openEditRoomModal(room: Room): void {
    const ref = this.dialog.open(RoomModalComponent, {
      width: '1100px',
      maxWidth: '95vw',
      data: { room },
    });

    ref.afterClosed().subscribe((result) => {
      if (result) {
        try {
          this.roomsService.saveRoom(result);
          this.snackBar.open(`Room ${result.roomNumber} updated successfully!`, 'Close', { duration: 3000 });
        } catch (err: any) {
          this.snackBar.open(err?.message || 'Error updating room.', 'Close', { duration: 4500 });
        }
      }
    });
  }

  // Quick Action: Add Beds
  onAddBeds(room: Room): void {
    this.confirmDialog
      .confirm({
        title: `Add 1 Bed to Room ${room.roomNumber}?`,
        message: `Current capacity is ${room.capacity} beds. Adding 1 bed will increase capacity to ${room.capacity + 1} beds.`,
        confirmLabel: 'Add Bed',
        tone: 'primary',
      })
      .subscribe((confirmed) => {
        if (confirmed) {
          try {
            this.roomsService.addBeds(room.id, 1);
            this.snackBar.open(`Bed added to Room ${room.roomNumber}.`, 'Close', { duration: 3000 });
          } catch (err: any) {
            this.snackBar.open(err?.message || 'Failed to add bed.', 'Close', { duration: 4000 });
          }
        }
      });
  }

  // Quick Action: Mark Maintenance
  onToggleMaintenance(room: Room): void {
    const isMaint = room.status === 'Maintenance';
    const newStatus = isMaint ? 'Available' : 'Maintenance';
    this.confirmDialog
      .confirm({
        title: isMaint ? `Re-activate Room ${room.roomNumber}?` : `Mark Room ${room.roomNumber} under Maintenance?`,
        message: isMaint
          ? `This will restore available beds in Room ${room.roomNumber} so they can be allocated.`
          : `Beds in Maintenance rooms cannot be allocated until maintenance is complete.`,
        confirmLabel: isMaint ? 'Re-activate' : 'Mark Maintenance',
        tone: isMaint ? 'primary' : 'warning',
      })
      .subscribe((confirmed) => {
        if (confirmed) {
          this.roomsService.setRoomStatus(room.id, newStatus, isMaint ? undefined : 'Routine inspection & repair');
          this.snackBar.open(`Room ${room.roomNumber} marked as ${newStatus}.`, 'Close', { duration: 3000 });
        }
      });
  }

  // Quick Action: Deactivate / Activate Room
  onToggleDeactivate(room: Room): void {
    const isInactive = room.status === 'Inactive';
    const newStatus = isInactive ? 'Available' : 'Inactive';
    this.confirmDialog
      .confirm({
        title: isInactive ? `Activate Room ${room.roomNumber}?` : `Deactivate Room ${room.roomNumber}?`,
        message: isInactive
          ? `Room ${room.roomNumber} will be reopened for bed allocations.`
          : `Deactivating will take Room ${room.roomNumber} out of service. Active allocations remain intact.`,
        confirmLabel: isInactive ? 'Activate' : 'Deactivate',
        tone: isInactive ? 'primary' : 'danger',
      })
      .subscribe((confirmed) => {
        if (confirmed) {
          this.roomsService.setRoomStatus(room.id, newStatus);
          this.snackBar.open(`Room ${room.roomNumber} is now ${newStatus}.`, 'Close', { duration: 3000 });
        }
      });
  }

  deleteRoom(room: Room): void {
    const hasOccupants = room.beds.some((b) => b.status === 'Occupied' || b.status === 'Reserved');
    if (hasOccupants) {
      this.snackBar.open(`Cannot delete Room ${room.roomNumber} because it has active bed allocations.`, 'Close', {
        duration: 4000,
      });
      return;
    }

    this.confirmDialog
      .confirm({
        title: `Delete Room ${room.roomNumber}?`,
        message: `Are you sure you want to delete Room ${room.roomNumber} (${room.building}, ${room.floor})? This will remove all associated beds.`,
        confirmLabel: 'Delete Room',
        tone: 'danger',
      })
      .subscribe((confirmed) => {
        if (confirmed) {
          try {
            this.roomsService.deleteRoom(room.id);
            this.snackBar.open(`Room ${room.roomNumber} deleted.`, 'Close', { duration: 3000 });
          } catch (err: any) {
            this.snackBar.open(err?.message || 'Error deleting room.', 'Close', { duration: 4000 });
          }
        }
      });
  }

  openBedModal(room: Room, bed: Bed, mode?: 'manage' | 'allocate' | 'transfer' | 'checkout'): void {
    const ref = this.dialog.open(BedModalComponent, {
      width: '680px',
      data: {
        room,
        bed,
        allRooms: this.roomsService.rooms,
        mode,
      },
    });

    ref.afterClosed().subscribe((res) => {
      if (!res) return;

      // Bed actions go through ResidentsService when the bed holds a known resident,
      // so the resident's status and activity history stay in sync.
      const residentId = bed.residentId && this.residentsService.byId(bed.residentId) ? bed.residentId : undefined;

      try {
        if (res.action === 'allocate') {
          this.residentsService.allocate(res.resident.residentId, room.id, bed.id, res.joiningDate, res.notes);
          this.snackBar.open(`Bed ${bed.bedNumber} allocated to ${res.resident.name}!`, 'Close', { duration: 3500 });
        } else if (res.action === 'transfer') {
          if (residentId) {
            this.residentsService.transfer(residentId, res.targetRoomId, res.targetBedId, res.effectiveDate, res.reason);
          } else {
            this.roomsService.transferResident(room.id, bed.id, res.targetRoomId, res.targetBedId, res.effectiveDate, res.reason);
          }
          this.snackBar.open(`Resident transferred successfully!`, 'Close', { duration: 3500 });
        } else if (res.action === 'checkout') {
          if (residentId) {
            this.residentsService.checkOut(residentId, res.checkOutDate, res.remarks);
          } else {
            this.roomsService.checkOutResident(room.id, bed.id, res.checkOutDate, res.remarks);
          }
          this.snackBar.open(`Resident check-out completed. Bed is now Available.`, 'Close', { duration: 3500 });
        } else if (res.action === 'manage') {
          this.roomsService.updateBedStatus(room.id, bed.id, res.status, {
            tenantName: res.tenantName,
            tenantContact: res.tenantContact,
            rent: res.monthlyRent,
          });
          this.snackBar.open(`Bed ${bed.bedNumber} updated to ${res.status}.`, 'Close', { duration: 3000 });
        }
      } catch (err: any) {
        this.snackBar.open(err?.message || 'Operation failed.', 'Close', { duration: 4500 });
      }
    });
  }

  getOccupiedBedsCount(room: Room): number {
    return room.beds.filter((b) => b.status === 'Occupied' || b.status === 'Reserved').length;
  }

  /** Distinct floors across all rooms, used in the "Total Rooms" KPI subtitle. */
  get floorsInUse(): number {
    return new Set(this.roomsService.rooms.map((r) => `${r.building}|${r.floor}`)).size;
  }

  /** Beds in Maintenance/Inactive rooms cannot be allocated. */
  isRoomBlocked(room: Room): boolean {
    return room.status === 'Maintenance' || room.status === 'Inactive';
  }

  canAllocate(room: Room): boolean {
    return !this.isRoomBlocked(room) && room.beds.some((b) => b.status === 'Available');
  }

  // Quick Action: Allocate — opens the first available bed in allocate mode
  onAllocate(room: Room): void {
    const bed = room.beds.find((b) => b.status === 'Available');
    if (!bed || this.isRoomBlocked(room)) {
      this.snackBar.open(`Room ${room.roomNumber} has no allocatable beds.`, 'Close', { duration: 3500 });
      return;
    }
    this.openBedModal(room, bed, 'allocate');
  }

  onBedClick(room: Room, bed: Bed): void {
    // Vacant beds in blocked rooms open in manage mode only, never allocate.
    this.openBedModal(room, bed, this.isRoomBlocked(room) && !bed.tenantName ? 'manage' : undefined);
  }

  statusKey(status: RoomStatus): string {
    return status.toLowerCase();
  }

  statusLabel(status: RoomStatus): string {
    return status === 'Maintenance' ? 'Under Maintenance' : status === 'Full' ? 'Occupied' : status;
  }

  roomTypeLabel(room: Room): string {
    switch (room.roomType) {
      case 'Single':
        return 'Single Occupancy';
      case 'Double':
      case 'Triple':
        return `${room.roomType} Sharing`;
      default:
        return room.roomType;
    }
  }

  genderLabel(room: Room): string {
    return room.genderRestriction === 'Any' ? 'Co-ed' : `${room.genderRestriction} only`;
  }

  genderIcon(room: Room): string {
    return room.genderRestriction === 'Male' ? 'male' : room.genderRestriction === 'Female' ? 'female' : 'wc';
  }

  facilityIcon(facility: string): string {
    const f = facility.toLowerCase();
    if (f.includes('ac')) return 'ac_unit';
    if (f.includes('wi-fi') || f.includes('wifi')) return 'wifi';
    if (f.includes('bath') || f.includes('washroom')) return 'shower';
    if (f.includes('balcony')) return 'balcony';
    if (f.includes('study') || f.includes('desk')) return 'desk';
    if (f.includes('geyser') || f.includes('hot water')) return 'water_drop';
    return 'check_circle';
  }

  /** Short chip labels, e.g. "Air Conditioned (AC)" → "AC". */
  facilityLabel(facility: string): string {
    const map: Record<string, string> = {
      'Air Conditioned (AC)': 'AC',
      'Attached Bathroom': 'Washroom',
      'Study Desk & Chair': 'Study Desk',
      'Geyser / Hot Water': 'Geyser',
    };
    return map[facility] ?? facility;
  }

  /** Visual state of a bed tile, taking the room's status into account. */
  bedKey(room: Room, bed: Bed): string {
    if (room.status === 'Inactive' && !bed.tenantName) return 'blocked';
    if (room.status === 'Maintenance' && bed.status === 'Available') return 'maintenance';
    return bed.status.toLowerCase();
  }

  bedIcon(room: Room, bed: Bed): string {
    const key = this.bedKey(room, bed);
    if (key === 'maintenance') return 'handyman';
    if (key === 'blocked') return 'block';
    if (key === 'reserved') return 'schedule';
    return 'bed';
  }

  bedSubLabel(room: Room, bed: Bed): string {
    if (bed.tenantName) return bed.tenantName;
    const key = this.bedKey(room, bed);
    if (key === 'blocked') return 'Unavailable';
    if (key === 'maintenance') return 'Maintenance';
    return bed.status;
  }

  bedTooltip(room: Room, bed: Bed): string {
    if (bed.tenantName) return `${bed.tenantName} • Click to transfer / check-out`;
    if (this.isRoomBlocked(room)) return `Room is ${room.status.toLowerCase()} • bed cannot be allocated`;
    if (bed.status === 'Maintenance') return `Bed ${bed.bedNumber} under maintenance`;
    return `Bed ${bed.bedNumber} available • Click to allocate`;
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }
}
