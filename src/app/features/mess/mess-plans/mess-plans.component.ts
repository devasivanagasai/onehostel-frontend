import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { BillingPreviewRow, MessService } from '../mess.service';
import { MEAL_PLANS, MEAL_TYPES, PLAN_HINTS, PLAN_MEALS, MealPlan, monthOffset, periodLabel } from '../mess.models';
import { MessPlanDialogComponent, MessPlanDialogData } from '../mess-plan-dialog/mess-plan-dialog.component';

/** Meal plan per resident, restricted dietary notes and the pay-per-meal billing run. */
@Component({
  selector: 'app-mess-plans',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTableModule, MatTooltipModule, MatDialogModule, MatSnackBarModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './mess-plans.component.html',
  styleUrl: './mess-plans.component.scss',
})
export class MessPlansComponent {
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly columns = ['resident', 'plan', 'meals', 'note', 'actions'];
  readonly plans = MEAL_PLANS;
  readonly mealTypes = MEAL_TYPES;
  /** Completed months that can be billed. */
  readonly periods = [-1, -2, -3].map((o) => ({ value: monthOffset(o), label: periodLabel(monthOffset(o)) }));

  search = '';
  planFilter = 'All';
  period = this.periods[0].value;
  /** Notes revealed in this session (each reveal is logged). */
  revealed = new Set<string>();

  get rows() {
    const q = this.search.trim().toLowerCase();
    return this.service.currentResidents
      .map((r) => {
        const p = this.service.profile(r.residentId);
        return { id: r.residentId, name: residentFullName(r), room: this.service.roomOf(r.residentId), plan: p.plan, note: p.dietaryNote };
      })
      .filter((r) => (!q || `${r.name} ${r.id} ${r.room}`.toLowerCase().includes(q)) && (this.planFilter === 'All' || r.plan === this.planFilter));
  }

  get hasFilters(): boolean {
    return !!this.search.trim() || this.planFilter !== 'All';
  }

  get preview(): BillingPreviewRow[] {
    return this.service.previewBilling(this.period);
  }

  get previewTotals() {
    const rows = this.preview;
    const pending = rows.filter((r) => !r.chargeId && r.amount > 0);
    return {
      pending: pending.length,
      pendingAmount: pending.reduce((s, r) => s + r.amount, 0),
      billed: rows.filter((r) => r.chargeId).length,
    };
  }

  hint(plan: MealPlan): string {
    return PLAN_HINTS[plan];
  }

  mealsFor(plan: MealPlan): string {
    const meals = PLAN_MEALS[plan];
    return meals.length === 4 ? 'All meals' : meals.length ? meals.join(', ') : '—';
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  lastAccess(id: string): string {
    const a = this.service.lastAccess(id);
    return a ? `${a.action} by ${a.by} · ${this.fmt.date(a.at, 'datetime')}` : 'Never viewed';
  }

  clearFilters(): void {
    this.search = '';
    this.planFilter = 'All';
  }

  toggleNote(id: string): void {
    if (this.revealed.has(id)) {
      this.revealed.delete(id);
      return;
    }
    this.service.revealNote(id);
    this.revealed.add(id);
  }

  edit(row: { id: string; name: string; note?: string }): void {
    // Opening the editor shows the note, so it counts as a view
    if (row.note && !this.revealed.has(row.id)) this.service.revealNote(row.id);
    this.dialog
      .open<MessPlanDialogComponent, MessPlanDialogData, boolean>(MessPlanDialogComponent, { width: '600px', maxWidth: '94vw', autoFocus: false, data: { residentId: row.id, name: row.name } })
      .afterClosed()
      .subscribe((ok) => ok && this.snackBar.open(`${row.name}'s meal plan saved.`, 'Close', { duration: 3500 }));
  }

  generate(): void {
    const t = this.previewTotals;
    const label = periodLabel(this.period);
    if (!t.pending) {
      this.snackBar.open(t.billed ? `${label} is already billed.` : `Nothing to bill for ${label}.`, 'Close', { duration: 3500 });
      return;
    }
    this.confirm
      .confirm({
        title: `Generate mess charges for ${label}?`,
        message: 'One charge per pay-per-meal resident is added to Fees & Payments. Residents already billed for this month are skipped.',
        confirmLabel: 'Generate Charges',
        tone: 'success',
        icon: 'receipt_long',
        details: [
          { icon: 'group', label: 'Residents', value: String(t.pending) },
          { icon: 'payments', label: 'Total', value: this.fmt.money(t.pendingAmount) },
        ],
      })
      .subscribe((ok) => {
        if (!ok) return;
        try {
          const r = this.service.generateBilling(this.period);
          this.snackBar.open(`${r.created.length} charge(s) created for ${label}.`, 'Close', { duration: 4000 });
        } catch (e: any) {
          this.snackBar.open(e?.message ?? 'Could not generate charges.', 'Close', { duration: 4500 });
        }
      });
  }
}
