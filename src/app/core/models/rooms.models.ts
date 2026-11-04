export type RoomType = 'Single' | 'Double' | 'Triple' | 'Four Sharing' | 'Dormitory';

export type RoomStatus = 'Available' | 'Full' | 'Maintenance' | 'Inactive';

export type BedStatus = 'Available' | 'Occupied' | 'Reserved' | 'Maintenance';

export type GenderRestriction = 'Any' | 'Male' | 'Female';

export interface BedAllocationHistory {
  id: string;
  residentId: string;
  residentName: string;
  residentContact?: string;
  gender?: 'Male' | 'Female';
  collegeOrCompany?: string;
  allocatedDate: string; // ISO date
  checkOutDate?: string; // ISO date
  notes?: string;
  allocationType: 'New' | 'Transfer' | 'Check-out';
}

export interface Bed {
  id: string;
  bedNumber: string; // Identifier unique within room, e.g. "B1", "B2"
  status: BedStatus;
  monthlyRent: number;
  tenantName?: string;
  tenantContact?: string;
  residentId?: string;
  avatarUrl?: string;
  joinedDate?: string;
  allocationHistory?: BedAllocationHistory[];
}

export interface Room {
  id: string;
  hostelId: string;
  building: string; // Building / Block name or code (e.g. "Block A", "Block B", "Main Wing")
  floor: string; // Floor name/number (e.g. "Ground Floor", "1st Floor", "2nd Floor")
  roomNumber: string; // Unique within building/floor
  roomType: RoomType;
  capacity: number; // Positive number of beds
  baseRent: number;
  status: RoomStatus;
  maintenanceNote?: string;
  genderRestriction: GenderRestriction;
  collegeRestriction?: string;
  facilities: string[]; // Facilities: Wi-Fi, Attached Bathroom, AC, Balcony, Study Table, Geyser, etc.
  hasAC: boolean;
  hasAttachedWashroom: boolean;
  hasBalcony: boolean;
  beds: Bed[];
  notes?: string;
  updatedAt: string;
}

export interface RoomFilterState {
  search: string;
  building: string;
  floor: string;
  roomType: string;
  status: string;
  gender: string;
  acOnly: boolean;
}

export interface RoomStats {
  totalRooms: number;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  maintenanceBeds: number;
  occupancyRate: number; // percentage 0-100
}
