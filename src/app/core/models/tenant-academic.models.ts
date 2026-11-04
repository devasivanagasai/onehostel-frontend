/** Academic details a college hostel office supplies for a Tenant (FRD 7.2). Read-only for the Tenant. */
export interface TenantAcademicDocument {
  id: string;
  name: string;
  /** e.g. "Bonafide certificate". Name only; no file content is stored. */
  kind: string;
  /** yyyy-mm-dd */
  sharedAt: string;
}

export interface TenantAcademicInfo {
  residentId: string;
  /** Student ID / roll number. */
  rollNumber: string;
  institution: string;
  department: string;
  course: string;
  /** 1-8 */
  year: number;
  /** 1-12 */
  semester: number;
  /** e.g. 2026–2027 */
  academicYear: string;
  classSection: string;
  /** Read-only note on hostel eligibility for the current academic year. */
  hostelEligibility: string;
  documents: TenantAcademicDocument[];
  updatedAt: string;
  suppliedBy: string;
}

/** What the owner supplies; the service fills the rest. */
export type TenantAcademicInput = Omit<TenantAcademicInfo, 'residentId' | 'updatedAt' | 'suppliedBy' | 'documents'> & { documents?: TenantAcademicDocument[] };

export const ROLL_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-/]{3,19}$/;
export const ACADEMIC_YEAR_PATTERN = /^\d{4}\s*[-–—]\s*\d{4}$/;
