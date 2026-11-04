export type AdminStatus = 'Active' | 'Inactive' | 'Locked';

export const ADMIN_STATUSES: AdminStatus[] = ['Active', 'Inactive', 'Locked'];

/** Platform roles: Admin (OneHostel member), Hostel Owner (onboarded hostel member), Tenant (onboarded tenant). */
export type AdminRole = 'Hostel Owner';

export const ADMIN_ROLES: AdminRole[] = ['Hostel Owner'];

export type LogoutType = 'Manual' | 'Session timeout' | 'Ended by SuperAdmin';

export interface LoginEvent {
  /** ISO date-time. */
  timestamp: string;
  ipAddress: string;
  device: string;
  status: 'Success' | 'Failed';
  reason?: string;
  /** ISO date-time the session ended; only for successful sign-ins. Undefined = still signed in. */
  logoutAt?: string;
  /** How the session ended. */
  logoutType?: LogoutType;
}

export interface HostelAdmin {
  adminId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobileCode: string;
  mobile: string;
  username: string;
  role: AdminRole;
  status: AdminStatus;
  hostelId: string;
  hostelName: string;
  /** ISO date. */
  createdDate: string;
  /** ISO date-time; undefined = has never logged in. */
  lastLogin?: string;
  /** ISO date-time; undefined = still on the temporary password issued at creation. */
  lastPasswordChange?: string;
  lockReason?: string;
  lockedAt?: string;
  loginHistory: LoginEvent[];
}

export const adminFullName = (a: Pick<HostelAdmin, 'firstName' | 'lastName'>): string =>
  `${a.firstName} ${a.lastName}`.trim();

const MASK_CHAR = 'X';

/** Never shows the full number: 98XXXXXX10. */
export const maskMobile = (mobile: string): string =>
  mobile.length <= 4 ? mobile : `${mobile.slice(0, 2)}${MASK_CHAR.repeat(mobile.length - 4)}${mobile.slice(-2)}`;

/** "ravi.kumar@gmail.com" → "raXXXXXXXX@gmail.com": keeps the first 2 characters and the domain. */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${MASK_CHAR.repeat(Math.max(1, local.length - visible.length))}${email.slice(at)}`;
};

export type LastLoginFilter = 'All' | '7d' | '30d' | 'over30d' | 'never';

export const LAST_LOGIN_FILTERS: { value: LastLoginFilter; label: string }[] = [
  { value: 'All', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'over30d', label: 'More than 30 days ago' },
  { value: 'never', label: 'Never logged in' },
];

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const DEVICES = ['Chrome · Windows', 'Safari · iPhone', 'Chrome · Android', 'Edge · Windows'];

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss) for a Date, matching the rest of the mock data. */
const localIso = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

/** Session lengths (minutes) and how each mock session ended, cycled per sign-in. */
const SESSIONS: { minutes: number; type: LogoutType }[] = [
  { minutes: 42, type: 'Manual' },
  { minutes: 95, type: 'Manual' },
  { minutes: 30, type: 'Session timeout' },
  { minutes: 67, type: 'Manual' },
  { minutes: 30, type: 'Session timeout' },
];

/** A few successful logins (each with its sign-out) leading up to `last`, newest first. */
function history(last: string | undefined, ip: string, deviceIndex = 0): LoginEvent[] {
  if (!last) return [];
  const base = new Date(last).getTime();
  return [0, 1, 3, 6, 9].map((daysBack, i) => {
    const d = new Date(base - daysBack * 86_400_000 - i * 37 * 60_000);
    const session = SESSIONS[i % SESSIONS.length];
    return {
      timestamp: localIso(d),
      ipAddress: ip,
      device: DEVICES[(deviceIndex + (i % 2)) % DEVICES.length],
      status: 'Success' as const,
      logoutAt: localIso(new Date(d.getTime() + session.minutes * 60_000)),
      logoutType: session.type,
    };
  });
}

/** Minutes between two local ISO date-times. */
export const sessionMinutes = (from: string, to: string): number =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));

/** 42 → "42 min", 95 → "1 h 35 min". */
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

export const MOCK_ADMINS: HostelAdmin[] = [
  {
    adminId: 'ADM01',
    firstName: 'Rakesh',
    lastName: 'Verma',
    email: 'rakesh.verma@grandstayhostel.com',
    mobileCode: '+91',
    mobile: '9876543210',
    username: 'rakesh.verma',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1001',
    hostelName: 'Grand Stay Hostel',
    createdDate: '2026-04-01',
    lastLogin: '2026-09-28T21:05:00',
    lastPasswordChange: '2026-07-15T10:20:00',
    loginHistory: history('2026-09-28T21:05:00', '49.36.112.18', 0),
  },
  {
    adminId: 'ADM02',
    firstName: 'Anish',
    lastName: 'Kumar',
    email: 'anish.kumar@royalpalmshostel.com',
    mobileCode: '+91',
    mobile: '9845012345',
    username: 'anish.kumar',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1002',
    hostelName: 'Royal Palms Luxury Hostel',
    createdDate: '2026-02-10',
    lastLogin: '2026-09-27T10:12:00',
    lastPasswordChange: '2026-08-01T09:00:00',
    loginHistory: history('2026-09-27T10:12:00', '106.51.73.40', 1),
  },
  {
    adminId: 'ADM03',
    firstName: 'Suresh',
    lastName: 'Raina',
    email: 'suresh.raina@citycenterpg.com',
    mobileCode: '+91',
    mobile: '9884098840',
    username: 'suresh.raina',
    role: 'Hostel Owner',
    status: 'Locked',
    hostelId: 'HST-1003',
    hostelName: 'City Center PG & Hostel',
    createdDate: '2026-03-01',
    lastLogin: '2026-09-20T09:30:00',
    lockReason: 'Locked automatically after 5 failed login attempts.',
    lockedAt: '2026-09-22T23:14:00',
    loginHistory: [
      ...[14, 12, 9, 6, 3].map((min, i) => ({
        timestamp: `2026-09-22T23:${String(min).padStart(2, '0')}:00`,
        ipAddress: '185.220.101.7',
        device: 'Firefox · Linux',
        status: 'Failed' as const,
        reason: i === 0 ? 'Invalid password — account locked' : 'Invalid password',
      })),
      ...history('2026-09-20T09:30:00', '117.221.40.9', 2),
    ],
  },
  {
    adminId: 'ADM04',
    firstName: 'Meera',
    lastName: 'Iyer',
    email: 'meera.iyer@greenvalley.edu.in',
    mobileCode: '+91',
    mobile: '9000011122',
    username: 'meera.iyer',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1004',
    hostelName: 'Green Valley Girls Hostel',
    createdDate: '2026-09-20',
    loginHistory: [],
  },
  {
    adminId: 'ADM05',
    firstName: 'Vikram',
    lastName: 'Joshi',
    email: 'vikram.joshi@lakeviewresidency.com',
    mobileCode: '+91',
    mobile: '9822012345',
    username: 'vikram.joshi',
    role: 'Hostel Owner',
    status: 'Inactive',
    hostelId: 'HST-1005',
    hostelName: 'Lakeview Residency',
    createdDate: '2026-06-01',
    lastLogin: '2026-07-30T18:45:00',
    lastPasswordChange: '2026-06-02T11:10:00',
    loginHistory: history('2026-07-30T18:45:00', '103.87.24.61', 3),
  },
  {
    adminId: 'ADM06',
    firstName: 'Rakesh',
    lastName: 'Sharma',
    email: 'admin@abc.com',
    mobileCode: '+91',
    mobile: '9123456780',
    username: 'admin123',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1006',
    hostelName: 'ABC Hostel',
    createdDate: '2026-09-15',
    lastLogin: '2026-09-17T14:45:00',
    lastPasswordChange: '2026-09-15T16:02:00',
    loginHistory: history('2026-09-17T14:45:00', '157.49.8.200', 0).slice(0, 2),
  },
  {
    adminId: 'ADM07',
    firstName: 'Farhan',
    lastName: 'Ali',
    email: 'farhan.ali@metrostaypg.in',
    mobileCode: '+91',
    mobile: '9900112233',
    username: 'farhan.ali',
    role: 'Hostel Owner',
    status: 'Inactive',
    hostelId: 'HST-1007',
    hostelName: 'Metro Stay PG',
    createdDate: '2025-11-01',
    lastLogin: '2026-09-26T12:00:00',
    lastPasswordChange: '2026-05-10T08:30:00',
    loginHistory: history('2026-09-26T12:00:00', '223.187.5.14', 1),
  },
  {
    adminId: 'ADM08',
    firstName: 'Kiran',
    lastName: 'Rao',
    email: 'kiran.rao@sunriseboys.edu.in',
    mobileCode: '+91',
    mobile: '9811122233',
    username: 'kiran.rao',
    role: 'Hostel Owner',
    status: 'Inactive',
    hostelId: 'HST-1008',
    hostelName: 'Sunrise Boys Hostel',
    createdDate: '2026-05-01',
    lastLogin: '2026-09-04T09:15:00',
    lastPasswordChange: '2026-05-01T12:00:00',
    loginHistory: history('2026-09-04T09:15:00', '42.106.11.90', 2),
  },
  {
    adminId: 'ADM09',
    firstName: 'Divya',
    lastName: 'Menon',
    email: 'divya.menon@grandstayhostel.com',
    mobileCode: '+91',
    mobile: '9745098765',
    username: 'divya.menon',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1001',
    hostelName: 'Grand Stay Hostel',
    createdDate: '2026-06-10',
    lastLogin: '2026-09-29T08:40:00',
    lastPasswordChange: '2026-09-01T10:00:00',
    loginHistory: history('2026-09-29T08:40:00', '49.36.112.22', 1),
  },
  {
    adminId: 'ADM10',
    firstName: 'Arjun',
    lastName: 'Reddy',
    email: 'arjun.reddy@royalpalmshostel.com',
    mobileCode: '+91',
    mobile: '9959012345',
    username: 'arjun.reddy',
    role: 'Hostel Owner',
    status: 'Active',
    hostelId: 'HST-1002',
    hostelName: 'Royal Palms Luxury Hostel',
    createdDate: '2026-03-18',
    lastLogin: '2026-08-12T17:25:00',
    lastPasswordChange: '2026-03-18T15:00:00',
    loginHistory: history('2026-08-12T17:25:00', '106.51.73.52', 3),
  },
];
