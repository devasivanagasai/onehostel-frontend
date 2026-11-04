import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { Bed, Room, RoomStats, RoomType } from '../models/rooms.models';
import { AuditLogService } from './audit-log.service';
import { localDateIso } from '../../shared/utils/local-date';

const STORAGE_KEY = 'onehostel_rooms_beds_v4';

export const ALL_FACILITIES = [
  'Wi-Fi',
  'Air Conditioned (AC)',
  'Attached Bathroom',
  'Balcony',
  'Study Desk & Chair',
  'Geyser / Hot Water',
  'Cupboard / Wardrobe',
  'Power Backup',
  'Daily Housekeeping',
];

const SEED_ROOMS: Room[] = [
  {
    id: 'RM-101',
    hostelId: 'HST-OWNER-01',
    building: 'Block A',
    floor: '1st Floor',
    roomNumber: '101',
    roomType: 'Double',
    capacity: 2,
    baseRent: 7000,
    status: 'Full',
    genderRestriction: 'Male',
    collegeRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony', 'Study Desk & Chair', 'Geyser / Hot Water'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    beds: [
      {
        id: 'BED-101-B1',
        bedNumber: 'B1',
        status: 'Occupied',
        monthlyRent: 7000,
        residentId: 'RES000001',
        tenantName: 'Rahul Sharma',
        tenantContact: '+91 98877 66554',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-08-01',
        allocationHistory: [
          {
            id: 'ALLOC-01',
            residentId: 'RES000001',
            residentName: 'Rahul Sharma',
            residentContact: '+91 98877 66554',
            gender: 'Male',
            collegeOrCompany: 'Engineering College',
            allocatedDate: '2026-08-01',
            allocationType: 'New',
          },
        ],
      },
      {
        id: 'BED-101-B2',
        bedNumber: 'B2',
        status: 'Occupied',
        monthlyRent: 7000,
        residentId: 'RES000002',
        tenantName: 'Aman Verma',
        tenantContact: '+91 91234 56780',
        avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-08-15',
        allocationHistory: [
          {
            id: 'ALLOC-02',
            residentId: 'RES000002',
            residentName: 'Aman Verma',
            residentContact: '+91 91234 56780',
            gender: 'Male',
            allocatedDate: '2026-08-15',
            allocationType: 'New',
          },
        ],
      },
    ],
  },
  {
    id: 'RM-102',
    hostelId: 'HST-OWNER-01',
    building: 'Block A',
    floor: '1st Floor',
    roomNumber: '102',
    roomType: 'Double',
    capacity: 2,
    baseRent: 7000,
    status: 'Available',
    genderRestriction: 'Male',
    collegeRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    beds: [
      {
        id: 'BED-102-B1',
        bedNumber: 'B1',
        status: 'Available',
        monthlyRent: 7000,
      },
      {
        id: 'BED-102-B2',
        bedNumber: 'B2',
        status: 'Available',
        monthlyRent: 7000,
      },
    ],
  },
  {
    id: 'RM-103',
    hostelId: 'HST-OWNER-01',
    building: 'Block A',
    floor: '1st Floor',
    roomNumber: '103',
    roomType: 'Triple',
    capacity: 3,
    baseRent: 6000,
    status: 'Maintenance',
    maintenanceNote: 'Plumbing inspection and fresh repaint scheduled. Ready by next Monday.',
    genderRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    beds: [
      { id: 'BED-103-B1', bedNumber: 'B1', status: 'Maintenance', monthlyRent: 6000 },
      { id: 'BED-103-B2', bedNumber: 'B2', status: 'Maintenance', monthlyRent: 6000 },
      { id: 'BED-103-B3', bedNumber: 'B3', status: 'Maintenance', monthlyRent: 6000 },
    ],
  },
  {
    id: 'RM-201',
    hostelId: 'HST-OWNER-01',
    building: 'Block B',
    floor: '2nd Floor',
    roomNumber: '201',
    roomType: 'Triple',
    capacity: 3,
    baseRent: 6500,
    status: 'Full',
    genderRestriction: 'Male',
    collegeRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony', 'Study Desk & Chair'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    beds: [
      {
        id: 'BED-201-B1',
        bedNumber: 'B1',
        status: 'Occupied',
        monthlyRent: 6500,
        residentId: 'RES000003',
        tenantName: 'Vivek Singh',
        tenantContact: '+91 97766 55443',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-07-10',
      },
      {
        id: 'BED-201-B2',
        bedNumber: 'B2',
        status: 'Occupied',
        monthlyRent: 6500,
        residentId: 'RES000004',
        tenantName: 'Rohit Patel',
        tenantContact: '+91 98822 33445',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-07-12',
      },
      {
        id: 'BED-201-B3',
        bedNumber: 'B3',
        status: 'Occupied',
        monthlyRent: 6500,
        residentId: 'RES000005',
        tenantName: 'Sahil Khan',
        tenantContact: '+91 97711 22334',
        avatarUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-07-15',
      },
    ],
  },
  {
    id: 'RM-202',
    hostelId: 'HST-OWNER-01',
    building: 'Block B',
    floor: '2nd Floor',
    roomNumber: '202',
    roomType: 'Double',
    capacity: 2,
    baseRent: 7000,
    status: 'Available',
    genderRestriction: 'Any',
    collegeRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    beds: [
      { id: 'BED-202-B1', bedNumber: 'B1', status: 'Available', monthlyRent: 7000 },
      { id: 'BED-202-B2', bedNumber: 'B2', status: 'Available', monthlyRent: 7000 },
    ],
  },
  {
    id: 'RM-203',
    hostelId: 'HST-OWNER-01',
    building: 'Block B',
    floor: '2nd Floor',
    roomNumber: '203',
    roomType: 'Double',
    capacity: 2,
    baseRent: 7000,
    status: 'Full',
    genderRestriction: 'Male',
    collegeRestriction: 'Any',
    facilities: ['Wi-Fi', 'Air Conditioned (AC)', 'Attached Bathroom', 'Balcony'],
    hasAC: true,
    hasAttachedWashroom: true,
    hasBalcony: true,
    updatedAt: new Date().toISOString(),
    beds: [
      {
        id: 'BED-203-B1',
        bedNumber: 'B1',
        status: 'Occupied',
        monthlyRent: 7000,
        residentId: 'RES000006',
        tenantName: 'Sagar Gupta',
        tenantContact: '+91 98112 23344',
        avatarUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-09-20',
      },
      {
        id: 'BED-203-B2',
        bedNumber: 'B2',
        status: 'Occupied',
        monthlyRent: 7000,
        residentId: 'RES000007',
        tenantName: 'Mohit Yadav',
        tenantContact: '+91 98991 22334',
        avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=120&q=80',
        joinedDate: '2026-09-22',
      },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class RoomsService {
  private readonly auditLog = inject(AuditLogService);
  private readonly roomsSubject = new BehaviorSubject<Room[]>(this.loadRooms());
  readonly rooms$: Observable<Room[]> = this.roomsSubject.asObservable();

  readonly stats$: Observable<RoomStats> = this.rooms$.pipe(
    map((rooms) => {
      let totalBeds = 0;
      let occupiedBeds = 0;
      let availableBeds = 0;
      let maintenanceBeds = 0;

      for (const room of rooms) {
        for (const bed of room.beds) {
          totalBeds++;
          if (bed.status === 'Occupied' || bed.status === 'Reserved') {
            occupiedBeds++;
          } else if (bed.status === 'Available') {
            availableBeds++;
          } else if (bed.status === 'Maintenance') {
            maintenanceBeds++;
          }
        }
      }

      const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      return {
        totalRooms: rooms.length,
        totalBeds,
        occupiedBeds,
        availableBeds,
        maintenanceBeds,
        occupancyRate,
      };
    }),
  );

  get rooms(): Room[] {
    return this.roomsSubject.value;
  }

  getRoomById(id: string): Room | undefined {
    return this.rooms.find((r) => r.id === id);
  }

  /**
   * Save (Create or Edit) Room. Validates scope uniqueness (Building + Floor + RoomNumber)
   */
  saveRoom(roomData: Partial<Room>): Room {
    const rooms = [...this.rooms];
    let savedRoom: Room;

    const bld = (roomData.building || 'Block A').trim();
    const flr = (roomData.floor || '1st Floor').trim();
    const num = (roomData.roomNumber || '').trim();

    // Validate uniqueness within building + floor scope
    const duplicate = rooms.find(
      (r) =>
        r.id !== roomData.id &&
        r.building.toLowerCase() === bld.toLowerCase() &&
        r.floor.toLowerCase() === flr.toLowerCase() &&
        r.roomNumber.toLowerCase() === num.toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`Room ${num} already exists on ${flr} in ${bld}. Room number must be unique in this scope.`);
    }

    if (roomData.id) {
      const index = rooms.findIndex((r) => r.id === roomData.id);
      if (index === -1) throw new Error('Room not found');

      const existing = rooms[index];
      const targetCapacity = Number(roomData.capacity) || existing.beds.length;
      const activeAllocations = existing.beds.filter((b) => b.status === 'Occupied' || b.status === 'Reserved').length;

      if (targetCapacity < activeAllocations) {
        throw new Error(`Capacity (${targetCapacity}) cannot be lower than active allocated beds (${activeAllocations}).`);
      }

      let updatedBeds = [...existing.beds];
      if (targetCapacity > existing.beds.length) {
        // Add additional beds B3, B4...
        for (let i = existing.beds.length + 1; i <= targetCapacity; i++) {
          updatedBeds.push({
            id: `BED-${existing.roomNumber}-B${i}-${Date.now().toString().slice(-3)}`,
            bedNumber: `B${i}`,
            status: 'Available',
            monthlyRent: roomData.baseRent || existing.baseRent,
          });
        }
      } else if (targetCapacity < existing.beds.length) {
        // Shrink from the end, but only vacant beds may go
        const removed = updatedBeds.slice(targetCapacity);
        if (removed.some((b) => b.status === 'Occupied' || b.status === 'Reserved')) {
          throw new Error(
            `Cannot reduce capacity to ${targetCapacity}: beds ${removed.map((b) => b.bedNumber).join(', ')} would be removed and some are occupied or reserved. Only trailing vacant beds can be removed.`,
          );
        }
        updatedBeds = updatedBeds.slice(0, targetCapacity);
      }

      const hasAC = roomData.facilities ? roomData.facilities.includes('Air Conditioned (AC)') : existing.hasAC;
      const hasAttachedWashroom = roomData.facilities ? roomData.facilities.includes('Attached Bathroom') : existing.hasAttachedWashroom;
      const hasBalcony = roomData.facilities ? roomData.facilities.includes('Balcony') : existing.hasBalcony;

      savedRoom = {
        ...existing,
        ...roomData,
        status: existing.status,
        capacity: targetCapacity,
        hasAC,
        hasAttachedWashroom,
        hasBalcony,
        beds: updatedBeds,
        updatedAt: new Date().toISOString(),
      } as Room;

      // A status change goes through the same bed cascade as setRoomStatus; Available/Full are derived from the beds
      const requested = roomData.status;
      const blocking = (s?: Room['status']) => s === 'Maintenance' || s === 'Inactive';
      if (requested && blocking(requested) && requested !== existing.status) {
        this.applyRoomStatus(savedRoom, requested);
      } else if (requested && !blocking(requested) && blocking(existing.status)) {
        this.applyRoomStatus(savedRoom, 'Available');
      }

      this.updateRoomStatus(savedRoom);
      rooms[index] = savedRoom;
      this.auditLog.record('Update Room', `Room ${savedRoom.roomNumber}`, {
        details: `Room ${savedRoom.roomNumber} (${savedRoom.building}, ${savedRoom.floor}) updated.`,
      });
    } else {
      const newId = `RM-${Date.now().toString().slice(-4)}`;
      const cap = Number(roomData.capacity) || 2;
      const beds = this.generateBeds(cap, roomData.roomNumber || '101', roomData.baseRent || 6500);
      const fac = roomData.facilities || ['Wi-Fi', 'Attached Bathroom'];

      savedRoom = {
        id: newId,
        hostelId: 'HST-OWNER-01',
        building: bld,
        floor: flr,
        roomNumber: num || '101',
        roomType: roomData.roomType || 'Double',
        capacity: cap,
        baseRent: roomData.baseRent || 6500,
        status: (roomData.status as any) || 'Available',
        maintenanceNote: roomData.maintenanceNote || '',
        genderRestriction: roomData.genderRestriction || 'Any',
        collegeRestriction: roomData.collegeRestriction || 'Any',
        facilities: fac,
        hasAC: fac.includes('Air Conditioned (AC)'),
        hasAttachedWashroom: fac.includes('Attached Bathroom'),
        hasBalcony: fac.includes('Balcony'),
        beds,
        notes: roomData.notes || '',
        updatedAt: new Date().toISOString(),
      };

      this.updateRoomStatus(savedRoom);
      rooms.unshift(savedRoom);
      this.auditLog.record('Create Room', `Room ${savedRoom.roomNumber}`, {
        details: `Room ${savedRoom.roomNumber} created in ${savedRoom.building}, ${savedRoom.floor} with ${cap} beds.`,
      });
    }

    this.roomsSubject.next(rooms);
    this.persist(rooms);
    return savedRoom;
  }

  deleteRoom(id: string): boolean {
    const room = this.rooms.find((r) => r.id === id);
    if (!room) return false;

    const hasOccupants = room.beds.some((b) => b.status === 'Occupied' || b.status === 'Reserved');
    if (hasOccupants) {
      throw new Error(`Cannot delete Room ${room.roomNumber} while it has occupied or reserved beds.`);
    }

    const updated = this.rooms.filter((r) => r.id !== id);
    this.roomsSubject.next(updated);
    this.persist(updated);
    this.auditLog.record('Delete Room', `Room ${room.roomNumber}`, {
      details: `Room ${room.roomNumber} deleted from inventory.`,
    });
    return true;
  }

  /**
   * Room level quick status toggle: Mark Maintenance / Mark Inactive / Re-activate
   */
  setRoomStatus(roomId: string, status: Room['status'], note?: string): void {
    const rooms = [...this.rooms];
    const index = rooms.findIndex((r) => r.id === roomId);
    if (index === -1) return;

    const room = { ...rooms[index] };
    if (note) room.maintenanceNote = note;
    this.applyRoomStatus(room, status);

    room.updatedAt = new Date().toISOString();
    rooms[index] = room;
    this.roomsSubject.next(rooms);
    this.persist(rooms);

    this.auditLog.record('Update Room', `Room ${room.roomNumber}`, {
      details: `Room ${room.roomNumber} status changed to ${status}. ${note || ''}`,
    });
  }

  /** Sets the room status and cascades it to the beds: vacant beds go to Maintenance, or come back when re-activating. */
  private applyRoomStatus(room: Room, status: Room['status']): void {
    room.status = status;
    if (status === 'Maintenance' || status === 'Inactive') {
      room.beds = room.beds.map((b) => (b.status === 'Available' ? { ...b, status: 'Maintenance' } : b));
    } else {
      // Re-activating: restore vacant beds
      room.beds = room.beds.map((b) => (b.status === 'Maintenance' ? { ...b, status: 'Available' } : b));
      this.updateRoomStatus(room);
    }
  }

  /** Why this room cannot take the resident (room status, gender or college restriction), or null when it can. */
  restrictionError(room: Room, who: { gender?: 'Male' | 'Female'; collegeOrCompany?: string }): string | null {
    if (room.status === 'Inactive' || room.status === 'Maintenance') {
      return `Cannot allocate: Room ${room.roomNumber} is currently under ${room.status}.`;
    }
    if (room.genderRestriction !== 'Any' && who.gender && room.genderRestriction !== who.gender) {
      return `Allocation restricted: Room ${room.roomNumber} is reserved for ${room.genderRestriction} residents.`;
    }
    if (room.collegeRestriction && room.collegeRestriction !== 'Any' && room.collegeRestriction !== who.collegeOrCompany) {
      return `Allocation restricted: Room ${room.roomNumber} is reserved for ${room.collegeRestriction}.`;
    }
    return null;
  }

  /**
   * Allocate Bed Workflow (Section 4.3.2):
   * Allocates a resident to an available bed, logs history, updates occupancy.
   */
  allocateBed(
    roomId: string,
    bedId: string,
    resident: {
      residentId: string;
      name: string;
      contact?: string;
      gender?: 'Male' | 'Female';
      collegeOrCompany?: string;
    },
    joiningDate: string,
    notes?: string,
    monthlyRent?: number,
  ): void {
    const rooms = [...this.rooms];
    const roomIndex = rooms.findIndex((r) => r.id === roomId);
    if (roomIndex === -1) throw new Error('Room not found');

    const room = { ...rooms[roomIndex] };

    // Room must be usable and its gender / college restrictions must allow the resident
    const restriction = this.restrictionError(room, resident);
    if (restriction) throw new Error(restriction);

    const bedIndex = room.beds.findIndex((b) => b.id === bedId);
    if (bedIndex === -1) throw new Error('Bed not found');

    const bed = { ...room.beds[bedIndex] };

    // Prevent overlapping active allocation
    if (bed.status === 'Occupied') {
      throw new Error(`Bed ${bed.bedNumber} is already occupied by ${bed.tenantName}. Cannot have overlapping allocations.`);
    }
    if (bed.status === 'Maintenance') {
      throw new Error(`Bed ${bed.bedNumber} is currently under maintenance.`);
    }
    if (bed.status !== 'Available') {
      throw new Error(`Bed ${bed.bedNumber} is ${bed.status.toLowerCase()} and cannot be allocated.`);
    }

    const historyEntry = {
      id: `ALLOC-${Date.now()}`,
      residentId: resident.residentId,
      residentName: resident.name,
      residentContact: resident.contact,
      gender: resident.gender,
      collegeOrCompany: resident.collegeOrCompany,
      allocatedDate: joiningDate || localDateIso(),
      notes: notes || 'New allocation',
      allocationType: 'New' as const,
    };

    bed.status = 'Occupied';
    bed.residentId = resident.residentId;
    bed.tenantName = resident.name;
    bed.tenantContact = resident.contact;
    bed.joinedDate = joiningDate || localDateIso();
    if (monthlyRent && monthlyRent > 0) bed.monthlyRent = monthlyRent;
    bed.allocationHistory = [historyEntry, ...(bed.allocationHistory || [])];

    room.beds = [...room.beds];
    room.beds[bedIndex] = bed;
    this.updateRoomStatus(room);
    room.updatedAt = new Date().toISOString();
    rooms[roomIndex] = room;

    this.roomsSubject.next(rooms);
    this.persist(rooms);

    this.auditLog.record('Update Bed', `Bed ${bed.bedNumber} in Room ${room.roomNumber}`, {
      details: `Allocated to ${resident.name} starting ${bed.joinedDate}.`,
    });
  }

  /**
   * Transfer Resident Workflow (Section 4.3.2):
   * Closes old bed allocation and opens new allocation on destination bed.
   */
  transferResident(
    sourceRoomId: string,
    sourceBedId: string,
    targetRoomId: string,
    targetBedId: string,
    effectiveDate: string,
    reason?: string,
    profile?: { gender?: 'Male' | 'Female'; collegeOrCompany?: string },
  ): void {
    const rooms = [...this.rooms];
    const srcRoom = rooms.find((r) => r.id === sourceRoomId);
    const dstRoom = rooms.find((r) => r.id === targetRoomId);
    if (!srcRoom || !dstRoom) throw new Error('Source or Destination room not found');

    const srcBed = srcRoom.beds.find((b) => b.id === sourceBedId);
    const dstBed = dstRoom.beds.find((b) => b.id === targetBedId);
    if (!srcBed || !dstBed) throw new Error('Source or Destination bed not found');

    if (srcBed.status !== 'Occupied' || !srcBed.tenantName) {
      throw new Error(`Source bed ${srcBed.bedNumber} has no active resident to transfer.`);
    }
    if (dstBed.status !== 'Available') {
      throw new Error(`Destination bed ${dstBed.bedNumber} is not available (Status: ${dstBed.status}).`);
    }

    if (srcBed.joinedDate && effectiveDate < srcBed.joinedDate) {
      throw new Error(`Transfer date cannot be before the current allocation start (${srcBed.joinedDate}).`);
    }

    // Same eligibility rules as a fresh allocation; fall back to what the allocation history recorded
    const last = srcBed.allocationHistory?.[0];
    const who = {
      gender: profile?.gender ?? last?.gender,
      collegeOrCompany: profile?.collegeOrCompany ?? last?.collegeOrCompany,
    };
    const restriction = this.restrictionError(dstRoom, who);
    if (restriction) throw new Error(restriction);

    const residentData = {
      residentId: srcBed.residentId || `RES-${Date.now().toString().slice(-4)}`,
      name: srcBed.tenantName,
      contact: srcBed.tenantContact,
      avatarUrl: srcBed.avatarUrl,
    };

    // Close source bed allocation
    srcBed.status = 'Available';
    delete srcBed.tenantName;
    delete srcBed.tenantContact;
    delete srcBed.residentId;
    delete srcBed.avatarUrl;
    delete srcBed.joinedDate;
    if (srcBed.allocationHistory?.length) {
      srcBed.allocationHistory[0].checkOutDate = effectiveDate;
      srcBed.allocationHistory[0].notes = `Transferred to Room ${dstRoom.roomNumber} - Bed ${dstBed.bedNumber}. Reason: ${reason || 'Requested'}`;
    }

    // Allocate to destination bed
    dstBed.status = 'Occupied';
    dstBed.residentId = residentData.residentId;
    dstBed.tenantName = residentData.name;
    dstBed.tenantContact = residentData.contact;
    dstBed.avatarUrl = residentData.avatarUrl;
    dstBed.joinedDate = effectiveDate;
    dstBed.allocationHistory = [
      {
        id: `ALLOC-${Date.now()}`,
        residentId: residentData.residentId,
        residentName: residentData.name,
        residentContact: residentData.contact,
        gender: who.gender,
        collegeOrCompany: who.collegeOrCompany,
        allocatedDate: effectiveDate,
        notes: `Transferred from Room ${srcRoom.roomNumber} - Bed ${srcBed.bedNumber}. ${reason || ''}`,
        allocationType: 'Transfer',
      },
      ...(dstBed.allocationHistory || []),
    ];

    this.updateRoomStatus(srcRoom);
    this.updateRoomStatus(dstRoom);
    srcRoom.updatedAt = new Date().toISOString();
    dstRoom.updatedAt = new Date().toISOString();

    this.roomsSubject.next([...rooms]);
    this.persist(rooms);

    this.auditLog.record('Update Bed', `Transfer ${residentData.name}`, {
      details: `Transferred from Room ${srcRoom.roomNumber} (Bed ${srcBed.bedNumber}) to Room ${dstRoom.roomNumber} (Bed ${dstBed.bedNumber}) effective ${effectiveDate}.`,
    });
  }

  /**
   * Check-out Resident Workflow (Section 4.3.2):
   * Closes active allocation, releases bed to Available status on effective date.
   */
  checkOutResident(
    roomId: string,
    bedId: string,
    checkOutDate: string,
    remarks?: string,
  ): void {
    const rooms = [...this.rooms];
    const room = rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('Room not found');

    const bed = room.beds.find((b) => b.id === bedId);
    if (!bed || bed.status !== 'Occupied') {
      throw new Error('Bed does not have an active allocation to check out.');
    }

    const date = checkOutDate || localDateIso();
    if (date > localDateIso()) throw new Error('Check-out date cannot be in the future.');

    const previousTenant = bed.tenantName;

    // Record check-out date in allocation history
    if (bed.allocationHistory?.length) {
      bed.allocationHistory[0].checkOutDate = date;
      bed.allocationHistory[0].notes = remarks || 'Resident checked out normally.';
    }

    // Reset bed state to Available
    bed.status = 'Available';
    delete bed.tenantName;
    delete bed.tenantContact;
    delete bed.residentId;
    delete bed.avatarUrl;
    delete bed.joinedDate;

    this.updateRoomStatus(room);
    room.updatedAt = new Date().toISOString();

    this.roomsSubject.next([...rooms]);
    this.persist(rooms);

    this.auditLog.record('Update Bed', `Check-out Bed ${bed.bedNumber}`, {
      details: `${previousTenant} checked out from Room ${room.roomNumber} Bed ${bed.bedNumber} on ${date}. Remarks: ${remarks || 'None'}`,
    });
  }

  /**
   * Add beds to an existing room (Section 4.3 Actions)
   */
  addBeds(roomId: string, countToAdd: number): void {
    const rooms = [...this.rooms];
    const room = rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('Room not found');

    const currentCount = room.beds.length;
    for (let i = 1; i <= countToAdd; i++) {
      const idx = currentCount + i;
      room.beds.push({
        id: `BED-${room.roomNumber}-B${idx}-${Date.now().toString().slice(-3)}`,
        bedNumber: `B${idx}`,
        status: 'Available',
        monthlyRent: room.baseRent,
      });
    }

    room.capacity = room.beds.length;
    this.updateRoomStatus(room);
    room.updatedAt = new Date().toISOString();

    this.roomsSubject.next([...rooms]);
    this.persist(rooms);

    this.auditLog.record('Update Room', `Room ${room.roomNumber}`, {
      details: `Added ${countToAdd} new bed(s) to Room ${room.roomNumber}. New capacity: ${room.capacity}.`,
    });
  }

  updateBedStatus(roomId: string, bedId: string, status: Bed['status'], details?: { rent?: number }): void {
    const rooms = [...this.rooms];
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    const bed = room.beds.find((b) => b.id === bedId);
    if (!bed) return;

    if (bed.status === 'Occupied' && status !== 'Occupied') {
      throw new Error(`Bed ${bed.bedNumber} is occupied. Use Check-Out or Transfer to change its status.`);
    }
    if (status === 'Occupied' && bed.status !== 'Occupied') {
      throw new Error('A bed becomes Occupied only by allocating a resident. Use Allocate Bed.');
    }
    if ((status === 'Reserved' || status === 'Maintenance') && bed.residentId) {
      throw new Error(`Bed ${bed.bedNumber} is linked to a resident and cannot be marked ${status}.`);
    }

    bed.status = status;
    if (details?.rent) bed.monthlyRent = details.rent;

    if (status === 'Available') {
      delete bed.tenantName;
      delete bed.tenantContact;
      delete bed.residentId;
      delete bed.joinedDate;
    }

    this.updateRoomStatus(room);
    room.updatedAt = new Date().toISOString();

    this.roomsSubject.next([...rooms]);
    this.persist(rooms);

    this.auditLog.record('Update Bed', `Bed ${bed.bedNumber} in Room ${room.roomNumber}`, {
      details: `Bed status changed to ${status}.`,
    });
  }

  private updateRoomStatus(room: Room): void {
    if (room.status === 'Maintenance' || room.status === 'Inactive') return;

    const allOccupied = room.beds.every((b) => b.status === 'Occupied' || b.status === 'Reserved');
    const allMaintenance = room.beds.every((b) => b.status === 'Maintenance');

    if (allMaintenance) {
      room.status = 'Maintenance';
    } else if (allOccupied) {
      room.status = 'Full';
    } else {
      room.status = 'Available';
    }
  }

  private generateBeds(capacity: number, roomNumber: string, rent: number): Bed[] {
    return Array.from({ length: capacity }, (_, i) => ({
      id: `BED-${roomNumber}-B${i + 1}-${Date.now().toString().slice(-3)}`,
      bedNumber: `B${i + 1}`,
      status: 'Available',
      monthlyRent: rent,
    }));
  }

  private loadRooms(): Room[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as Room[];
      }
    } catch {
      // fallback
    }
    return SEED_ROOMS;
  }

  private persist(rooms: Room[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
    } catch {
      // storage quota
    }
  }
}
