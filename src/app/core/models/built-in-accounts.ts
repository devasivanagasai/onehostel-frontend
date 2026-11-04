import type { HostelAdminAccount } from '../services/hostel-admin-account.service';

/**
 * Fixed sign-ins for this UI-only build (no backend yet), one per role.
 * All start with the same password; Change Password replaces it per account.
 *
 *   Admin        → admin@gmail.com       / Password@123
 *   Hostel Owner → hostelowner@gmail.com / Password@123
 *   Tenant       → tenant@gmail.com      / Password@123
 */
export const BUILT_IN_PASSWORD = 'Password@123';

/** Same key AccountService uses for passwords changed on the Change Password screen. */
const PASSWORD_KEY = 'onehostel_pw_';

export type BuiltInRole = 'Admin' | 'Tenant';

export interface BuiltInAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BuiltInRole;
}

/** Admin and Tenant sign-ins. (The Hostel Owner is a hostel owner account — see BUILT_IN_HOSTEL_OWNER.) */
export const BUILT_IN_ACCOUNTS: BuiltInAccount[] = [
  { id: 'builtin-admin', email: 'admin@gmail.com', firstName: 'Admin', lastName: 'User', role: 'Admin' },
  { id: 'builtin-tenant', email: 'tenant@gmail.com', firstName: 'Tenant', lastName: 'User', role: 'Tenant' },
];

/** The Hostel Owner sign-in: a regular hostel owner login, so lockout, password rules and Change Password all apply. */
export const BUILT_IN_HOSTEL_OWNER: HostelAdminAccount = {
  hostelId: 'HST-OWNER-01',
  hostelName: 'Grand Stay Hostel',
  name: 'Hostel Owner',
  email: 'hostelowner@gmail.com',
  mobileNumber: '9000000001',
  username: 'hostelowner',
  password: BUILT_IN_PASSWORD,
};

export function findBuiltInAccount(identifier: string): BuiltInAccount | null {
  const typed = identifier.trim().toLowerCase();
  return BUILT_IN_ACCOUNTS.find((a) => a.email === typed) ?? null;
}

export function builtInAccountById(id: string): BuiltInAccount | null {
  return BUILT_IN_ACCOUNTS.find((a) => a.id === id) ?? null;
}

/** The account's current password: the one set on Change Password, or the starting one. */
export function builtInPassword(account: BuiltInAccount): string {
  try {
    return localStorage.getItem(PASSWORD_KEY + account.id) ?? BUILT_IN_PASSWORD;
  } catch {
    return BUILT_IN_PASSWORD;
  }
}
