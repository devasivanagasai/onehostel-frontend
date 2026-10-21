import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ALL_FACILITIES } from '../rooms.service';
import { GenderRestriction, Room, RoomStatus, RoomType } from '../rooms.models';
import { ResidentsService } from '../../residents/residents.service';

/** Icon per facility for the amenities checklist. */
const FACILITY_ICONS: Record<string, string> = {
  'Wi-Fi': 'wifi',
  'Air Conditioned (AC)': 'ac_unit',
  'Attached Bathroom': 'shower',
  Balcony: 'balcony',
  'Study Desk & Chair': 'desk',
  'Geyser / Hot Water': 'water_drop',
  'Cupboard / Wardrobe': 'door_sliding',
  'Power Backup': 'power',
  'Daily Housekeeping': 'cleaning_services',
};

export interface RoomModalData {
  room?: Room;
}

@Component({
  selector: 'app-room-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './room-modal.component.html',
  styleUrl: './room-modal.component.scss',
})
export class RoomModalComponent {
  form: FormGroup;
  isEdit = false;

  readonly buildings = ['Block A', 'Block B', 'Block C', 'Main Wing', 'North Annex'];
  readonly floors = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor', '4th Floor'];
  readonly roomTypes: RoomType[] = ['Single', 'Double', 'Triple', 'Four Sharing', 'Dormitory'];
  readonly roomStatuses: RoomStatus[] = ['Available', 'Full', 'Maintenance', 'Inactive'];
  readonly genderOptions: GenderRestriction[] = ['Any', 'Male', 'Female'];
  readonly availableFacilities = ALL_FACILITIES;
  /** 1–12 beds, plus the room's current capacity if it is larger. */
  readonly capacityOptions: number[];
  /** "Any" plus the colleges / companies residents belong to (and the room's current value). */
  readonly collegeOptions: string[];

  selectedFacilities: string[] = [];

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<RoomModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: RoomModalData,
  ) {
    this.isEdit = !!data?.room;
    const r = data?.room;
    this.selectedFacilities = r?.facilities ? [...r.facilities] : ['Wi-Fi', 'Attached Bathroom', 'Air Conditioned (AC)'];

    const maxCap = Math.max(12, r?.capacity ?? 0);
    this.capacityOptions = Array.from({ length: maxCap }, (_, i) => i + 1);
    const colleges = new Set(
      inject(ResidentsService)
        .residents.map((x) => x.collegeOrCompany?.trim())
        .filter((x): x is string => !!x),
    );
    if (r?.collegeRestriction && r.collegeRestriction !== 'Any') colleges.add(r.collegeRestriction);
    this.collegeOptions = ['Any', ...[...colleges].sort()];

    this.form = this.fb.group({
      building: [r?.building || 'Block A', Validators.required],
      floor: [r?.floor || '1st Floor', Validators.required],
      roomNumber: [r?.roomNumber || '', [Validators.required, Validators.pattern(/^[0-9A-Za-z-]+$/)]],
      roomType: [r?.roomType || 'Double', Validators.required],
      capacity: [r?.capacity || 2, [Validators.required, Validators.min(1), Validators.max(20)]],
      baseRent: [r?.baseRent || 6500, [Validators.required, Validators.min(500)]],
      status: [r?.status || 'Available', Validators.required],
      maintenanceNote: [r?.maintenanceNote || ''],
      genderRestriction: [r?.genderRestriction || 'Any', Validators.required],
      collegeRestriction: [r?.collegeRestriction || 'Any'],
      notes: [r?.notes || ''],
    });

    // Automatically update capacity when roomType changes if not edit
    if (!this.isEdit) {
      this.form.get('roomType')?.valueChanges.subscribe((type: RoomType) => {
        const defaultCap = type === 'Single' ? 1 : type === 'Double' ? 2 : type === 'Triple' ? 3 : type === 'Four Sharing' ? 4 : 6;
        this.form.get('capacity')?.setValue(defaultCap);
      });
    }

    // Require maintenance note if Maintenance status selected
    this.form.get('status')?.valueChanges.subscribe((status) => {
      const noteCtrl = this.form.get('maintenanceNote');
      if (status === 'Maintenance') {
        noteCtrl?.setValidators([Validators.required]);
      } else {
        noteCtrl?.clearValidators();
      }
      noteCtrl?.updateValueAndValidity();
    });
  }

  facilityIcon(f: string): string {
    return FACILITY_ICONS[f] ?? 'check_circle';
  }

  /** Field shows its error once touched (or after a submit attempt). */
  invalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  isFacilitySelected(f: string): boolean {
    return this.selectedFacilities.includes(f);
  }

  toggleFacility(f: string): void {
    if (this.isFacilitySelected(f)) {
      this.selectedFacilities = this.selectedFacilities.filter((item) => item !== f);
    } else {
      this.selectedFacilities.push(f);
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const val = this.form.getRawValue();
    this.dialogRef.close({
      ...this.data?.room,
      ...val,
      facilities: this.selectedFacilities,
    });
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
