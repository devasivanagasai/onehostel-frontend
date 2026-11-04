import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantSurveysService } from '../../../core/services/tenant-surveys.service';
import { SurveyAnswer, SurveyAnswers, SurveyQuestion, TEXT_MAX, TenantSurveyView } from '../../../core/models/tenant-surveys.models';
import { errMsg, fmtDate, fmtDateTime, toneOf } from '../guardians/tn-ui';

@Component({
  selector: 'app-tenant-surveys',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  styleUrl: './tenant-surveys.component.scss',
  template: `
    <div class="tn-page">
      @if (message) { <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div> }
      @if (actionError) { <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div> }

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading surveys"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else if (!surveys.length) {
        <div class="tn-card tn-state" role="status"><mat-icon aria-hidden="true">rate_review</mat-icon><p><strong>No surveys right now</strong></p><p class="tn-sub">New surveys appear here when your hostel publishes them.</p></div>
      } @else {
        @for (v of surveys; track v.survey.id) {
          <section class="tn-card" [attr.aria-label]="v.survey.title">
            <div class="tn-row tn-row--between">
              <div>
                <h2>{{ v.survey.title }}</h2>
                <div class="tn-sub">Open {{ date(v.survey.opensOn) }} to {{ date(v.survey.closesOn) }}@if (v.survey.closedAt) { · closed early }</div>
              </div>
              <span class="tn-pill tn-pill--{{ tone(v.status) }}">{{ v.status }}@if (v.survey.allowMultiple && v.submissions) { ({{ v.submissions }}x) }</span>
            </div>
            @if (v.survey.description) { <p style="margin-top:8px">{{ v.survey.description }}</p> }
            <div class="tn-banner" [class.tn-banner--warn]="!v.survey.anonymous" role="note">
              <mat-icon aria-hidden="true">{{ v.survey.anonymous ? 'visibility_off' : 'badge' }}</mat-icon><div>{{ v.anonymityNote }}</div>
            </div>

            @if (activeId === v.survey.id) {
              <form (ngSubmit)="submit(v)" novalidate style="margin-top:14px" class="tn-form">
                @for (q of v.survey.questions; track q.id) {
                  <fieldset class="tn-field tn-wide" style="border:0;padding:0;margin:0" [attr.aria-describedby]="'err-' + q.id">
                    <legend class="tn-label">{{ q.text }} @if (q.required) { <span aria-hidden="true">*</span><span class="sr-only">(required)</span> } @else { <span class="tn-hint">(optional)</span> }</legend>
                    @switch (q.type) {
                      @case ('rating') {
                        <div class="tn-chip-row" role="radiogroup" [attr.aria-label]="q.text">
                          @for (n of stars; track n) {
                            <button type="button" class="tn-chip" role="radio" [attr.aria-checked]="answers[q.id] === n" [attr.aria-pressed]="answers[q.id] === n" (click)="setAnswer(q, n)">{{ n }}</button>
                          }
                        </div>
                      }
                      @case ('single') {
                        @for (o of q.options; track o) {
                          <label class="tn-row" style="gap:8px"><input type="radio" [name]="'q-' + q.id" [checked]="answers[q.id] === o" (change)="setAnswer(q, o)" /> {{ o }}</label>
                        }
                      }
                      @case ('multiple') {
                        @for (o of q.options; track o) {
                          <label class="tn-row" style="gap:8px"><input type="checkbox" [checked]="isChecked(q, o)" (change)="toggle(q, o, $event)" /> {{ o }}</label>
                        }
                      }
                      @case ('text') {
                        <textarea [name]="'q-' + q.id" [maxlength]="textMax" rows="3" [ngModel]="textOf(q)" (ngModelChange)="setAnswer(q, $event)" [attr.aria-label]="q.text" [attr.aria-invalid]="!!errors[q.id]"></textarea>
                        <span class="tn-hint">{{ textLen(q) }}/{{ textMax }}</span>
                      }
                    }
                    <span class="tn-err" [id]="'err-' + q.id" role="alert">{{ errors[q.id] }}</span>
                  </fieldset>
                }
                <div class="tn-row tn-wide">
                  <button type="submit" class="tn-btn"><mat-icon aria-hidden="true">send</mat-icon>Submit answers</button>
                  <button type="button" class="tn-btn tn-btn--ghost" (click)="close()">Cancel</button>
                </div>
              </form>
            } @else if (v.canRespond) {
              <button type="button" class="tn-btn" style="margin-top:12px" (click)="open(v)">{{ v.submissions ? 'Answer again' : 'Respond' }}</button>
            } @else if (v.status === 'Closed') {
              <p class="tn-sub" role="status" style="margin-top:12px">This survey is closed and you did not respond.</p>
            }

            @if (v.myLatest && activeId !== v.survey.id) {
              <details style="margin-top:12px"><summary class="tn-sub" style="cursor:pointer">My submitted answers ({{ dateTime(v.myLatest.submittedAt) }}) - read only</summary>
                <ul class="tn-list">
                  @for (q of v.survey.questions; track q.id) {
                    <li><div class="tn-sub">{{ q.text }}</div><div>{{ show(v.myLatest.answers[q.id]) }}</div></li>
                  }
                </ul>
              </details>
            } @else if (v.survey.anonymous && v.submissions && activeId !== v.survey.id) {
              <p class="tn-sub" style="margin-top:12px">You submitted this anonymous survey. Your answers are not linked to you, so they cannot be shown again.</p>
            }
          </section>
        }
      }
    </div>
  `,
})
export class TenantSurveysComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantSurveysService);
  readonly tone = toneOf;
  readonly date = fmtDate;
  readonly dateTime = fmtDateTime;
  readonly stars = [1, 2, 3, 4, 5];
  readonly textMax = TEXT_MAX;

  surveys: TenantSurveyView[] = [];
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  activeId = '';
  answers: SurveyAnswers = {};
  errors: Record<string, string> = {};
  private sub?: Subscription;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.sub?.unsubscribe();
    setTimeout(() => {
      try {
        this.sub = this.service.mine$.subscribe((s) => (this.surveys = s));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  open(v: TenantSurveyView): void {
    this.message = '';
    this.actionError = '';
    this.activeId = v.survey.id;
    this.answers = {};
    this.errors = {};
  }

  close(): void {
    this.activeId = '';
    this.errors = {};
  }

  setAnswer(q: SurveyQuestion, value: SurveyAnswer): void {
    this.answers = { ...this.answers, [q.id]: value };
    delete this.errors[q.id];
  }

  isChecked(q: SurveyQuestion, option: string): boolean {
    const a = this.answers[q.id];
    return Array.isArray(a) && a.includes(option);
  }

  toggle(q: SurveyQuestion, option: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const current = Array.isArray(this.answers[q.id]) ? (this.answers[q.id] as string[]) : [];
    this.setAnswer(q, on ? [...current, option] : current.filter((o) => o !== option));
  }

  textOf(q: SurveyQuestion): string {
    const a = this.answers[q.id];
    return typeof a === 'string' ? a : '';
  }

  textLen(q: SurveyQuestion): number {
    const a = this.answers[q.id];
    return typeof a === 'string' ? a.length : 0;
  }

  show(a: SurveyAnswer | undefined): string {
    if (a === undefined) return 'Not answered';
    return Array.isArray(a) ? a.join(', ') : typeof a === 'number' ? `${a} / 5` : a;
  }

  submit(v: TenantSurveyView): void {
    this.message = '';
    this.actionError = '';
    this.errors = this.service.validateAnswers(v.survey, this.answers);
    if (Object.keys(this.errors).length) return;
    try {
      this.service.submit(v.survey.id, this.answers);
      this.message = `Thank you. Your answers to "${v.survey.title}" were submitted.`;
      this.activeId = '';
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }
}
