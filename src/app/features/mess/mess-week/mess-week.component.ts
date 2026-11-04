import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { AppFormatService } from '../../../core/services/app-format.service';
import { MessService } from '../mess.service';
import { MEAL_ICONS, MEAL_TIMES, MEAL_TYPES, MENU_STATUS_TONES, MealType, MessMenu, addDays, clock, todayStr, weekDates, weekStart } from '../mess.models';
import { MessMenuDialogComponent, MessMenuDialogData } from '../mess-menu-dialog/mess-menu-dialog.component';
import { MessPreviewDialogComponent } from '../mess-preview-dialog/mess-preview-dialog.component';

/** How many menu items a cell shows before "+n more". */
const CELL_ITEMS = 4;

/** Week view: Mon–Sun columns × meal rows, with week navigation, copy, preview and publish. */
@Component({
  selector: 'app-mess-week',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, MatDialogModule, MatSnackBarModule, MatSlideToggleModule, AppButtonComponent],
  templateUrl: './mess-week.component.html',
  styleUrl: './mess-week.component.scss',
})
export class MessWeekComponent {
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);

  readonly meals = MEAL_TYPES;
  readonly mealIcons = MEAL_ICONS;
  readonly mealTimes = MEAL_TIMES;
  readonly clock = clock;
  readonly cellItems = CELL_ITEMS;
  readonly today = todayStr();

  monday = weekStart(todayStr());

  get days(): string[] {
    return weekDates(this.monday);
  }

  get weekLabel(): string {
    const end = addDays(this.monday, 6);
    return `${this.fmt.date(this.monday)} – ${this.fmt.date(end)}`;
  }

  get isThisWeek(): boolean {
    return this.monday === weekStart(this.today);
  }

  get draftsToPublish(): number {
    return this.service.weekMenus(this.monday).filter((m) => m.status === 'Draft' && m.date >= this.today).length;
  }

  get recentNotices() {
    return this.service.notices.slice(0, 4);
  }

  shiftWeek(weeks: number): void {
    this.monday = addDays(this.monday, weeks * 7);
  }

  goToThisWeek(): void {
    this.monday = weekStart(this.today);
  }

  menu(date: string, meal: MealType): MessMenu | undefined {
    return this.service.menuFor(date, meal);
  }

  status(m: MessMenu): string {
    return this.service.menuStatus(m);
  }

  tone(m: MessMenu): string {
    return MENU_STATUS_TONES[this.service.menuStatus(m)];
  }

  dayName(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
  }

  dayNum(date: string): string {
    return String(Number(date.slice(8, 10)));
  }

  setNotify(on: boolean): void {
    this.service.updateSettings({ notifyResidents: on });
  }

  open(date: string, meal: MealType): void {
    const m = this.menu(date, meal);
    // Nothing to add for a past day
    if (!m && date < this.today) return;
    this.dialog
      .open<MessMenuDialogComponent, MessMenuDialogData, string>(MessMenuDialogComponent, {
        width: '720px',
        maxWidth: '94vw',
        autoFocus: false,
        disableClose: true,
        data: { date, mealType: meal, menuId: m?.id },
      })
      .afterClosed()
      .subscribe((msg) => msg && this.snackBar.open(msg, 'Close', { duration: 4000 }));
  }

  copyPrevious(): void {
    const source = this.service.weekMenus(addDays(this.monday, -7)).length;
    if (!source) {
      this.snackBar.open('Last week has no menus to copy.', 'Close', { duration: 3500 });
      return;
    }
    this.confirm
      .confirm({
        title: 'Copy previous week?',
        message: `Last week's ${source} menu(s) will be copied into this week's empty slots as drafts. Existing menus are kept.`,
        confirmLabel: 'Copy as Drafts',
        tone: 'primary',
        icon: 'content_copy',
      })
      .subscribe((ok) => {
        if (!ok) return;
        const r = this.service.copyPreviousWeek(this.monday);
        this.snackBar.open(`${r.created} draft(s) created${r.skipped ? `, ${r.skipped} slot(s) already had a menu` : ''}.`, 'Close', { duration: 4000 });
      });
  }

  preview(): void {
    this.dialog
      .open<MessPreviewDialogComponent, { monday: string }, number>(MessPreviewDialogComponent, {
        width: '880px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { monday: this.monday },
      })
      .afterClosed()
      .subscribe((n) => {
        if (!n) return;
        const notified = this.service.settings.notifyResidents ? ` ${this.service.messResidents.length} residents notified.` : '';
        this.snackBar.open(`${n} menu(s) published.${notified}`, 'Close', { duration: 4500 });
      });
  }
}
