import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { Bed, BedStatus, Room } from '../rooms.models';
import { ResidentsService } from '../../residents/residents.service';
import { ResidentGender, formatMobile, residentFullName } from '../../residents/residents.models';

export interface BedModalData {
  room: Room;
  bed: Bed;
  allRooms?: Room[];
  /** 'manage' opens Occupant Info for an occupied bed, Status & Rent otherwise. */
  mode?: 'manage' | 'allocate' | 'transfer' | 'checkout';
}

export interface ResidentOption {
  residentId: string;
  name: string;
  contact: string;
  email?: string;
  gender: ResidentGender;
  collegeOrCompany?: string;
}

type BedTab = 'allocate' | 'occupant' | 'transfer' | 'checkout' | 'status';

interface TabDef {
  id: BedTab;
  label: string;
  icon: string;
  danger?: boolean;
}

/** One selectable destination for a transfer: an available bed in another usable room. */
interface TransferTarget {
  value: string; // roomId|bedId
  label: string;
}

@Component({
  selector: 'app-bed-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatAutocompleteModule,
    MatIconModule,
    AppDialogComponent,
    AppButtonComponent,
  ],
  templateUrl: './bed-modal.component.html',
  styleUrl: './bed-modal.component.scss',
})
export class BedModalComponent {
  actionTab: BedTab = 'status';
  readonly tabs: TabDef[];

  // Forms
  manageForm: FormGroup;
  allocateForm: FormGroup;
  transferForm: FormGroup;
  checkoutForm: FormGroup;

  /** Free-text search box for the resident picker; the chosen id lives in allocateForm.residentId. */
  readonly residentSearch = new FormControl<string | ResidentOption>('', { nonNullable: true });

  /** Residents (from Residents) who are current and don't hold a bed yet. */
  private readonly residentsService = inject(ResidentsService);
  readonly residentsList: ResidentOption[] = this.residentsService.residents
    .filter((r) => this.residentsService.needsBed(r))
    .map((r) => ({
      residentId: r.residentId,
      name: residentFullName(r),
      contact: formatMobile(r.mobileCode, r.mobile),
      email: (r as { email?: string }).email,
      gender: r.gender,
      collegeOrCompany: r.collegeOrCompany,
    }));

  readonly statuses: { value: BedStatus; label: string; icon: string }[] = [
    { value: 'Available', label: 'Available (Vacant)', icon: 'check_circle' },
    { value: 'Occupied', label: 'Occupied', icon: 'person' },
    { value: 'Reserved', label: 'Reserved / Booking Pending', icon: 'hourglass_top' },
    { value: 'Maintenance', label: 'Under Maintenance', icon: 'build' },
  ];

  readonly transferTargets: TransferTarget[];

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<BedModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BedModalData,
  ) {
    const b = data.bed;
    const today = new Date().toISOString().slice(0, 10);
    const occupied = b.status === 'Occupied';
    const blocked = data.room.status === 'Maintenance' || data.room.status === 'Inactive';
    const canAllocate = !blocked && b.status === 'Available';

    // Tabs depend on the bed: vacant → Allocate; occupied → Occupant / Transfer / Check-Out; always Status & Rent
    this.tabs = [
      ...(canAllocate ? [{ id: 'allocate', label: 'Allocate Bed', icon: 'person_add' } as TabDef] : []),
      ...(occupied
        ? ([
            { id: 'occupant', label: 'Occupant Info', icon: 'badge' },
            { id: 'transfer', label: 'Transfer Resident', icon: 'swap_horiz' },
            { id: 'checkout', label: 'Check-Out', icon: 'logout', danger: true },
          ] as TabDef[])
        : []),
      { id: 'status', label: 'Status & Rent', icon: 'tune' },
    ];

    const requested: BedTab | undefined =
      data.mode === 'manage' ? (occupied ? 'occupant' : 'status') : data.mode;
    this.actionTab = this.tabs.some((t) => t.id === requested) ? requested! : this.tabs[0].id;

    this.manageForm = this.fb.group({
      status: [b.status, Validators.required],
      tenantName: [b.tenantName || ''],
      tenantContact: [b.tenantContact || ''],
      monthlyRent: [b.monthlyRent || data.room.baseRent, [Validators.required, Validators.min(500)]],
    });

    this.allocateForm = this.fb.group({
      residentId: ['', Validators.required],
      joiningDate: [today, Validators.required],
      monthlyRent: [b.monthlyRent || data.room.baseRent, [Validators.required, Validators.min(500)]],
      notes: [''],
    });

    this.transferForm = this.fb.group({
      targetRoomId: ['', Validators.required],
      targetBedId: ['', Validators.required],
      effectiveDate: [today, Validators.required],
      reason: [''],
    });

    this.checkoutForm = this.fb.group({
      checkOutDate: [today, Validators.required],
      remarks: [''],
    });

    this.transferTargets = (data.allRooms || [])
      .filter((r) => r.status !== 'Maintenance' && r.status !== 'Inactive')
      .flatMap((r) =>
        r.beds
          .filter((bed) => bed.status === 'Available' && bed.id !== b.id)
          .map((bed) => ({
            value: `${r.id}|${bed.id}`,
            label: `Room ${r.roomNumber} - Bed ${bed.bedNumber} (${r.building}, ${r.floor}) • ₹${bed.monthlyRent || r.baseRent}/mo`,
          })),
      );

    // Typing after a pick clears the selection until a resident is chosen again
    this.residentSearch.valueChanges.subscribe((v) => {
      if (typeof v === 'string') this.allocateForm.patchValue({ residentId: '' });
    });
  }

  get dialogTitle(): string {
    return `Manage Bed ${this.data.bed.bedNumber}`;
  }

  get subtitle(): string {
    const r = this.data.room;
    return `Room ${r.roomNumber} • ${r.building} (${r.floor})`;
  }

  get hasRestriction(): boolean {
    const { genderRestriction, collegeRestriction } = this.data.room;
    return (!!genderRestriction && genderRestriction !== 'Any') || (!!collegeRestriction && collegeRestriction !== 'Any');
  }

  get restrictionText(): string {
    const { genderRestriction, collegeRestriction } = this.data.room;
    const parts: string[] = [];
    if (genderRestriction && genderRestriction !== 'Any') parts.push(`${genderRestriction} residents only`);
    if (collegeRestriction && collegeRestriction !== 'Any') parts.push(`${collegeRestriction} only`);
    return parts.join(' • ');
  }

  statusLabel(value: BedStatus): string {
    return this.statuses.find((s) => s.value === value)?.label ?? value;
  }

  statusIcon(value: BedStatus): string {
    return this.statuses.find((s) => s.value === value)?.icon ?? 'circle';
  }

  initials(name?: string): string {
    return (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  /** Residents matching the room's gender and college restrictions. */
  get eligibleResidents(): ResidentOption[] {
    const { genderRestriction, collegeRestriction } = this.data.room;
    return this.residentsList.filter(
      (r) =>
        (!genderRestriction || genderRestriction === 'Any' || r.gender === genderRestriction) &&
        (!collegeRestriction || collegeRestriction === 'Any' || r.collegeOrCompany === collegeRestriction),
    );
  }

  /** Eligible residents filtered by the search text (name, phone or email). */
  get filteredResidents(): ResidentOption[] {
    const v = this.residentSearch.value;
    const q = (typeof v === 'string' ? v : v?.name || '').trim().toLowerCase();
    if (!q) return this.eligibleResidents;
    const digits = q.replace(/\D/g, '');
    return this.eligibleResidents.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (!!digits && r.contact.replace(/\D/g, '').includes(digits)),
    );
  }

  displayResident = (r: ResidentOption | string | null): string => (typeof r === 'string' ? r : r?.name ?? '');

  onResidentSelected(e: MatAutocompleteSelectedEvent): void {
    this.allocateForm.patchValue({ residentId: (e.option.value as ResidentOption).residentId });
  }

  get selectedTransferTarget(): string {
    const { targetRoomId, targetBedId } = this.transferForm.value;
    return targetRoomId && targetBedId ? `${targetRoomId}|${targetBedId}` : '';
  }

  onTransferTargetChange(value: string): void {
    const [targetRoomId = '', targetBedId = ''] = value.split('|');
    this.transferForm.patchValue({ targetRoomId, targetBedId });
    this.transferForm.get('targetBedId')?.markAsTouched();
  }

  invalid(form: FormGroup, name: string): boolean {
    const c = form.get(name);
    return !!c && c.invalid && c.touched;
  }

  // Submit handlers
  onSaveManage(): void {
    if (this.manageForm.invalid) return this.manageForm.markAllAsTouched();
    this.dialogRef.close({ action: 'manage', ...this.manageForm.value });
  }

  onSaveAllocate(): void {
    if (this.allocateForm.invalid) {
      this.residentSearch.markAsTouched();
      return this.allocateForm.markAllAsTouched();
    }
    const val = this.allocateForm.value;
    const resident = this.residentsList.find((r) => r.residentId === val.residentId);
    if (!resident) return;

    this.dialogRef.close({
      action: 'allocate',
      resident: {
        residentId: resident.residentId,
        name: resident.name,
        contact: resident.contact,
        gender: resident.gender,
        collegeOrCompany: resident.collegeOrCompany,
      },
      joiningDate: val.joiningDate,
      monthlyRent: val.monthlyRent,
      notes: val.notes,
    });
  }

  onSaveTransfer(): void {
    if (this.transferForm.invalid) return this.transferForm.markAllAsTouched();
    this.dialogRef.close({ action: 'transfer', ...this.transferForm.value });
  }

  onSaveCheckout(): void {
    if (this.checkoutForm.invalid) return this.checkoutForm.markAllAsTouched();
    this.dialogRef.close({ action: 'checkout', ...this.checkoutForm.value });
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
