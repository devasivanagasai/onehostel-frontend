export type ResidentStatus = 'Invited' | 'Active' | 'On Leave' | 'Checked Out' | 'Suspended';

export const RESIDENT_STATUSES: ResidentStatus[] = ['Invited', 'Active', 'On Leave', 'Checked Out', 'Suspended'];

/** Statuses an admin may set by hand while editing. Invited → Active happens when the resident activates their account. */
export const EDITABLE_STATUSES: ResidentStatus[] = ['Active', 'On Leave', 'Suspended'];

/** Configured resident categories (hostel settings). */
export const RESIDENT_TYPES = ['Regular', 'College Student', 'Working Professional'] as const;
export type ResidentType = (typeof RESIDENT_TYPES)[number];

/** Configured gender values; used together with room gender restrictions. */
export const RESIDENT_GENDERS = ['Male', 'Female', 'Other'] as const;
export type ResidentGender = (typeof RESIDENT_GENDERS)[number];

export const DOCUMENT_TYPES = ['Aadhaar Card', 'PAN Card', 'Passport', 'College ID', 'Employee ID', 'Driving Licence'] as const;
export type ResidentDocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentStatus = 'Pending' | 'Verified' | 'Rejected';

export const GUARDIAN_RELATIONSHIPS = ['Father', 'Mother', 'Guardian', 'Spouse', 'Sibling', 'Other'];

/** Photo upload limits. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface ResidentDocument {
  id: string;
  type: ResidentDocumentType;
  fileName: string;
  status: DocumentStatus;
  /** ISO date. */
  uploadedAt: string;
}

export interface ResidentGuardian {
  name: string;
  relationship: string;
  mobile: string;
  consent: boolean;
}

/** One entry of the resident's activity history (newest first). */
export interface ResidentActivity {
  /** ISO date-time. */
  at: string;
  action: string;
  details?: string;
  icon: string;
}

/**
 * A resident of this hostel (Section 4.2).
 * The current Room / Bed is not stored here: it is read from the bed allocation
 * records in RoomsService so the two screens can never disagree.
 */
export interface HostelResident {
  /** Unique, system-generated, e.g. RES000001. */
  residentId: string;
  firstName: string;
  lastName: string;
  /** ISO date. */
  dateOfBirth?: string;
  gender: ResidentGender;
  /** 10-digit number without country code. */
  mobile: string;
  mobileCode: string;
  email?: string;
  /** Data URL or remote URL. */
  photoUrl?: string;
  permanentAddress?: string;
  emergencyContactName?: string;
  emergencyContactMobile?: string;
  guardian?: ResidentGuardian;
  residentType: ResidentType;
  collegeOrCompany?: string;
  /** ISO date. */
  joiningDate: string;
  /** ISO date; on/after joiningDate. */
  expectedCheckoutDate?: string;
  /** ISO date; set on check-out. */
  checkOutDate?: string;
  status: ResidentStatus;
  /** Unpaid charges in the hostel currency. */
  outstandingBalance: number;
  documents: ResidentDocument[];
  notes?: string;
  /** ISO date-time of the last activation invite. */
  inviteSentAt?: string;
  /** ISO date-time; soft deactivation, history is kept. */
  deactivatedAt?: string;
  createdAt: string;
  updatedAt: string;
  activity: ResidentActivity[];
}

/** Form payload for Add / Edit. System fields are filled by the service. */
export type ResidentInput = Omit<
  HostelResident,
  'residentId' | 'status' | 'outstandingBalance' | 'createdAt' | 'updatedAt' | 'activity' | 'checkOutDate' | 'inviteSentAt' | 'deactivatedAt'
> & { status?: ResidentStatus };

export interface ResidentFilterState {
  search: string;
  status: string;
  type: string;
  joined: string;
  showDeactivated: boolean;
}

export const residentFullName = (r: Pick<HostelResident, 'firstName' | 'lastName'>): string =>
  `${r.firstName} ${r.lastName}`.trim();

/** "+91 98877 66554" — the format bed allocation records use for contacts. */
export const formatMobile = (code: string, mobile: string): string =>
  mobile.length === 10 ? `${code} ${mobile.slice(0, 5)} ${mobile.slice(5)}` : `${code} ${mobile}`;
