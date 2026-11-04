import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AppFormatService } from '../../core/services/app-format.service';
import { GuardiansService } from '../../core/services/guardians.service';
import { AppTableCardComponent } from '../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import {
  ACCESS_STATES,
  GUARDIAN_RELATIONSHIP_OPTIONS,
  Guardian,
  VERIFICATION_STATUSES,
  VERIFICATION_TONES,
} from '../../core/models/guardians.models';
import { GuardianFormDialogComponent, GuardianFormData } from './guardian-form-dialog/guardian-form-dialog.component';
import { GuardianViewAction, GuardianViewData, GuardianViewDialogComponent } from './guardian-view-dialog/guardian-view-dialog.component';
import { GuardianVerifyDialogComponent, GuardianVerifyData } from './guardian-verify-dialog/guardian-verify-dialog.component';
import { GuardianAccessData, GuardianAccessDialogComponent, GuardianAccessMode } from './guardian-access-dialog/guardian-access-dialog.component';

interface GuardianFilters {
  search: string;
  verification: string;
  relationship: string;
  access: string;
}

const DEFAULT_FILTERS: GuardianFilters = { search: '', verification: 'All', relationship: 'All', access: 'All' };

/** Parent / Guardian Management: who may be told what about each resident. */
@Component({
  selector: 'app-guardians',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatDialogModule, MatTooltipModule, MatSnackBarModule, MatTableModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './guardians.component.html',
  styleUrl: './guardians.component.scss',
})
export class GuardiansComponent implements OnInit, OnDestroy {
  readonly service = inject(GuardiansService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['guardian', 'resident', 'contact', 'verification', 'consent', 'access', 'actions'];
  readonly verificationStatuses = VERIFICATION_STATUSES;
  readonly relationships = GUARDIAN_RELATIONSHIP_OPTIONS;
  readonly accessStates = ACCESS_STATES;
  readonly tones = VERIFICATION_TONES;

  filters: GuardianFilters = { ...DEFAULT_FILTERS };
  pageSize = 10;
  currentPage = 0;
  /** Brief loading state while the (mock) list is read. */
  loading = true;
  private loadTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadTimer = setTimeout(() => (this.loading = false), 250);
  }

  ngOnDestroy(): void {
    clearTimeout(this.loadTimer);
  }

  get all(): Guardian[] {
    return this.service.guardians;
  }

  get stats() {
    const list = this.all;
    return {
      total: list.length,
      verified: list.filter((g) => g.verification === 'Verified').length,
      awaiting: list.filter((g) => g.verification === 'Unverified' || g.verification === 'Pending').length,
      revoked: list.filter((g) => this.service.effectiveAccess(g).state === 'Revoked').length,
    };
  }

  get filtered(): Guardian[] {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    return this.all
      .filter((g) => {
        if (q && ![g.id, g.name, g.residentId, this.service.residentName(g.residentId), g.mobile ?? '', g.email ?? ''].join(' ').toLowerCase().includes(q)) return false;
        if (f.verification !== 'All' && g.verification !== f.verification) return false;
        if (f.relationship !== 'All' && g.relationship !== f.relationship) return false;
        if (f.access !== 'All' && this.service.effectiveAccess(g).state !== f.access) return false;
        return true;
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  get hasFilters(): boolean {
    const f = this.filters;
    return !!f.search.trim() || f.verification !== 'All' || f.relationship !== 'All' || f.access !== 'All';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get safePage(): number {
    return Math.min(this.currentPage, this.totalPages - 1);
  }

  get paged(): Guardian[] {
    const start = this.safePage * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.currentPage = 0;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 0;
  }

  // ---- View helpers -----------------------------------------------------------

  access(g: Guardian) {
    return this.service.effectiveAccess(g);
  }

  tone(g: Guardian): string {
    return this.tones[g.verification];
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  // ---- Actions ----------------------------------------------------------------

  openAdd(): void {
    this.openForm({});
  }

  openEdit(g: Guardian): void {
    this.openForm({ id: g.id });
  }

  private openForm(data: GuardianFormData): void {
    this.dialog
      .open<GuardianFormDialogComponent, GuardianFormData, Guardian>(GuardianFormDialogComponent, { width: '760px', maxWidth: '94vw', autoFocus: false, disableClose: true, data })
      .afterClosed()
      .subscribe((g) => g && this.toast(data.id ? `${g.id} updated.` : `${g.id} added for ${this.service.residentName(g.residentId)}.`, g));
  }

  openView(g: Guardian): void {
    this.dialog
      .open<GuardianViewDialogComponent, GuardianViewData, GuardianViewAction>(GuardianViewDialogComponent, { width: '880px', maxWidth: '94vw', autoFocus: false, data: { id: g.id } })
      .afterClosed()
      .subscribe((action) => action && this.run(g, action));
  }

  run(g: Guardian, action: GuardianViewAction): void {
    switch (action) {
      case 'edit': return this.openEdit(g);
      case 'verify': return this.openVerify(g);
      case 'revoke': return this.openAccess(g, 'revoke');
      case 'restore': return this.openAccess(g, 'restore');
      case 'primary':
        try {
          this.service.setPrimary(g.id);
          this.snackBar.open(`${g.name} is now the primary contact.`, 'Close', { duration: 3500 });
        } catch (err: any) {
          this.snackBar.open(err?.message ?? 'Could not change the primary contact.', 'Close', { duration: 4500 });
        }
    }
  }

  openVerify(g: Guardian): void {
    this.dialog
      .open<GuardianVerifyDialogComponent, GuardianVerifyData, boolean>(GuardianVerifyDialogComponent, { width: '560px', maxWidth: '94vw', autoFocus: false, data: { id: g.id } })
      .afterClosed()
      .subscribe(() => {
        if (this.service.byId(g.id)?.verification === 'Verified') this.snackBar.open(`${g.name} verified.`, 'Close', { duration: 3500 });
      });
  }

  openAccess(g: Guardian, mode: GuardianAccessMode): void {
    this.dialog
      .open<GuardianAccessDialogComponent, GuardianAccessData, Guardian>(GuardianAccessDialogComponent, { width: '520px', maxWidth: '94vw', autoFocus: false, data: { id: g.id, mode } })
      .afterClosed()
      .subscribe((next) => next && this.snackBar.open(mode === 'revoke' ? `Access revoked for ${next.name}.` : `Access restored for ${next.name}.`, 'Close', { duration: 3500 }));
  }

  private toast(text: string, g: Guardian): void {
    this.snackBar.open(text, 'View', { duration: 4500 }).onAction().subscribe(() => this.openView(g));
  }
}
