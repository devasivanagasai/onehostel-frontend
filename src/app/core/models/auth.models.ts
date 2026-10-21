import { HttpErrorResponse } from '@angular/common/http';

export interface LoginRequest {
  /** What the user typed in the login field: an email, mobile number or username. */
  identifier: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** App roles the UI checks: 'Admin', 'HostelOwner', 'Tenant'. */
  roles?: string[];
  /** Raw backend roles from the access token, e.g. 'SUPER_ADMIN', 'HOSTEL_OWNER'. */
  backendRoles?: string[];
  /** Keycloak username (preferred_username). */
  username?: string;
  organizationId?: string;
  /** Profile photo as a data URL, when one has been uploaded. */
  avatarUrl?: string;
}

export interface LoginResponse {
  token: string;
  /** Keycloak refresh token; sent to /auth/refresh-token and /auth/logout. */
  refreshToken?: string;
  /** Seconds the access token / refresh token stay valid (expires_in / refresh_expires_in). */
  expiresIn?: number;
  refreshExpiresIn?: number;
  user: AuthUser;
}

/** Envelope every backend endpoint replies with (CommonResponseObject in oh-access-core). */
export interface CommonResponseObject<T> {
  success: boolean;
  message?: string;
  responseObject?: T;
  statusCode: number;
  errorCode?: string;
  errors?: { field: string; message: string }[];
  correlationId?: string;
  timestamp?: string;
}

/** Shorter name used across the services. */
export type ApiResponse<T> = CommonResponseObject<T>;

/** Origin of a request (ClientSource in oh-access-core). */
export type ClientSource = 'WEB' | 'MOBILE_ANDROID' | 'MOBILE_IOS';

/** Envelope every backend endpoint takes (CommonRequestObject in oh-access-core). */
export interface CommonRequestObject<T> {
  requestObject: T;
  requestId?: string;
  clientSource?: ClientSource;
  appVersion?: string;
  locale?: string;
  /** ISO instant. */
  requestedAt?: string;
  page?: number;
  size?: number;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
  paginationRequired?: boolean;
}

/** requestObject of POST /auth/login. `identifier` is an email, mobile number or username. */
export interface LoginCredentials {
  identifier: string;
  password: string;
}

/** What a one-time code from POST /auth/otp/send is for; a code only works for its own purpose. */
export type OtpPurpose = 'LOGIN' | 'FORGOT_PASSWORD';

/** The claims of a Keycloak access token issued by oh-auth-gtwy. */
export interface AccessTokenClaims {
  sub: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
  iat?: number;
  preferred_username?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  /** Backend roles, e.g. ['HOSTEL_OWNER']. */
  roles?: string[];
  organization_id?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] } | undefined>;
}

/** The signed-in user as read from the access token. */
export interface JwtUserPayload {
  userId: string;
  username: string;
  email: string;
  name: string;
  /** Backend roles, e.g. 'SUPER_ADMIN', 'HOSTEL_OWNER'. */
  roles: string[];
  organizationId?: string;
  /** Expiry, milliseconds since the epoch. */
  expiresAt: number;
}

/** Body of POST /auth/login and /auth/refresh-token (KeycloakTokenResponse). */
export interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
  id_token?: string;
  session_state?: string;
  scope?: string;
}

/** How the gateway sent a code: by email to an email address, by SMS to a mobile number. */
export type OtpChannel = 'SMS' | 'EMAIL';

/**
 * True when POST /auth/otp/send found no account for the identifier (404 ENTITY_NOT_FOUND):
 * shown on the identifier field.
 */
export function isUnknownAccount(error: HttpErrorResponse): boolean {
  return error.status === 404 && error.error?.errorCode === 'ENTITY_NOT_FOUND';
}

/** Reply of POST /auth/otp/send. */
export interface OtpSendResult {
  expiresInSeconds: number;
  channel?: OtpChannel;
}

/** Backend roles allowed to use the web portal. Everyone else uses the mobile app. */
export const WEB_ROLES = ['SUPER_ADMIN', 'HOSTEL_OWNER', 'HOSTEL_MANAGER'] as const;
export type WebRole = (typeof WEB_ROLES)[number];

/** Shown when a mobile-app-only role (tenant, security guard) signs in on the web. */
export const MOBILE_APP_ONLY_MESSAGE = 'Please log in using the OneHostel Mobile App.';

/** An email address, or a mobile number (10 digits starting with 6-9, optionally with +91 / 0, spaces or dashes). */
export const EMAIL_OR_PHONE = /^([^\s@]+@[^\s@]+\.[^\s@]+|(\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5})$/;

export function isEmail(identifier: string): boolean {
  return identifier.includes('@');
}

/**
 * The identifier as the gateway expects it: emails trimmed, mobile numbers as their
 * 10 digits ("+91 90000-00001" → "9000000001").
 */
export function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (isEmail(value)) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Login error codes with special handling: LOCKED from mock sign-in, ACCOUNT_LOCKED (423) from the gateway,
 * when Maximum Login Attempts was reached.
 */
export type LoginErrorCode = 'LOCKED' | 'ACCOUNT_LOCKED' | 'MOBILE_APP_ONLY';

/**
 * True when the gateway has no such endpoint yet (404, errorCode ROUTE_NOT_FOUND), so the
 * feature (OTP sign-in, password reset) should read as "not available yet" rather than as a failure.
 */
export function isFeatureUnavailable(error: HttpErrorResponse): boolean {
  return error.status === 404 && error.error?.errorCode === 'ROUTE_NOT_FOUND';
}

/**
 * What to tell the user about a failed auth call, from the gateway's CommonResponseObject:
 * the first field error of a VALIDATION_FAILED reply, otherwise its `message`.
 */
export function apiErrorMessage(
  error: HttpErrorResponse,
  options: { fallback: string; unavailable?: string },
): string {
  if (error.status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (isFeatureUnavailable(error)) return options.unavailable ?? 'This feature is not available yet.';
  const body = error.error as Partial<CommonResponseObject<unknown>> | null;
  if (error.status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return body?.errors?.[0]?.message || body?.message || options.fallback;
}

/** Why the user was signed out, shown on the login page. */
export type LogoutReason = 'timeout' | 'expired' | 'mobile-app';
