import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppTableCardComponent } from '../../../shared/components/table-card/app-table-card.component';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppFormatService } from '../../../core/services/app-format.service';
import { residentFullName } from '../../residents/residents.models';
import { MessService } from '../mess.service';
import { AttendanceMark, MEAL_TIMES, MEAL_TYPES, MealType, addDays, clock, localIso, todayStr } from '../mess.models';

interface Row {
  id: string;
  name: string;
  room: string;
  plan: string;
  onLeave: boolean;
  mark?: AttendanceMark;
}

/** The meal being served now, or the next one today (last meal after dinner). */
function currentMeal(): MealType {
  const now = localIso().slice(11, 16);
  return MEAL_TYPES.find((m) => now < MEAL_TIMES[m][1]) ?? 'Dinner';
}

/** Meal opt-in / attendance by date + meal. Only usable while tracking is on. */
@Component({
  selector: 'app-mess-attendance',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTableModule, MatTooltipModule, MatSlideToggleModule, MatSnackBarModule, AppTableCardComponent, AppButtonComponent],
  templateUrl: './mess-attendance.component.html',
  styleUrl: './mess-attendance.component.scss',
})
export class MessAttendanceComponent {
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['resident', 'plan', 'mark', 'status'];
  readonly meals = MEAL_TYPES;
  readonly clock = clock;
  readonly today = todayStr();
  /** Opt-outs can be recorded up to a week ahead. */
  readonly maxDate = addDays(todayStr(), 7);

  date = todayStr();
  meal: MealType = currentMeal();
  search = '';

  get enabled(): boolean {
    return this.service.settings.attendanceEnabled;
  }

  get future(): boolean {
    return this.date > this.today;
  }

  get menu() {
    const m = this.service.menuFor(this.date, this.meal);
    return m && m.status === 'Published' ? m : undefined;
  }

  /** Residents whose plan covers this meal, with their mark. */
  get rows(): Row[] {
    const marks = this.service.marks(this.date, this.meal);
    const q = this.search.trim().toLowerCase();
    return this.service
      .expectedAt(this.meal)
      .map((r) => ({
        id: r.residentId,
        name: residentFullName(r),
        room: this.service.roomOf(r.residentId),
        plan: this.service.profile(r.residentId).plan,
        onLeave: r.status === 'On Leave',
        mark: marks[r.residentId],
      }))
      .filter((r) => !q || `${r.name} ${r.id} ${r.room}`.toLowerCase().includes(q));
  }

  get counts() {
    const all = this.service.expectedAt(this.meal).map((r) => this.service.marks(this.date, this.meal)[r.residentId]);
    const present = all.filter((m) => m === 'Present').length;
    const optedOut = all.filter((m) => m === 'Opted out').length;
    return { expected: all.length, present, optedOut, unmarked: all.length - present - optedOut };
  }

  setEnabled(on: boolean): void {
    this.service.updateSettings({ attendanceEnabled: on });
  }

  /** Clicking the active mark again clears it. */
  set(row: Row, mark: AttendanceMark): void {
    this.run(() => this.service.mark(this.date, this.meal, [row.id], row.mark === mark ? null : mark));
  }

  markRestPresent(): void {
    const ids = this.rows.filter((r) => !r.mark).map((r) => r.id);
    if (!ids.length) return;
    this.run(() => this.service.mark(this.date, this.meal, ids, 'Present'), `${ids.length} resident(s) marked present.`);
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  private run(action: () => void, success?: string): void {
    try {
      action();
      if (success) this.snackBar.open(success, 'Close', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(e?.message ?? 'Something went wrong.', 'Close', { duration: 4000 });
    }
  }
}
