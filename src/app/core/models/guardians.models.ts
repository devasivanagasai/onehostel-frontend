// Parent / Guardian Management (FRD 6.3). Mock data: nothing is sent anywhere.

export const GUARDIAN_RELATIONSHIP_OPTIONS = ['Parent', 'Guardian', 'Other'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIP_OPTIONS)[number];

/** System-managed: the owner never types this in. */
export const VERIFICATION_STATUSES = ['Unverified', 'Pending', 'Verified', 'Rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_TONES: Record<VerificationStatus, string> = {
  Unverified: 'neutral',
  Pending: 'warning',
  Verified: 'success',
  Rejected: 'danger',
};

/** Where the guardian agreed to be notified. 'None' = they declined all notifications. */
export const CONSENT_CHANNELS = ['SMS', 'Email', 'Push', 'None'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** Information a guardian may receive. Only about the linked resident, never anyone else. */
export const ACCESS_SCOPES = ['Leave decisions', 'Emergency alerts', 'Dues', 'Notices', 'Attendance summary'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

/** What a guardian alert is about; one of the permitted scopes. */
export type GuardianNotifyKind = AccessScope;

export type AccessState = 'Active' | 'Revoked';

export const ACCESS_STATES: AccessState[] = ['Active', 'Revoked'];

/** Effective access: computed from the resident record plus any manual revoke. */
export interface EffectiveAccess {
  state: AccessState;
  /** Shown beside a revoked guardian, e.g. "Access revoked – resident checked out". */
  reason: string;
  /** True when the revoke comes from the resident record (cannot be restored by hand). */
  automatic: boolean;
}

/** A pending verification code. Simulated: a real build sends it by SMS / email link. */
export interface GuardianOtp {
  code: string;
  /** ISO local date-time. */
  sentAt: string;
  /** ISO local date-time. */
  expiresAt: string;
  /** Wrong codes entered so far. */
  attempts: number;
  /** Where it would have been sent. */
  sentTo: string;
}

export interface ManualRevoke {
  reason: string;
  at: string;
  by: string;
}

export interface GuardianEvent {
  at: string;
  by: string;
  action: string;
  note?: string;
}

export interface Guardian {
  /** GDN000001. */
  id: string;
  residentId: string;
  name: string;
  relationship: GuardianRelationship;
  /** 10 digits, no country code. */
  mobile?: string;
  email?: string;
  /** Exactly one guardian per resident is primary. */
  primary: boolean;
  verification: VerificationStatus;
  verifiedAt?: string;
  consent: ConsentChannel;
  /** YYYY-MM-DD the consent was captured. */
  consentDate: string;
  scope: AccessScope[];
  otp?: GuardianOtp;
  manualRevoke?: ManualRevoke;
  createdAt: string;
  updatedAt: string;
  history: GuardianEvent[];
}

/** Form payload for Add / Edit. System fields are filled by the service. */
export interface GuardianInput {
  residentId: string;
  name: string;
  relationship: GuardianRelationship;
  mobile?: string;
  email?: string;
  primary: boolean;
  consent: ConsentChannel;
  consentDate: string;
  scope: AccessScope[];
}

export interface VerifyResult {
  ok: boolean;
  status: VerificationStatus;
  message: string;
  /** Wrong-code tries left before the guardian is Rejected (only on a wrong code). */
  attemptsLeft?: number;
}

export const MAX_OTP_ATTEMPTS = 3;
export const DEFAULT_OTP_MINUTES = 10;
export const REASON_MAX = 200;

export const MOBILE_PATTERN = /^\d{10}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
