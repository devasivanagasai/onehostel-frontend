export type ReportKey = 'hostels' | 'residents' | 'occupancy' | 'subscriptions' | 'revenue';

export type HostelType = 'Regular Hostel' | 'College Hostel';

export const HOSTEL_TYPES: HostelType[] = ['Regular Hostel', 'College Hostel'];

export type HostelStatus = 'Active' | 'Inactive';

/**
 * Platform-level hostel master used by every report. Hostel names match the
 * Subscription & Payment module so subscription and revenue rows can be joined
 * to a hostel's city / type / plan for filtering.
 */
export interface ReportHostel {
  hostelId: string;
  hostelName: string;
  city: string;
  hostelType: HostelType;
  status: HostelStatus;
  plan: string;
  /** ISO date the hostel was onboarded. */
  onboardedDate: string;
  totalBeds: number;
  /** Residents currently staying; also the hostel's occupied bed count. */
  activeResidents: number;
  checkedOutResidents: number;
}

export const REPORT_HOSTELS: ReportHostel[] = [
  {
    hostelId: 'HST-1001',
    hostelName: 'Grand Stay Hostel',
    city: 'Hyderabad',
    hostelType: 'Regular Hostel',
    status: 'Active',
    plan: 'Premium',
    onboardedDate: '2026-04-01',
    totalBeds: 500,
    activeResidents: 412,
    checkedOutResidents: 96,
  },
  {
    hostelId: 'HST-1002',
    hostelName: 'Royal Palms Luxury Hostel',
    city: 'Bangalore',
    hostelType: 'Regular Hostel',
    status: 'Active',
    plan: 'Standard',
    onboardedDate: '2026-02-10',
    totalBeds: 220,
    activeResidents: 187,
    checkedOutResidents: 41,
  },
  {
    hostelId: 'HST-1003',
    hostelName: 'City Center PG & Hostel',
    city: 'Chennai',
    hostelType: 'College Hostel',
    status: 'Active',
    plan: 'Basic',
    onboardedDate: '2026-03-01',
    totalBeds: 180,
    activeResidents: 121,
    checkedOutResidents: 58,
  },
  {
    hostelId: 'HST-1004',
    hostelName: 'Green Valley Girls Hostel',
    city: 'Hyderabad',
    hostelType: 'College Hostel',
    status: 'Active',
    plan: 'Standard',
    onboardedDate: '2026-09-20',
    totalBeds: 120,
    activeResidents: 34,
    checkedOutResidents: 0,
  },
  {
    hostelId: 'HST-1005',
    hostelName: 'Lakeview Residency',
    city: 'Pune',
    hostelType: 'Regular Hostel',
    status: 'Inactive',
    plan: 'Basic',
    onboardedDate: '2026-06-01',
    totalBeds: 90,
    activeResidents: 0,
    checkedOutResidents: 72,
  },
  {
    hostelId: 'HST-1006',
    hostelName: 'ABC Hostel',
    city: 'Bangalore',
    hostelType: 'Regular Hostel',
    status: 'Active',
    plan: 'Standard',
    onboardedDate: '2026-08-01',
    totalBeds: 150,
    activeResidents: 118,
    checkedOutResidents: 19,
  },
  {
    hostelId: 'HST-1007',
    hostelName: 'Metro Stay PG',
    city: 'Chennai',
    hostelType: 'Regular Hostel',
    status: 'Inactive',
    plan: 'Premium',
    onboardedDate: '2025-11-01',
    totalBeds: 300,
    activeResidents: 0,
    checkedOutResidents: 244,
  },
  {
    hostelId: 'HST-1008',
    hostelName: 'Sunrise Boys Hostel',
    city: 'Pune',
    hostelType: 'College Hostel',
    status: 'Inactive',
    plan: 'Standard',
    onboardedDate: '2026-05-01',
    totalBeds: 160,
    activeResidents: 0,
    checkedOutResidents: 88,
  },
];

/** A column in an exportable report table. `value` returns what goes in the file. */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
  /** Right-align in PDF output. */
  numeric?: boolean;
}

export interface ExportTable<T = any> {
  title: string;
  /** Human-readable summary of the filters applied, printed under the title. */
  filterSummary: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Optional totals row, already formatted, one cell per column. */
  totals?: (string | number)[];
}
