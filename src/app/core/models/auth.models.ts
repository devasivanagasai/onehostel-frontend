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
  roles?: string[];
  /** Profile photo as a data URL, when one has been uploaded. */
  avatarUrl?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** Sent in a login error body: LOCKED when Maximum Login Attempts was reached. */
export type LoginErrorCode = 'LOCKED';
