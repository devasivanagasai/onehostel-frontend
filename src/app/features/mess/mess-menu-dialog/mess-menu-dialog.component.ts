import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppFormatService } from '../../../core/services/app-format.service';
import { MessService } from '../mess.service';
import { MEAL_ICONS, MEAL_TIMES, MEAL_TYPES, MENU_STATUS_TONES, MealType, MenuInput, MenuStatus, todayStr } from '../mess.models';

export interface MessMenuDialogData {
  date: string;
  mealType: MealType;
  /** Existing menu; omit to create one. */
  menuId?: string;
}

const ITEM_MAX = 40;
const ITEMS_MAX = 12;

/** Create / edit one meal's menu. Closes with a message for the snackbar. */
@Component({
  selector: 'app-mess-menu-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './mess-menu-dialog.component.html',
  styleUrl: './mess-menu-dialog.component.scss',
})
export class MessMenuDialogComponent {
  private readonly data = inject<MessMenuDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<MessMenuDialogComponent, string>);
  private readonly confirm = inject(ConfirmDialogService);
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);

  readonly meals = MEAL_TYPES;
  readonly mealIcons = MEAL_ICONS;
  readonly itemMax = ITEM_MAX;
  readonly today = todayStr();

  readonly menu = this.data.menuId ? this.service.menus.find((m) => m.id === this.data.menuId) : undefined;
  readonly status: MenuStatus | 'New' = this.menu ? this.service.menuStatus(this.menu) : 'New';
  readonly readOnly = this.status === 'Archived';
  readonly published = this.status === 'Published';

  readonly form = inject(FormBuilder).nonNullable.group({
    date: [this.menu?.date ?? this.data.date, Validators.required],
    mealType: [this.menu?.mealType ?? this.data.mealType],
    start: [this.menu?.start ?? MEAL_TIMES[this.data.mealType][0], Validators.required],
    end: [this.menu?.end ?? MEAL_TIMES[this.data.mealType][1], Validators.required],
    notes: [this.menu?.notes ?? '', Validators.maxLength(200)],
  });

  items: string[] = [...(this.menu?.items ?? [])];
  newItem = '';
  attempted = false;
  saveError = '';

  constructor() {
    if (this.readOnly) this.form.disable();
  }

  get title(): string {
    if (!this.menu) return `New ${this.form.controls.mealType.value} Menu`;
    return `${this.menu.mealType} · ${this.fmt.date(this.menu.date, 'dayDate')}`;
  }

  get statusTone(): string {
    return this.status === 'New' ? 'neutral' : MENU_STATUS_TONES[this.status];
  }

  setMeal(meal: MealType): void {
    if (this.readOnly) return;
    this.form.patchValue({ mealType: meal, ...(this.menu ? {} : { start: MEAL_TIMES[meal][0], end: MEAL_TIMES[meal][1] }) });
  }

  /** Adds the typed item(s); a comma-separated list is split. */
  addItem(event?: Event): void {
    event?.preventDefault();
    const parts = this.newItem.split(',').map((s) => s.trim().slice(0, ITEM_MAX)).filter(Boolean);
    for (const p of parts) {
      if (this.items.length >= ITEMS_MAX) break;
      if (!this.items.some((i) => i.toLowerCase() === p.toLowerCase())) this.items = [...this.items, p];
    }
    this.newItem = '';
  }

  removeItem(i: number): void {
    this.items = this.items.filter((_, idx) => idx !== i);
  }

  // ---- Errors ---------------------------------------------------------------------

  get dateError(): string {
    if (!this.attempted) return '';
    const d = this.form.controls.date.value;
    if (!d) return 'Meal date is required';
    return d < this.today && (!this.menu || this.published) ? "Can't be in the past" : '';
  }

  get itemsError(): string {
    return this.attempted && !this.items.length ? 'Add at least one item' : '';
  }

  get timeError(): string {
    const v = this.form.getRawValue();
    return this.attempted && (!v.start || !v.end || v.end <= v.start) ? 'End time must be after the start time' : '';
  }

  // ---- Actions --------------------------------------------------------------------

  save(publish: boolean): void {
    this.addItem();
    this.attempted = true;
    if (this.dateError || this.itemsError || this.timeError) return;
    if (publish && this.form.controls.date.value < this.today) {
      this.saveError = "Past menus can't be published.";
      return;
    }
    try {
      const m = this.service.saveMenu(this.input(), this.menu?.id, publish);
      const n = this.service.messResidents.length;
      const notify = this.service.settings.notifyResidents;
      let msg = `${m.mealType} menu saved as draft.`;
      if (this.published) {
        const changed = m.changes.length > (this.menu?.changes.length ?? 0);
        msg = !changed ? 'No changes to save.' : m.changes[0].notified ? `Changes saved · ${m.changes[0].notified} residents notified.` : 'Changes saved (notifications are off).';
      }
      else if (publish) msg = `${m.mealType} menu published${notify ? ` · ${n} residents notified` : ''}.`;
      this.dialogRef.close(msg);
    } catch (e: any) {
      this.saveError = e?.message ?? 'Could not save the menu.';
    }
  }

  deleteDraft(): void {
    if (!this.menu) return;
    this.confirm
      .confirm({ title: 'Delete draft?', message: `The ${this.menu.mealType} draft for ${this.fmt.date(this.menu.date)} will be removed.`, confirmLabel: 'Delete', danger: true, icon: 'delete' })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.deleteDraft(this.menu!.id);
        this.dialogRef.close('Draft deleted.');
      });
  }

  close(): void {
    this.dialogRef.close();
  }

  private input(): MenuInput {
    const v = this.form.getRawValue();
    return { date: v.date, mealType: v.mealType, items: this.items, start: v.start, end: v.end, notes: v.notes };
  }
}
