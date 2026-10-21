// Basic Reports for the Hostel Owner (Section 4.7).

export type HostelReportKey = 'residents' | 'occupancy' | 'collection' | 'dues' | 'complaints';

/** The owner's hostel; every report is scoped to it. */
export const OWNER_HOSTEL = { id: 'HST-OWNER-01', name: 'Grand Stay Hostel' } as const;

export interface HostelReportTab {
  key: HostelReportKey;
  label: string;
  icon: string;
  /** Search box placeholder. */
  searchHint: string;
  /** What the period filter applies to, when the report has one. */
  periodLabel?: string;
  emptyIcon: string;
}

export const HOSTEL_REPORT_TABS: HostelReportTab[] = [
  { key: 'residents', label: 'Resident Register', icon: 'groups', searchHint: 'Search ID, name or mobile', periodLabel: 'Joined', emptyIcon: 'group_off' },
  { key: 'occupancy', label: 'Room & Bed Occupancy', icon: 'bed', searchHint: 'Search room number', emptyIcon: 'bed' },
  { key: 'collection', label: 'Fees Collection', icon: 'payments', searchHint: 'Search receipt, resident or collector', periodLabel: 'Paid', emptyIcon: 'receipt_long' },
  { key: 'dues', label: 'Outstanding Dues', icon: 'pending_actions', searchHint: 'Search resident or charge', emptyIcon: 'task_alt' },
  { key: 'complaints', label: 'Complaints', icon: 'support_agent', searchHint: 'Search ID, title or resident', periodLabel: 'Created', emptyIcon: 'task_alt' },
];

export interface FilterOption {
  value: string;
  label: string;
}

/** A select filter. The first option is the default; a value of 'All' means "not filtered". */
export interface ReportFilterDef {
  key: string;
  /** Used on the applied-filter chip, e.g. "Status: Active". */
  label: string;
  options: FilterOption[];
}

/** Key of the date-preset filter; 'custom' adds From / To date inputs. */
export const PERIOD_KEY = 'period';

export const PERIOD_OPTIONS: FilterOption[] = [
  { value: 'All', label: 'Any date' },
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

/** A table column. Secondary info goes in `sub` (second line) so columns fit without scrolling. */
export interface ReportColumn<T = any> {
  key: string;
  header: string;
  text: (row: T) => string | number;
  sub?: (row: T) => string;
  /** Renders the text as a status pill with this tone (shared status-badge tones). */
  badge?: (row: T) => string;
  /** Right-aligned number / amount. */
  numeric?: boolean;
  /** Bold primary line. */
  strong?: boolean;
}

/** A column in the exported file. `money` values are raw numbers in CSV and formatted in PDF. */
export interface ReportExportColumn<T = any> {
  header: string;
  value: (row: T) => string | number;
  money?: boolean;
  numeric?: boolean;
}

export interface ReportKpi {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  tone: 'teal' | 'blue' | 'indigo' | 'green' | 'orange';
}

export interface ReportResult<T = any> {
  rows: T[];
  columns: ReportColumn<T>[];
  /** Footer cell per column key, computed from all filtered rows (not just the page). */
  footer: Record<string, string>;
  kpis: ReportKpi[];
  exportColumns: ReportExportColumn<T>[];
  /** One cell per export column. */
  exportTotals: (string | number)[];
}

export interface DateRange {
  from?: string;
  to?: string;
}

/** Local calendar day as yyyy-MM-dd. */
export const isoDay = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Turns a date preset (or custom From / To) into an inclusive yyyy-MM-dd range. */
export function periodRange(preset: string, from?: string, to?: string): DateRange {
  const today = new Date();
  switch (preset) {
    case 'month':
      return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    case '30':
    case '90': {
      const d = new Date(today);
      d.setDate(d.getDate() - Number(preset));
      return { from: isoDay(d), to: isoDay(today) };
    }
    case 'year':
      return { from: `${today.getFullYear()}-01-01`, to: isoDay(today) };
    case 'custom':
      return { from: from || undefined, to: to || undefined };
    default:
      return {};
  }
}

/** True when the yyyy-MM-dd day falls inside the range (open ends allowed). */
export const inRange = (day: string, r: DateRange): boolean => (!r.from || day >= r.from) && (!r.to || day <= r.to);

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** "45m", "5h 20m", "2d 4h". */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
