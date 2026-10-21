import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { MessService } from '../mess.service';
import { MEAL_ICONS, MEAL_TYPES, MessMenu, clock, todayStr, weekDates } from '../mess.models';

/** Resident-eye view of a week, then publish its drafts. Closes with the number published. */
@Component({
  selector: 'app-mess-preview-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  templateUrl: './mess-preview-dialog.component.html',
  styleUrl: './mess-preview-dialog.component.scss',
})
export class MessPreviewDialogComponent {
  private readonly data = inject<{ monday: string }>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<MessPreviewDialogComponent, number>);
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);

  readonly mealIcons = MEAL_ICONS;
  readonly clock = clock;
  readonly today = todayStr();

  readonly days = weekDates(this.data.monday).map((date) => ({
    date,
    menus: MEAL_TYPES.map((meal) => this.service.menuFor(date, meal)).filter((m): m is MessMenu => !!m),
  }));

  readonly toPublish = this.days.flatMap((d) => d.menus).filter((m) => m.status === 'Draft' && m.date >= this.today).length;
  readonly pastDrafts = this.days.flatMap((d) => d.menus).filter((m) => m.status === 'Draft' && m.date < this.today).length;

  label(m: MessMenu): string {
    if (m.status === 'Draft') return m.date < this.today ? 'Draft · past' : 'Will be published';
    return this.service.menuStatus(m);
  }

  publish(): void {
    this.dialogRef.close(this.service.publishWeek(this.data.monday));
  }

  close(): void {
    this.dialogRef.close();
  }
}
