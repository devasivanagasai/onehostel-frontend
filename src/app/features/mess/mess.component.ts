import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { AppFormatService } from '../../core/services/app-format.service';
import { MessService } from './mess.service';
import { MEAL_TYPES, monthOffset, periodLabel, todayStr, weekStart } from './mess.models';
import { MessWeekComponent } from './mess-week/mess-week.component';
import { MessAttendanceComponent } from './mess-attendance/mess-attendance.component';
import { MessPlansComponent } from './mess-plans/mess-plans.component';

type Tab = 'menu' | 'attendance' | 'plans';

interface MessStats {
  published: number;
  drafts: number;
  presentToday: number;
  expectedToday: number;
  onPlan: number;
  perMeal: number;
  lastMonth: string;
  lastMonthBilled: boolean;
  lastMonthAmount: number;
}

/** Mess & Food Management: KPI row + tabs. Each tab is its own child component. */
@Component({
  selector: 'app-mess',
  standalone: true,
  imports: [CommonModule, MatIconModule, MessWeekComponent, MessAttendanceComponent, MessPlansComponent],
  templateUrl: './mess.component.html',
  styleUrl: './mess.component.scss',
})
export class MessComponent {
  readonly service = inject(MessService);
  readonly fmt = inject(AppFormatService);

  tab: Tab = 'menu';

  readonly stats$ = this.service.state$.pipe(map(() => this.stats()));

  private stats(): MessStats {
    const s = this.service;
    const today = todayStr();
    const week = s.weekMenus(weekStart(today));
    let presentToday = 0;
    let expectedToday = 0;
    for (const meal of MEAL_TYPES) {
      presentToday += Object.values(s.marks(today, meal)).filter((m) => m === 'Present').length;
      expectedToday += s.expectedAt(meal).length;
    }
    const lastMonth = monthOffset(-1);
    const rows = s.previewBilling(lastMonth).filter((r) => r.amount > 0);
    return {
      published: week.filter((m) => m.status === 'Published').length,
      drafts: week.filter((m) => m.status === 'Draft').length,
      presentToday,
      expectedToday,
      onPlan: s.messResidents.length,
      perMeal: s.currentResidents.filter((r) => s.profile(r.residentId).plan === 'Pay per Meal').length,
      lastMonth: periodLabel(lastMonth),
      lastMonthBilled: rows.length > 0 && rows.every((r) => r.chargeId),
      lastMonthAmount: rows.reduce((sum, r) => sum + r.amount, 0),
    };
  }
}
