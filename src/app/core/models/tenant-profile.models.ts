// Tenant profile (FRD 5.3): read-only identity, profile-update requests and the account status shown to the Tenant.

import { ResidentStatus } from './residents.models';

/** Fields a Tenant may ask to change. Everything else on the profile is Admin-controlled. */
export const PROFILE_REQUEST_FIELDS = ['name', 'mobile', 'email', 'emergencyContact', 'permanentAddress'] as const;
export type ProfileRequestField = (typeof PROFILE_REQUEST_FIELDS)[number];

export const PROFILE_FIELD_LABELS: Record<ProfileRequestField, string> = {
  name: 'Full name',
  mobile: 'Mobile number',
  email: 'Email address',
  emergencyContact: 'Emergency contact',
  permanentAddress: 'Permanent address',
};

/** Changing how the hostel reaches the Tenant needs a verification code sent to the new contact. */
export const FIELDS_NEEDING_VERIFICATION: ProfileRequestField[] = ['mobile', 'email'];

export type ProfileRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface TenantProfileRequest {
  /** e.g. PUR000001 */
  id: string;
  residentId: string;
  field: ProfileRequestField;
  /** Value at the time of the request, for display. */
  currentValue: string;
  /** Proposed value: the name, mobile, email, address, or the emergency contact's name. */
  proposedValue: string;
  /** Emergency contact only: the proposed contact's 10-digit mobile. */
  proposedValue2?: string;
  reason: string;
  /** Mobile / email: the new contact was verified with a code when the request was made. */
  needsVerification: boolean;
  verified: boolean;
  status: ProfileRequestStatus;
  /** Local date-time, yyyy-mm-ddTHH:mm:ss. */
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Hostel Owner's remark on Approve / Reject. */
  remark?: string;
}

export interface ProfileRequestInput {
  field: ProfileRequestField;
  proposedValue: string;
  proposedValue2?: string;
  reason: string;
  /** Code from `requestVerificationCode` (mobile / email only). */
  verificationCode?: string;
}

/** The Tenant-facing account status. */
export type TenantAccountStatus = 'Pending Activation' | 'Active' | 'Suspended' | 'Checked Out';

export const accountStatusFor = (status: ResidentStatus): TenantAccountStatus => {
  switch (status) {
    case 'Invited':
      return 'Pending Activation';
    case 'Suspended':
      return 'Suspended';
    case 'Checked Out':
      return 'Checked Out';
    default:
      return 'Active';
  }
};

export const PHOTO_ALLOWED_TYPES = ['image/jpeg', 'image/png'];
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const MOBILE_PATTERN = /^\d{10}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
