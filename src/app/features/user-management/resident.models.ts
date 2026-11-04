import { LoginEvent, LogoutType } from '../../core/models/admin.models';

export type ResidentStatus = 'Active' | 'Inactive' | 'Blocked';

export const RESIDENT_STATUSES: ResidentStatus[] = ['Active', 'Inactive', 'Blocked'];

export type Gender = 'Male' | 'Female';

/** A resident (end user) living in one of the onboarded hostels. */
export interface Resident {
  residentId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  email: string;
  mobileCode: string;
  mobile: string;
  hostelId: string;
  hostelName: string;
  roomNo: string;
  bedNo: string;
  /** ISO date. */
  checkInDate: string;
  /** ISO date; set once the resident has moved out. */
  checkOutDate?: string;
  status: ResidentStatus;
  /** Why the account was blocked (Blocked only). */
  blockReason?: string;
  /** ISO date-time. */
  blockedAt?: string;
  /** ISO date-time; undefined = has never used the resident app. */
  lastLogin?: string;
  guardianName: string;
  guardianMobile: string;
  /** Resident-app sign-ins, newest first. */
  loginHistory: LoginEvent[];
}

export const residentFullName = (r: Pick<Resident, 'firstName' | 'lastName'>): string =>
  `${r.firstName} ${r.lastName}`.trim();

/** How a resident appears in Audit Logs: "Aditya Sharma (RES01)" — the ID keeps same-name residents apart. */
export const residentAuditEntity = (r: Pick<Resident, 'firstName' | 'lastName' | 'residentId'>): string =>
  `${residentFullName(r)} (${r.residentId})`;

// ---------------------------------------------------------------------------
// Mock data (same hostels as the hostel admins)
// ---------------------------------------------------------------------------

const APP_DEVICES = ['OneHostel App · Android', 'OneHostel App · iPhone'];

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss) for a Date, matching the rest of the mock data. */
const localIso = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

const SESSIONS: { minutes: number; type: LogoutType }[] = [
  { minutes: 18, type: 'Manual' },
  { minutes: 30, type: 'Session timeout' },
  { minutes: 7, type: 'Manual' },
  { minutes: 25, type: 'Manual' },
];

/** A few resident-app sign-ins (each with its sign-out) leading up to `last`, newest first. */
function appHistory(last: string | undefined, ip: string, deviceIndex: number): LoginEvent[] {
  if (!last) return [];
  const base = new Date(last).getTime();
  return [0, 2, 4, 7].map((daysBack, i) => {
    const d = new Date(base - daysBack * 86_400_000 - i * 53 * 60_000);
    const session = SESSIONS[i % SESSIONS.length];
    return {
      timestamp: localIso(d),
      ipAddress: ip,
      device: APP_DEVICES[deviceIndex % APP_DEVICES.length],
      status: 'Success' as const,
      logoutAt: localIso(new Date(d.getTime() + session.minutes * 60_000)),
      logoutType: session.type,
    };
  });
}

type ResidentSeed = Omit<Resident, 'loginHistory'>;

const RESIDENT_SEED: ResidentSeed[] = [
  {
    residentId: 'RES01', firstName: 'Aditya', lastName: 'Sharma', gender: 'Male',
    email: 'aditya.sharma@gmail.com', mobileCode: '+91', mobile: '9812345670',
    hostelId: 'HST-1001', hostelName: 'Grand Stay Hostel', roomNo: '101', bedNo: 'A',
    checkInDate: '2026-04-05', status: 'Active', lastLogin: '2026-10-07T20:15:00',
    guardianName: 'Ramesh Sharma', guardianMobile: '9812300011',
  },
  {
    residentId: 'RES02', firstName: 'Priya', lastName: 'Nair', gender: 'Female',
    email: 'priya.nair@gmail.com', mobileCode: '+91', mobile: '9847012345',
    hostelId: 'HST-1004', hostelName: 'Green Valley Girls Hostel', roomNo: '204', bedNo: 'B',
    checkInDate: '2026-09-22', status: 'Active', lastLogin: '2026-10-08T09:40:00',
    guardianName: 'Suresh Nair', guardianMobile: '9847000022',
  },
  {
    residentId: 'RES03', firstName: 'Rohan', lastName: 'Gupta', gender: 'Male',
    email: 'rohan.gupta@outlook.com', mobileCode: '+91', mobile: '9900123456',
    hostelId: 'HST-1002', hostelName: 'Royal Palms Luxury Hostel', roomNo: '312', bedNo: 'A',
    checkInDate: '2026-02-15', status: 'Active', lastLogin: '2026-10-06T22:05:00',
    guardianName: 'Anil Gupta', guardianMobile: '9900100033',
  },
  {
    residentId: 'RES04', firstName: 'Sneha', lastName: 'Reddy', gender: 'Female',
    email: 'sneha.reddy@gmail.com', mobileCode: '+91', mobile: '9963012345',
    hostelId: 'HST-1004', hostelName: 'Green Valley Girls Hostel', roomNo: '118', bedNo: 'C',
    checkInDate: '2026-09-25', status: 'Active',
    guardianName: 'Venkat Reddy', guardianMobile: '9963000044',
  },
  {
    residentId: 'RES05', firstName: 'Karthik', lastName: 'Iyer', gender: 'Male',
    email: 'karthik.iyer@yahoo.com', mobileCode: '+91', mobile: '9884012345',
    hostelId: 'HST-1003', hostelName: 'City Center PG & Hostel', roomNo: '07', bedNo: 'B',
    checkInDate: '2026-03-10', status: 'Blocked', lastLogin: '2026-09-18T23:50:00',
    blockReason: 'Repeated violation of hostel rules (late entry).', blockedAt: '2026-09-19T10:30:00',
    guardianName: 'Mohan Iyer', guardianMobile: '9884000055',
  },
  {
    residentId: 'RES06', firstName: 'Ananya', lastName: 'Das', gender: 'Female',
    email: 'ananya.das@gmail.com', mobileCode: '+91', mobile: '9830012345',
    hostelId: 'HST-1001', hostelName: 'Grand Stay Hostel', roomNo: '215', bedNo: 'A',
    checkInDate: '2026-01-12', checkOutDate: '2026-08-31', status: 'Inactive', lastLogin: '2026-08-30T18:20:00',
    guardianName: 'Subrata Das', guardianMobile: '9830000066',
  },
  {
    residentId: 'RES07', firstName: 'Mohammed', lastName: 'Irfan', gender: 'Male',
    email: 'm.irfan@gmail.com', mobileCode: '+91', mobile: '9700012345',
    hostelId: 'HST-1007', hostelName: 'Metro Stay PG', roomNo: '05', bedNo: 'A',
    checkInDate: '2025-11-20', status: 'Active', lastLogin: '2026-10-08T07:55:00',
    guardianName: 'Abdul Rahman', guardianMobile: '9700000077',
  },
  {
    residentId: 'RES08', firstName: 'Lakshmi', lastName: 'Menon', gender: 'Female',
    email: 'lakshmi.menon@gmail.com', mobileCode: '+91', mobile: '9745012345',
    hostelId: 'HST-1004', hostelName: 'Green Valley Girls Hostel', roomNo: '204', bedNo: 'A',
    checkInDate: '2026-09-21', status: 'Active', lastLogin: '2026-10-05T21:10:00',
    guardianName: 'Gopal Menon', guardianMobile: '9745000088',
  },
  {
    residentId: 'RES09', firstName: 'Vivek', lastName: 'Patel', gender: 'Male',
    email: 'vivek.patel@gmail.com', mobileCode: '+91', mobile: '9825012345',
    hostelId: 'HST-1005', hostelName: 'Lakeview Residency', roomNo: '402', bedNo: 'B',
    checkInDate: '2026-06-05', checkOutDate: '2026-07-31', status: 'Inactive', lastLogin: '2026-07-29T19:00:00',
    guardianName: 'Harish Patel', guardianMobile: '9825000099',
  },
  {
    residentId: 'RES10', firstName: 'Neha', lastName: 'Singh', gender: 'Female',
    email: 'neha.singh@gmail.com', mobileCode: '+91', mobile: '9811012345',
    hostelId: 'HST-1002', hostelName: 'Royal Palms Luxury Hostel', roomNo: '118', bedNo: 'A',
    checkInDate: '2026-03-01', status: 'Active', lastLogin: '2026-10-07T13:30:00',
    guardianName: 'Rajesh Singh', guardianMobile: '9811000010',
  },
  {
    residentId: 'RES11', firstName: 'Arun', lastName: 'Kumar', gender: 'Male',
    email: 'arun.kumar@gmail.com', mobileCode: '+91', mobile: '9940012345',
    hostelId: 'HST-1008', hostelName: 'Sunrise Boys Hostel', roomNo: '23', bedNo: 'C',
    checkInDate: '2026-05-10', status: 'Blocked', lastLogin: '2026-09-02T16:45:00',
    blockReason: 'Hostel fee unpaid for 2 months.', blockedAt: '2026-09-05T11:00:00',
    guardianName: 'Senthil Kumar', guardianMobile: '9940000011',
  },
  {
    residentId: 'RES12', firstName: 'Pooja', lastName: 'Verma', gender: 'Female',
    email: 'pooja.verma@gmail.com', mobileCode: '+91', mobile: '9876012345',
    hostelId: 'HST-1006', hostelName: 'ABC Hostel', roomNo: '11', bedNo: 'B',
    checkInDate: '2026-09-16', status: 'Active',
    guardianName: 'Sanjay Verma', guardianMobile: '9876000012',
  },
  {
    residentId: 'RES13', firstName: 'Siddharth', lastName: 'Rao', gender: 'Male',
    email: 'siddharth.rao@gmail.com', mobileCode: '+91', mobile: '9845098765',
    hostelId: 'HST-1001', hostelName: 'Grand Stay Hostel', roomNo: '101', bedNo: 'B',
    checkInDate: '2026-04-08', status: 'Active', lastLogin: '2026-10-08T11:25:00',
    guardianName: 'Prakash Rao', guardianMobile: '9845000013',
  },
  {
    residentId: 'RES14', firstName: 'Fatima', lastName: 'Sheikh', gender: 'Female',
    email: 'fatima.sheikh@gmail.com', mobileCode: '+91', mobile: '9920012345',
    hostelId: 'HST-1007', hostelName: 'Metro Stay PG', roomNo: '09', bedNo: 'A',
    checkInDate: '2026-02-01', status: 'Active', lastLogin: '2026-09-30T08:05:00',
    guardianName: 'Yusuf Sheikh', guardianMobile: '9920000014',
  },
];

/** Blocked residents also show the failed sign-ins made after the block. */
const blockedAttempts = (r: ResidentSeed): LoginEvent[] =>
  r.status === 'Blocked' && r.blockedAt
    ? [1, 2].map((h) => ({
        timestamp: localIso(new Date(new Date(r.blockedAt!).getTime() + h * 3_600_000)),
        ipAddress: '49.205.33.' + (10 + h),
        device: APP_DEVICES[h % 2],
        status: 'Failed' as const,
        reason: 'Account blocked',
      }))
    : [];

export const MOCK_RESIDENTS: Resident[] = RESIDENT_SEED.map((r, i) => ({
  ...r,
  loginHistory: [...blockedAttempts(r), ...appHistory(r.lastLogin, '106.200.' + (20 + i) + '.' + (100 + i), i)].sort((x, y) =>
    y.timestamp.localeCompare(x.timestamp),
  ),
}));
