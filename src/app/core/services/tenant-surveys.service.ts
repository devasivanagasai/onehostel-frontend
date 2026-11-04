import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ResidentsService } from './residents.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import {
  ANONYMOUS_NOTE,
  CreateSurveyInput,
  IDENTIFIED_NOTE,
  QUESTION_TYPES,
  QuestionResult,
  Survey,
  SurveyAnswer,
  SurveyAnswers,
  SurveyQuestion,
  SurveyResponse,
  SurveyResults,
  TEXT_MAX,
  TEXT_MIN,
  TenantSurveyStatus,
  TenantSurveyView,
} from '../models/tenant-surveys.models';
import { localDateIso } from '../../shared/utils/local-date';

const SURVEYS_KEY = 'onehostel_tenant_surveys_v1';
const RESPONSES_KEY = 'onehostel_tenant_survey_responses_v1';
/** Separate store: one-way markers (no resident id) that only exist to block duplicate submissions. */
const MARKERS_KEY = 'onehostel_tenant_survey_markers_v1';
const SALT = 'onehostel-survey-v1';

const pad = (n: number): string => String(n).padStart(2, '0');
const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const addDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateIso(d);
};

/** One-way hash (cyrb53). A real build would use a salted server-side HMAC. */
function marker(surveyId: string, residentId: string): string {
  const str = `${SALT}|${surveyId}|${residentId}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function read<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* use fallback */
  }
  return fallback();
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kept in memory */
  }
}

function seedSurveys(): Survey[] {
  const q = (id: string, text: string, type: SurveyQuestion['type'], required: boolean, options?: string[]): SurveyQuestion => ({ id, text, type, required, options });
  return [
    {
      id: 'SRV001', title: 'Mess & food satisfaction', description: 'Help us improve meals. This survey is anonymous.', anonymous: true, allowMultiple: false,
      opensOn: addDays(-10), closesOn: addDays(20), createdAt: `${addDays(-10)}T09:00:00`,
      questions: [
        q('q1', 'How would you rate the overall quality of food?', 'rating', true),
        q('q2', 'Which meal needs the most improvement?', 'single', true, ['Breakfast', 'Lunch', 'Snacks', 'Dinner']),
        q('q3', 'Any suggestions for the mess committee?', 'text', false),
      ],
    },
    {
      id: 'SRV002', title: 'Hostel facilities feedback', description: 'Tell us how the common facilities are working for you. Your answers are linked to your resident ID.', anonymous: false, allowMultiple: false,
      opensOn: addDays(-3), closesOn: addDays(30), createdAt: `${addDays(-3)}T09:00:00`,
      questions: [
        q('q1', 'How satisfied are you with cleanliness?', 'rating', true),
        q('q2', 'Which facilities do you use regularly?', 'multiple', true, ['Wi-Fi', 'Laundry', 'Common room', 'Study hall', 'Gym']),
        q('q3', 'What is one thing we should fix first?', 'text', true),
      ],
    },
    {
      id: 'SRV003', title: 'Maintenance experience (last quarter)', description: 'Closed survey about repairs and response times.', anonymous: false, allowMultiple: false,
      opensOn: addDays(-60), closesOn: addDays(-15), createdAt: `${addDays(-60)}T09:00:00`,
      questions: [q('q1', 'How fast were your complaints handled?', 'rating', true), q('q2', 'Comments', 'text', false)],
    },
    {
      id: 'SRV004', title: 'Weekly check-in', description: 'A quick pulse check. You can answer it every week.', anonymous: false, allowMultiple: true,
      opensOn: addDays(-5), closesOn: addDays(60), createdAt: `${addDays(-5)}T09:00:00`,
      questions: [q('q1', 'How is your stay this week?', 'rating', true)],
    },
  ];
}

function seedResponses(): SurveyResponse[] {
  return [
    { id: 'RSP000001', surveyId: 'SRV003', residentId: 'RES000001', answers: { q1: 4, q2: 'Plumber came the same day.' }, submittedAt: `${addDays(-30)}T18:20:00` },
    { id: 'RSP000002', surveyId: 'SRV003', residentId: 'RES000002', answers: { q1: 3 }, submittedAt: `${addDays(-28)}T12:00:00` },
    { id: 'RSP000003', surveyId: 'SRV001', answers: { q1: 4, q2: 'Dinner', q3: 'More vegetables please.' }, submittedAt: `${addDays(-6)}T20:10:00` },
    { id: 'RSP000004', surveyId: 'SRV001', answers: { q1: 2, q2: 'Breakfast' }, submittedAt: `${addDays(-4)}T09:05:00` },
  ];
}

function seedMarkers(): Record<string, number> {
  return { [marker('SRV001', 'RES000002')]: 1, [marker('SRV001', 'RES000003')]: 1 };
}

/**
 * Feedback & surveys (FRD 7.5). A Tenant sees every published survey, answers only while it is open,
 * and (unless `allowMultiple`) only once. Anonymous answers are saved with no resident id; a one-way marker
 * kept in a separate store is all that remembers that this Tenant already answered.
 */
@Injectable({ providedIn: 'root' })
export class TenantSurveysService {
  private readonly tenant = inject(TenantContextService);
  private readonly staffAuth = inject(AuthService);
  private readonly residents = inject(ResidentsService);
  private readonly notices = inject(TenantNotificationService);

  private readonly surveys = new BehaviorSubject<Survey[]>(read(SURVEYS_KEY, seedSurveys));
  private readonly responses = new BehaviorSubject<SurveyResponse[]>(read(RESPONSES_KEY, seedResponses));
  private markers = read<Record<string, number>>(MARKERS_KEY, seedMarkers);

  /** Published surveys with my status, newest first. */
  readonly mine$: Observable<TenantSurveyView[]> = combineLatest([this.surveys, this.responses]).pipe(map(() => this.mine));

  get mine(): TenantSurveyView[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    const today = localDateIso();
    return this.surveys.value
      .filter((s) => s.opensOn <= today)
      .map((s) => this.view(s, me, today))
      .sort((a, b) => b.survey.opensOn.localeCompare(a.survey.opensOn) || b.survey.id.localeCompare(a.survey.id));
  }

  /** Is this survey open for answers right now (dates and not closed early)? */
  isOpen(s: Survey, today = localDateIso()): boolean {
    return !s.closedAt && s.opensOn <= today && today <= s.closesOn;
  }

  /** First problem with a set of answers, keyed by question id (empty object = valid). */
  validateAnswers(survey: Survey, answers: SurveyAnswers): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const q of survey.questions) {
      const a = answers[q.id];
      const blank = a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0);
      if (blank) {
        if (q.required) errors[q.id] = 'This question needs an answer.';
        continue;
      }
      const problem = this.answerProblem(q, a);
      if (problem) errors[q.id] = problem;
    }
    for (const k of Object.keys(answers)) if (!survey.questions.some((q) => q.id === k)) errors[k] = 'Unknown question.';
    return errors;
  }

  /** Submit answers for a survey as the signed-in Tenant. */
  submit(surveyId: string, answers: SurveyAnswers): SurveyResponse {
    const me = this.tenant.requireResidentId();
    const s = this.surveys.value.find((x) => x.id === surveyId);
    const today = localDateIso();
    if (!s || s.opensOn > today) throw new Error('Survey not found.');
    if (!this.isOpen(s, today)) throw new Error('This survey is closed.');
    if (!s.allowMultiple && this.submissionsFor(s, me) > 0) throw new Error('You have already answered this survey.');
    const errors = this.validateAnswers(s, answers);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);

    const clean: SurveyAnswers = {};
    for (const q of s.questions) {
      const a = answers[q.id];
      if (a === undefined || a === '' || (Array.isArray(a) && !a.length)) continue;
      clean[q.id] = typeof a === 'string' ? a.trim() : Array.isArray(a) ? [...a] : a;
    }
    const res: SurveyResponse = {
      id: `RSP${String(this.responses.value.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0) + 1).padStart(6, '0')}`,
      surveyId: s.id,
      residentId: s.anonymous ? undefined : me,
      answers: clean,
      submittedAt: nowIso(),
    };
    if (s.anonymous) {
      const m = marker(s.id, me);
      this.markers = { ...this.markers, [m]: (this.markers[m] ?? 0) + 1 };
      write(MARKERS_KEY, this.markers);
    }
    this.saveResponses([...this.responses.value, res]);
    // The receipt carries no answers; for anonymous surveys it is the only trace tied to this Tenant.
    return { ...res };
  }

  // ---- Owner side ---------------------------------------------------------------------

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.staffAuth.isHostelOwner || this.staffAuth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  createSurvey(input: CreateSurveyInput): Survey {
    this.requireStaff();
    const title = input.title?.trim() ?? '';
    if (title.length < 3 || title.length > 100) throw new Error('Title must be 3-100 characters.');
    if (!input.opensOn || !input.closesOn) throw new Error('Choose opening and closing dates.');
    if (input.closesOn < input.opensOn) throw new Error('The closing date cannot be before the opening date.');
    if (input.closesOn < localDateIso()) throw new Error('The closing date cannot be in the past.');
    if (!input.questions?.length) throw new Error('Add at least one question.');
    if (input.questions.length > 20) throw new Error('A survey can have at most 20 questions.');
    const questions: SurveyQuestion[] = input.questions.map((q, i) => {
      if (!QUESTION_TYPES.includes(q.type)) throw new Error(`Question ${i + 1} has an unknown type.`);
      if (!q.text?.trim()) throw new Error(`Question ${i + 1} needs text.`);
      let options: string[] | undefined;
      if (q.type === 'single' || q.type === 'multiple') {
        options = [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))];
        if (options.length < 2) throw new Error(`Question ${i + 1} needs at least two different options.`);
      }
      return { id: `q${i + 1}`, text: q.text.trim(), type: q.type, required: !!q.required, options };
    });
    const survey: Survey = {
      id: `SRV${String(this.surveys.value.reduce((m, s) => Math.max(m, Number(s.id.slice(3)) || 0), 0) + 1).padStart(3, '0')}`,
      title,
      description: input.description?.trim() ?? '',
      anonymous: !!input.anonymous,
      allowMultiple: !!input.allowMultiple,
      opensOn: input.opensOn,
      closesOn: input.closesOn,
      questions,
      createdAt: nowIso(),
    };
    this.saveSurveys([survey, ...this.surveys.value]);
    if (survey.opensOn <= localDateIso()) {
      for (const r of this.residents.residents.filter((x) => x.status === 'Active' && !x.deactivatedAt)) {
        this.notices.push(r.residentId, { category: 'Survey', title: 'New survey', body: `"${survey.title}" is open for your feedback.`, route: '/my/surveys' });
      }
    }
    return survey;
  }

  closeSurvey(surveyId: string): Survey {
    this.requireStaff();
    const s = this.surveys.value.find((x) => x.id === surveyId);
    if (!s) throw new Error('Survey not found.');
    if (s.closedAt) throw new Error('This survey is already closed.');
    const next = { ...s, closedAt: nowIso() };
    this.saveSurveys(this.surveys.value.map((x) => (x.id === s.id ? next : x)));
    return next;
  }

  /** Aggregated results. Anonymous surveys never reveal who answered; text answers carry no resident id. */
  results(surveyId: string): SurveyResults {
    this.requireStaff();
    const s = this.surveys.value.find((x) => x.id === surveyId);
    if (!s) throw new Error('Survey not found.');
    const rs = this.responses.value.filter((r) => r.surveyId === s.id);
    const questions: QuestionResult[] = s.questions.map((question) => {
      const given = rs.map((r) => r.answers[question.id]).filter((a): a is SurveyAnswer => a !== undefined);
      const out: QuestionResult = { question, answered: given.length };
      if (question.type === 'rating') {
        const nums = given.filter((a): a is number => typeof a === 'number');
        out.average = nums.length ? Math.round((nums.reduce((t, n) => t + n, 0) / nums.length) * 100) / 100 : 0;
        out.counts = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(n), nums.filter((x) => x === n).length]));
      } else if (question.type === 'text') {
        out.texts = given.filter((a): a is string => typeof a === 'string');
      } else {
        const counts: Record<string, number> = Object.fromEntries((question.options ?? []).map((o) => [o, 0]));
        for (const a of given) for (const v of Array.isArray(a) ? a : [String(a)]) counts[v] = (counts[v] ?? 0) + 1;
        out.counts = counts;
      }
      return out;
    });
    return { survey: s, responseCount: rs.length, questions };
  }

  // ---- internals ----------------------------------------------------------------------

  private view(s: Survey, me: string, today: string): TenantSurveyView {
    const submissions = this.submissionsFor(s, me);
    const open = this.isOpen(s, today);
    const status: TenantSurveyStatus = !s.allowMultiple && submissions > 0 ? 'Submitted' : open ? 'Open' : submissions > 0 ? 'Submitted' : 'Closed';
    const mine = s.anonymous ? [] : this.responses.value.filter((r) => r.surveyId === s.id && r.residentId === me).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return {
      survey: { ...s, questions: s.questions.map((q) => ({ ...q, options: q.options ? [...q.options] : undefined })) },
      status,
      submissions,
      myLatest: mine[0] ? { ...mine[0], answers: { ...mine[0].answers } } : undefined,
      canRespond: open && (s.allowMultiple || submissions === 0),
      anonymityNote: s.anonymous ? ANONYMOUS_NOTE : IDENTIFIED_NOTE,
    };
  }

  private submissionsFor(s: Survey, me: string): number {
    return s.anonymous ? (this.markers[marker(s.id, me)] ?? 0) : this.responses.value.filter((r) => r.surveyId === s.id && r.residentId === me).length;
  }

  private answerProblem(q: SurveyQuestion, a: SurveyAnswer): string {
    switch (q.type) {
      case 'rating':
        return typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= 5 ? '' : 'Choose a rating from 1 to 5.';
      case 'single':
        return typeof a === 'string' && (q.options ?? []).includes(a) ? '' : 'Choose one of the listed options.';
      case 'multiple':
        return Array.isArray(a) && a.length >= 1 && a.every((v) => typeof v === 'string' && (q.options ?? []).includes(v)) && new Set(a).size === a.length ? '' : 'Choose at least one of the listed options.';
      case 'text': {
        const len = typeof a === 'string' ? a.trim().length : -1;
        return len >= TEXT_MIN && len <= TEXT_MAX ? '' : `Write between ${TEXT_MIN} and ${TEXT_MAX} characters.`;
      }
    }
  }

  private saveSurveys(list: Survey[]): void {
    this.surveys.next(list);
    write(SURVEYS_KEY, list);
  }

  private saveResponses(list: SurveyResponse[]): void {
    this.responses.next(list);
    write(RESPONSES_KEY, list);
  }
}
