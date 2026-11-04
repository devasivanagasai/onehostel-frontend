export interface HostelOnboardingRow {
  hostelId: string;
  hostelName: string;
  city: string;
  contactPerson: string;
  mobileNumber: string;
  /** Draft = onboarding saved but not finished. */
  status: 'Active' | 'Draft';
  createdDate: string;
}

/**
 * Hostels onboarded on the platform (the Onboard Hostel list).
 * Shared so other screens (e.g. Admin Management) only show users of these hostels.
 */
export const ONBOARDED_HOSTELS: HostelOnboardingRow[] = [
  {
    hostelId: 'HST-1001',
    hostelName: 'Grand Stay Hostel',
    city: 'Hyderabad',
    contactPerson: 'Rakesh Verma',
    mobileNumber: '9876543210',
    status: 'Active',
    createdDate: '2026-09-18',
  },
  {
    hostelId: 'HST-1002',
    hostelName: 'Royal Palms Luxury Hostel',
    city: 'Bangalore',
    contactPerson: 'Anish Kumar',
    mobileNumber: '9123456789',
    status: 'Draft',
    createdDate: '2026-09-17',
  },
  {
    hostelId: 'HST-1003',
    hostelName: 'City Center PG & Hostel',
    city: 'Chennai',
    contactPerson: 'Suresh Raina',
    mobileNumber: '9988776655',
    status: 'Active',
    createdDate: '2026-09-15',
  },
];

/** True when the hostel appears in the Onboard Hostel list. */
export const isOnboardedHostel = (hostelId: string): boolean =>
  ONBOARDED_HOSTELS.some((h) => h.hostelId === hostelId);
