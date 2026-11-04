export const QUESTION_TYPES = ['rating', 'single', 'multiple', 'text'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  rating: 'Rating (1-5)',
  single: 'Choose one',
  multiple: 'Choose one or more',
  text: 'Written answer',
};

export interface SurveyQuestion {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  /** Single / multiple choice only. */
  options?: string[];
}

export interface Survey {
  /** SRV001 */
  id: string;
  title: string;
  description: string;
  /** Anonymous: answers are stored without any link to the Tenant. */
  anonymous: boolean;
  /** Allow more than one submission per Tenant. */
  allowMultiple: boolean;
  /** yyyy-mm-dd, inclusive */
  opensOn: string;
  /** yyyy-mm-dd, inclusive */
  closesOn: string;
  /** Set when the owner closes it early. */
  closedAt?: string;
  questions: SurveyQuestion[];
  createdAt: string;
}

export type SurveyAnswer = number | string | string[];
export type SurveyAnswers = Record<string, SurveyAnswer>;

/** A stored response. Anonymous ones have NO residentId. */
export interface SurveyResponse {
  id: string;
  surveyId: string;
  residentId?: string;
  answers: SurveyAnswers;
  submittedAt: string;
}

export type TenantSurveyStatus = 'Open' | 'Submitted' | 'Closed';

export interface TenantSurveyView {
  survey: Survey;
  status: TenantSurveyStatus;
  /** How many times this Tenant submitted (anonymous ones are counted from the duplicate markers). */
  submissions: number;
  /** My answers (identified surveys only; anonymous answers are not linked to me). */
  myLatest?: SurveyResponse;
  canRespond: boolean;
  anonymityNote: string;
}

export interface CreateSurveyInput {
  title: string;
  description: string;
  anonymous: boolean;
  allowMultiple: boolean;
  opensOn: string;
  closesOn: string;
  questions: Omit<SurveyQuestion, 'id'>[];
}

export interface QuestionResult {
  question: SurveyQuestion;
  answered: number;
  /** Rating: average. */
  average?: number;
  /** Rating / choice: count per value. */
  counts?: Record<string, number>;
  /** Text answers (never linked to a Tenant here). */
  texts?: string[];
}

export interface SurveyResults {
  survey: Survey;
  responseCount: number;
  questions: QuestionResult[];
}

export const TEXT_MIN = 1;
export const TEXT_MAX = 500;
export const ANONYMOUS_NOTE = 'Anonymous survey: your answers are saved without your name or resident ID, so nobody can tell who wrote them. Because of that you cannot view them again after submitting.';
export const IDENTIFIED_NOTE = 'Not anonymous: your answers are saved with your resident ID so the hostel office can follow up. Only hostel staff can see them.';
