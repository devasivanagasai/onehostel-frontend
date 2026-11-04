import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppEmptyStateComponent } from '../../../shared/components/empty-state/app-empty-state.component';
import { ConfirmDialogService } from '../../../shared/services/confirm-dialog.service';
import { localDateIso } from '../../../shared/utils/local-date';
import { FEEDBACK_COMMENT_MAX, MessFeedback, TenantMessFeedbackService } from '../../../core/services/tenant-mess-feedback.service';
import { MEAL_OPTOUT_LEAD_HOURS, MessService, TenantMealStatus, TenantMessPlan } from '../../mess/mess.service';
import { MEAL_ICONS, MEAL_TIMES, MEAL_TYPES, MealType, MessMenu, addDays, weekDates, weekStart } from '../../mess/mess.models';
import { TenantStateComponent } from '../daily-kit/tenant-state.component';
import { TenantPageBase } from '../daily-kit/tenant-page.base';

type Tab = 'menu' | 'week' | 'plan' | 'feedback';

interface MealCard {
  meal: MealType;
  menu?: MessMenu;
  status: TenantMealStatus;
  served: boolean;
  feedback?: MessFeedback;
  canRate: boolean;
}

interface FeedbackChoice {
  key: string;
  date: string;
  meal: MealType;
}

@Component({
  selector: 'app-tenant-mess',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule, AppButtonComponent, AppEmptyStateComponent, TenantStateComponent],
  styleUrls: ['../daily-kit/tenant-daily-kit.scss'],
  template: `
    <div class="td-page">
      <div class="td-tabs" role="tablist" aria-label="Mess sections">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="td-tab" [class.is-active]="tab === t.id" [attr.aria-selected]="tab === t.id" (click)="tab = t.id; clearFeedback()">
            <mat-icon fontSet="material-icons-outlined">{{ t.icon }}</mat-icon> {{ t.label }}
          </button>
        }
      </div>

      <app-tenant-state [loading]="loading" [error]="error" loadingText="Loading menus..." (retry)="reload()">
        @if (success) {
          <div class="td-banner td-banner--ok" role="status"><mat-icon>check_circle</mat-icon><p>{{ success }}</p></div>
        }
        @if (actionError && tab !== 'feedback') {
          <div class="td-banner td-banner--bad" role="alert"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
        }

        <!-- ================= DAY MENU ================= -->
        @if (tab === 'menu') {
          <div class="td-filters">
            <app-button variant="secondary" size="sm" icon="chevron_left" ariaLabel="Previous day" (clicked)="shiftDay(-1)"></app-button>
            <label class="sr-only" for="ms-date">Menu date</label>
            <input id="ms-date" type="date" [ngModel]="date" (ngModelChange)="setDate($event)" />
            <app-button variant="secondary" size="sm" icon="chevron_right" ariaLabel="Next day" (clicked)="shiftDay(1)"></app-button>
            @if (date !== today) { <app-button variant="text" size="sm" (clicked)="setDate(today)">Today</app-button> }
            <strong>{{ fmt.date(date, 'dayDate') }}</strong>
          </div>
          <div class="td-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
            @for (c of cards; track c.meal) {
              <section class="td-card" [attr.aria-label]="c.meal">
                <div class="td-head">
                  <h3 style="display: flex; align-items: center; gap: 8px; margin: 0;"><mat-icon fontSet="material-icons-outlined">{{ icon(c.meal) }}</mat-icon> {{ c.meal }}</h3>
                  @if (c.menu) { <span class="td-pill td-pill--neutral">{{ clock(c.menu.start) }} &ndash; {{ clock(c.menu.end) }}</span> }
                  @else { <span class="td-pill td-pill--neutral">{{ clock(timing(c.meal)[0]) }} &ndash; {{ clock(timing(c.meal)[1]) }}</span> }
                </div>
                @if (c.menu; as m) {
                  <ul style="margin: 10px 0 0; padding-left: 18px; line-height: 1.7;">
                    @for (i of m.items; track i) { <li>{{ i }}</li> }
                  </ul>
                  @if (m.notes) { <p class="td-hint" style="margin: 8px 0 0;">{{ m.notes }}</p> }
                  @if (m.changes.length) {
                    <p class="td-hint" style="margin: 8px 0 0;"><mat-icon style="font-size: 16px; width: 16px; height: 16px; vertical-align: -3px;">update</mat-icon>
                      Last updated {{ dt(m.changes[0].at) }}: {{ m.changes[0].summary }}</p>
                  }
                } @else {
                  <p class="td-hint" style="margin: 12px 0 0;">The menu for this meal has not been published yet.</p>
                }
                <hr class="td-sep" />
                @if (c.status.covered && c.status.supported) {
                  <div class="td-small">
                    <strong>Your meal:</strong>
                    <span class="td-pill td-pill--{{ c.status.mark === 'Opted out' ? 'warning' : c.status.mark === 'Present' ? 'success' : 'info' }}">{{ c.status.mark === 'Opted out' ? 'Opted out' : c.status.mark === 'Present' ? 'Attended' : 'Opted in' }}</span>
                    <div class="td-muted" style="margin-top: 4px;">{{ c.status.billingImpact }}</div>
                    <div class="td-muted">Deadline to change: {{ dt(c.status.deadline) }}</div>
                    @if (c.status.canChange) {
                      <div style="margin-top: 8px;">
                        @if (c.status.mark === 'Opted out') {
                          <app-button size="sm" variant="secondary" icon="restaurant" [loading]="busy" (clicked)="toggle(c, false)">Opt back in</app-button>
                        } @else {
                          <app-button size="sm" variant="danger-outline" icon="no_meals" [loading]="busy" (clicked)="toggle(c, true)">Opt out</app-button>
                        }
                      </div>
                    } @else if (c.status.reason) {
                      <div class="td-muted" style="margin-top: 4px;">{{ c.status.reason }}</div>
                    }
                  </div>
                } @else if (!c.status.covered) {
                  <p class="td-hint" style="margin: 0;">{{ c.status.reason || 'Your plan does not cover this meal.' }}</p>
                } @else {
                  <p class="td-hint" style="margin: 0;">Meal opt-in / opt-out is not offered by your hostel.</p>
                }
                @if (c.served && c.menu) {
                  <div style="margin-top: 8px;">
                    @if (c.feedback) {
                      <span class="td-small">Your rating: <strong>{{ c.feedback.rating }}/5</strong></span>
                    } @else if (c.canRate) {
                      <app-button size="sm" variant="outline" icon="rate_review" (clicked)="rate(c.meal)">Rate this meal</app-button>
                    }
                  </div>
                }
              </section>
            }
          </div>
          @if (!anyPublished) {
            <div class="td-card"><app-empty-state icon="restaurant_menu" message="No menu published for this day" hint="Only menus published by the hostel are shown. Check back later."></app-empty-state></div>
          }
        }

        <!-- ================= WEEK ================= -->
        @if (tab === 'week') {
          <div class="td-filters">
            <app-button variant="secondary" size="sm" icon="chevron_left" ariaLabel="Previous week" (clicked)="shiftWeek(-1)"></app-button>
            <strong>{{ fmt.date(week[0], 'date') }} &ndash; {{ fmt.date(week[6], 'date') }}</strong>
            <app-button variant="secondary" size="sm" icon="chevron_right" ariaLabel="Next week" (clicked)="shiftWeek(1)"></app-button>
            <app-button variant="text" size="sm" (clicked)="thisWeek()">This week</app-button>
          </div>
          <section class="td-card">
            @if (!weekHasMenus) {
              <app-empty-state icon="calendar_month" message="No menus published for this week" hint="Only published menus appear. Try another week."></app-empty-state>
            } @else {
              <div class="td-table-wrap">
                <table class="td-table">
                  <caption class="sr-only">Weekly menu</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      @for (m of meals; track m) { <th scope="col">{{ m }}</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (day of week; track day) {
                      <tr [style.background]="day === today ? '#f4f8ff' : ''">
                        <th scope="row" class="nowrap">{{ fmt.date(day, 'dayDate') }}</th>
                        @for (m of meals; track m) {
                          <td>
                            @if (weekMenu(day, m); as menu) {
                              {{ menu.items.join(', ') }}
                              @if (menu.changes.length) { <span class="td-pill td-pill--info" style="margin-left: 4px;">Updated</span> }
                            } @else { <span class="td-muted">&ndash;</span> }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }

        <!-- ================= PLAN ================= -->
        @if (tab === 'plan') {
          @if (plan; as p) {
            <div class="td-split">
              <section class="td-card" aria-labelledby="ms-plan">
                <h3 id="ms-plan">My meal plan</h3>
                <dl class="td-kv">
                  <dt>Plan</dt><dd><span class="td-pill td-pill--info">{{ p.plan }}</span> {{ p.hint }}</dd>
                  <dt>Meals covered</dt><dd>{{ p.meals.length ? p.meals.join(', ') : 'None' }}</dd>
                  @if (p.monthlyFee !== undefined) { <dt>Monthly mess fee</dt><dd>{{ money(p.monthlyFee) }} (billed in Fees &amp; Payments)</dd> }
                  @if (p.rates) {
                    <dt>Per-meal rates</dt>
                    <dd>@for (m of meals; track m) { <span>{{ m }} {{ money(p.rates[m]) }}{{ $last ? '' : ' · ' }}</span> }</dd>
                  }
                  <dt>Meal opt-out</dt><dd>{{ p.optOutSupported ? 'Available: change a meal up to ' + deadlineHours + ' hours before it starts.' : 'Not offered by your hostel.' }}</dd>
                </dl>
                <hr class="td-sep" />
                <h3>Dietary information</h3>
                @if (p.dietaryNote) {
                  <p style="margin: 6px 0 0;">{{ p.dietaryNote }}</p>
                  @if (p.noteUpdatedAt) { <p class="td-hint">Recorded by the hostel on {{ dt(p.noteUpdatedAt) }}. To change it, ask the hostel office.</p> }
                } @else {
                  <p class="td-hint" style="margin: 6px 0 0;">The hostel has no dietary information on record for you. Tell the hostel office if you have an allergy or restriction.</p>
                }
              </section>
              <section class="td-card" aria-labelledby="ms-chg">
                <h3 id="ms-chg">Mess charges</h3>
                @if (!p.charges.length) {
                  <app-empty-state icon="receipt_long" message="No mess charges yet" hint="Charges appear here once the hostel bills them."></app-empty-state>
                } @else {
                  <ul class="td-list">
                    @for (c of p.charges; track c.id) {
                      <li class="td-row">
                        <div class="td-row__main">
                          <div class="td-row__title">{{ c.description }}</div>
                          <div class="td-row__sub">{{ c.id }} &middot; due {{ d(c.dueDate) }}</div>
                        </div>
                        <div class="td-row__side">
                          <strong>{{ money(c.total) }}</strong>
                          <span class="td-pill td-pill--{{ c.status === 'Paid' ? 'success' : c.status === 'Overdue' ? 'danger' : c.status === 'Cancelled' ? 'neutral' : 'warning' }}">{{ c.status }}</span>
                        </div>
                      </li>
                    }
                  </ul>
                }
              </section>
            </div>
          } @else {
            <div class="td-card"><app-empty-state icon="restaurant" message="No meal plan found" hint="Ask the hostel office to assign you a plan."></app-empty-state></div>
          }
        }

        <!-- ================= FEEDBACK ================= -->
        @if (tab === 'feedback') {
          <div class="td-split">
            <section class="td-card" aria-labelledby="ms-fb">
              <h3 id="ms-fb">Rate a meal</h3>
              <p class="td-card__sub">You can rate meals from the last 7 days that were served and that your plan covers. One rating per meal.</p>
              @if (!choices.length) {
                <app-empty-state icon="rate_review" message="No meals to rate right now" hint="Meals you attended in the last 7 days that you have not rated appear here."></app-empty-state>
              } @else {
                <form class="td-form" (ngSubmit)="sendFeedback()" novalidate>
                  <div class="td-field td-field--wide">
                    <label for="ms-fb-meal">Meal <span class="td-req" aria-hidden="true">*</span></label>
                    <select id="ms-fb-meal" name="meal" [(ngModel)]="fbKey" [attr.aria-invalid]="!!fbErrors['meal']">
                      <option value="">Select a meal</option>
                      @for (c of choices; track c.key) { <option [value]="c.key">{{ fmt.date(c.date, 'dayDate') }} &middot; {{ c.meal }}</option> }
                    </select>
                    @if (fbErrors['meal']) { <p class="td-err" role="alert">{{ fbErrors['meal'] }}</p> }
                  </div>
                  <div class="td-field td-field--wide">
                    <span class="td-label" id="ms-fb-rate">Rating <span class="td-req" aria-hidden="true">*</span></span>
                    <div class="td-stars" role="radiogroup" aria-labelledby="ms-fb-rate">
                      @for (n of stars; track n) {
                        <button type="button" class="td-star" role="radio" [class.is-on]="n <= fbRating" [attr.aria-checked]="n === fbRating" [attr.aria-label]="n + ' out of 5'" (click)="fbRating = n">
                          <mat-icon>{{ n <= fbRating ? 'star' : 'star_border' }}</mat-icon>
                        </button>
                      }
                    </div>
                    @if (fbErrors['rating']) { <p class="td-err" role="alert">{{ fbErrors['rating'] }}</p> }
                  </div>
                  <div class="td-field td-field--wide">
                    <label for="ms-fb-comment">Comment (optional)</label>
                    <textarea id="ms-fb-comment" name="comment" [maxlength]="commentMax" [(ngModel)]="fbComment" [attr.aria-invalid]="!!fbErrors['comment']"></textarea>
                    <span class="td-hint">{{ fbComment.length }}/{{ commentMax }}</span>
                    @if (fbErrors['comment']) { <p class="td-err" role="alert">{{ fbErrors['comment'] }}</p> }
                  </div>
                  @if (actionError) {
                    <div class="td-banner td-banner--bad" role="alert" style="grid-column: 1 / -1;"><mat-icon>error_outline</mat-icon><p>{{ actionError }}</p></div>
                  }
                  <div class="td-actions" style="grid-column: 1 / -1;">
                    <app-button type="submit" icon="send" [loading]="busy">Submit feedback</app-button>
                  </div>
                </form>
              }
            </section>
            <section class="td-card" aria-labelledby="ms-fb-list">
              <h3 id="ms-fb-list">My feedback</h3>
              @if (!myFeedback.length) {
                <app-empty-state icon="reviews" message="No feedback yet" hint="Your ratings will be listed here."></app-empty-state>
              } @else {
                <ul class="td-list">
                  @for (f of myFeedback; track f.id) {
                    <li class="td-row">
                      <div class="td-row__main">
                        <div class="td-row__title">{{ f.meal }} &middot; {{ fmt.date(f.date, 'date') }}</div>
                        @if (f.comment) { <div class="td-row__sub">{{ f.comment }}</div> }
                        <div class="td-row__sub">Sent {{ dt(f.createdAt) }}</div>
                      </div>
                      <div class="td-row__side"><span class="td-pill td-pill--warning">{{ f.rating }}/5</span></div>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }
      </app-tenant-state>
    </div>
  `,
})
export class TenantMessComponent extends TenantPageBase {
  readonly service = inject(MessService);
  readonly feedback = inject(TenantMessFeedbackService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'menu', label: 'Menu', icon: 'restaurant_menu' },
    { id: 'week', label: 'Weekly view', icon: 'calendar_view_week' },
    { id: 'plan', label: 'My plan', icon: 'badge' },
    { id: 'feedback', label: 'Feedback', icon: 'rate_review' },
  ];
  readonly meals = MEAL_TYPES;
  readonly stars = [1, 2, 3, 4, 5];
  readonly commentMax = FEEDBACK_COMMENT_MAX;
  readonly deadlineHours = MEAL_OPTOUT_LEAD_HOURS;

  tab: Tab = 'menu';
  today = localDateIso();
  date = localDateIso();
  weekMonday = weekStart(localDateIso());
  week: string[] = weekDates(weekStart(localDateIso()));

  cards: MealCard[] = [];
  anyPublished = false;
  weekHasMenus = false;
  private weekMap = new Map<string, MessMenu>();
  plan: TenantMessPlan | undefined;

  choices: FeedbackChoice[] = [];
  myFeedback: MessFeedback[] = [];
  fbKey = '';
  fbRating = 0;
  fbComment = '';
  fbErrors: Record<string, string> = {};

  constructor() {
    super();
    this.watch(this.service.state$, this.feedback.all$);
    this.start();
  }

  protected refresh(): void {
    this.today = localDateIso();
    this.cards = MEAL_TYPES.map((meal) => {
      const menu = this.service.tenantMenuFor(this.date, meal);
      const served = this.service.tenantServed(this.date, meal);
      const fb = this.feedback.forMeal(this.date, meal);
      return { meal, menu, status: this.service.tenantMealStatus(this.date, meal), served, feedback: fb, canRate: !fb && !this.feedback.blocker(this.date, meal) };
    });
    this.anyPublished = this.cards.some((c) => !!c.menu);

    this.week = weekDates(this.weekMonday);
    this.weekMap = new Map(this.service.tenantMenus(this.week[0], this.week[6]).map((m) => [`${m.date}|${m.mealType}`, m]));
    this.weekHasMenus = this.weekMap.size > 0;

    this.plan = this.service.tenantPlan();

    const choices: FeedbackChoice[] = [];
    for (let i = 0; i <= 7; i++) {
      const date = addDays(this.today, -i);
      for (const meal of MEAL_TYPES) if (!this.feedback.blocker(date, meal)) choices.push({ key: `${date}|${meal}`, date, meal });
    }
    this.choices = choices;
    if (this.fbKey && !choices.some((c) => c.key === this.fbKey)) this.fbKey = '';
    this.myFeedback = this.feedback.mine();
  }

  icon(m: MealType): string {
    return MEAL_ICONS[m];
  }

  timing(m: MealType): [string, string] {
    return MEAL_TIMES[m];
  }

  weekMenu(day: string, meal: MealType): MessMenu | undefined {
    return this.weekMap.get(`${day}|${meal}`);
  }

  setDate(value: string): void {
    this.date = value || this.today;
    this.clearFeedback();
    this.run();
  }

  shiftDay(n: number): void {
    this.setDate(addDays(this.date, n));
  }

  shiftWeek(n: number): void {
    this.weekMonday = addDays(this.weekMonday, 7 * n);
    this.run();
  }

  thisWeek(): void {
    this.weekMonday = weekStart(this.today);
    this.run();
  }

  toggle(c: MealCard, optOut: boolean): void {
    this.clearFeedback();
    const go = (): void => {
      this.busy = true;
      try {
        this.service.tenantSetOptOut(this.date, c.meal, optOut);
        this.run();
        this.done(optOut ? `You opted out of ${c.meal} on ${this.d(this.date)}.` : `You are opted in for ${c.meal} on ${this.d(this.date)}.`);
      } catch (e) {
        this.failed(e);
        this.run();
      } finally {
        this.busy = false;
      }
    };
    if (!optOut) {
      go();
      return;
    }
    this.confirmDialog
      .confirm({
        title: `Opt out of ${c.meal}?`,
        message: `You will skip ${c.meal} on ${this.d(this.date)}.`,
        confirmLabel: 'Opt out',
        details: [{ icon: 'payments', label: 'Billing impact', value: c.status.billingImpact }],
      })
      .subscribe((ok) => ok && go());
  }

  rate(meal: MealType): void {
    this.fbKey = `${this.date}|${meal}`;
    this.fbRating = 0;
    this.fbComment = '';
    this.fbErrors = {};
    this.tab = 'feedback';
    this.clearFeedback();
  }

  sendFeedback(): void {
    if (this.busy) return;
    this.clearFeedback();
    this.fbErrors = {};
    if (!this.fbKey) this.fbErrors['meal'] = 'Select a meal';
    if (!this.fbRating) this.fbErrors['rating'] = 'Choose a rating from 1 to 5';
    if (this.fbComment.length > this.commentMax) this.fbErrors['comment'] = `At most ${this.commentMax} characters`;
    if (Object.keys(this.fbErrors).length) return;
    const [date, meal] = this.fbKey.split('|');
    this.busy = true;
    try {
      this.feedback.submit({ date, meal: meal as MealType, rating: this.fbRating, comment: this.fbComment });
      this.fbKey = '';
      this.fbRating = 0;
      this.fbComment = '';
      this.run();
      this.done('Thanks, your feedback was sent to the hostel.');
    } catch (e) {
      this.failed(e);
    } finally {
      this.busy = false;
    }
  }
}

