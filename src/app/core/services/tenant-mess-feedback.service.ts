import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { TenantContextService } from './tenant-context.service';
import { MessService } from '../../features/mess/mess.service';
import { MEAL_TYPES, MealType, localIso, todayStr } from '../../features/mess/mess.models';

const STORAGE_KEY = 'onehostel_mess_feedback_v1';
export const FEEDBACK_COMMENT_MAX = 300;

export interface MessFeedback {
  /** e.g. MFB000001 */
  id: string;
  residentId: string;
  /** Meal date (yyyy-mm-dd). */
  date: string;
  meal: MealType;
  /** 1 to 5. */
  rating: number;
  comment?: string;
  /** Local date-time. */
  createdAt: string;
}

export interface FeedbackInput {
  date: string;
  meal: MealType;
  rating: number;
  comment?: string;
}

/**
 * Mess feedback from Tenants (FRD 6.3): a 1-5 rating and an optional comment, once per meal per day,
 * only for meals already served and only by residents whose plan covers the meal.
 * OWNER SIDE for later: `ownerList()` (owner / admin only).
 */
@Injectable({ providedIn: 'root' })
export class TenantMessFeedbackService {
  private readonly tenant = inject(TenantContextService);
  private readonly mess = inject(MessService);
  private readonly auth = inject(AuthService);

  private readonly subject = new BehaviorSubject<MessFeedback[]>(this.load());
  readonly all$: Observable<MessFeedback[]> = this.subject.asObservable();

  /** The signed-in Tenant's feedback, newest meal first. */
  mine(): MessFeedback[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    return this.subject.value.filter((f) => f.residentId === me).sort((a, b) => `${b.date}${MEAL_TYPES.indexOf(b.meal)}`.localeCompare(`${a.date}${MEAL_TYPES.indexOf(a.meal)}`));
  }

  forMeal(date: string, meal: MealType): MessFeedback | undefined {
    return this.mine().find((f) => f.date === date && f.meal === meal);
  }

  /** Why feedback can't be given for this meal now; '' when it can. */
  blocker(date: string, meal: MealType): string {
    const me = this.tenant.residentId;
    if (!me) return 'Sign in as a Tenant to do this.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return 'Pick the meal date.';
    if (!MEAL_TYPES.includes(meal)) return 'Pick a valid meal.';
    if (date > todayStr() || !this.mess.tenantMenuFor(date, meal)) {
      return date > todayStr() ? 'You can rate a meal only after it has been served.' : 'There was no published menu for this meal.';
    }
    if (!this.mess.tenantServed(date, meal)) return 'You can rate a meal only after it has been served.';
    const status = this.mess.tenantMealStatus(date, meal);
    if (!status.covered) return 'Your meal plan does not cover this meal.';
    if (status.mark === 'Opted out') return 'You opted out of this meal.';
    if (this.forMeal(date, meal)) return 'You have already given feedback for this meal.';
    return '';
  }

  /** Saves feedback for one of the Tenant's own meals. */
  submit(input: FeedbackInput): MessFeedback {
    const me = this.tenant.requireResidentId();
    const problem = this.blocker(input.date, input.meal);
    if (problem) throw new Error(problem);
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error('Choose a rating from 1 to 5.');
    const comment = input.comment?.trim() || undefined;
    if (comment && comment.length > FEEDBACK_COMMENT_MAX) throw new Error(`Comment can be at most ${FEEDBACK_COMMENT_MAX} characters.`);
    const list = this.subject.value;
    const max = list.reduce((m, f) => Math.max(m, Number(f.id.slice(3)) || 0), 0);
    const entry: MessFeedback = { id: `MFB${String(max + 1).padStart(6, '0')}`, residentId: me, date: input.date, meal: input.meal, rating: input.rating, comment, createdAt: localIso() };
    this.save([entry, ...list]);
    return entry;
  }

  /** OWNER SIDE: all feedback, newest first. Owner / Admin only. */
  ownerList(): MessFeedback[] {
    if (!this.auth.isHostelOwner && !this.auth.isAdmin) throw new Error('Only the hostel owner can read mess feedback.');
    return [...this.subject.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private save(list: MessFeedback[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Kept in memory.
    }
  }

  private load(): MessFeedback[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as MessFeedback[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the seed.
    }
    const d = (days: number): string => {
      const x = new Date();
      x.setDate(x.getDate() - days);
      return todayStrOf(x);
    };
    return [
      { id: 'MFB000001', residentId: 'RES000001', date: d(3), meal: 'Dinner', rating: 4, comment: 'Good dal makhani, chapati was slightly cold.', createdAt: `${d(3)}T21:45:00` },
      { id: 'MFB000002', residentId: 'RES000002', date: d(3), meal: 'Dinner', rating: 3, createdAt: `${d(3)}T22:00:00` },
    ];
  }
}

function todayStrOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
