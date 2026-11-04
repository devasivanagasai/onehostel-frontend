import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AcademicYearsService } from './academic-years.service';
import { AuthService } from './auth.service';
import { ResidentsService } from './residents.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { ACADEMIC_YEAR_PATTERN, ROLL_NUMBER_PATTERN, TenantAcademicInfo, TenantAcademicInput } from '../models/tenant-academic.models';
import { localDateIso } from '../../shared/utils/local-date';

const STORAGE_KEY = 'onehostel_tenant_academic_v1';

export interface TenantAcademicView {
  info: TenantAcademicInfo | undefined;
  /** Set when the supplied academic year differs from the hostel's active academic year. */
  yearNote: string;
  activeYearName: string;
  /** Whether the hostel has assigned you to its active academic year (read-only). */
  assignedToActiveYear: boolean;
}

const normaliseYear = (s: string): string => s.replace(/\s*[-–—]\s*/, '–').trim();

function seed(): TenantAcademicInfo[] {
  const docs = (id: string) => [
    { id: `${id}-D1`, name: 'Bonafide certificate 2026-27.pdf', kind: 'Bonafide certificate', sharedAt: '2026-08-05' },
    { id: `${id}-D2`, name: 'Course fee receipt.pdf', kind: 'Fee receipt', sharedAt: '2026-08-05' },
  ];
  const row = (residentId: string, rollNumber: string, department: string, course: string, year: number, semester: number, classSection: string, institution = 'City Institute of Technology'): TenantAcademicInfo => ({
    residentId,
    rollNumber,
    institution,
    department,
    course,
    year,
    semester,
    academicYear: '2026–2027',
    classSection,
    hostelEligibility: 'Eligible for hostel accommodation for the 2026–2027 academic year.',
    documents: docs(residentId),
    updatedAt: '2026-08-05T10:00:00',
    suppliedBy: 'Hostel office',
  });
  return [
    row('RES000001', 'CIT/22/CS/041', 'Computer Science & Engineering', 'B.Tech', 3, 5, 'CSE-B'),
    row('RES000002', 'CIT/23/EC/017', 'Electronics & Communication', 'B.Tech', 2, 3, 'ECE-A'),
    row('RES000003', 'CIT/21/ME/008', 'Mechanical Engineering', 'B.Tech', 4, 7, 'ME-A'),
  ];
}

/**
 * Academic information a college hostel supplies for each resident (FRD 7.2). The Tenant can only read
 * their own record; `setAcademicInfo` is the owner-side write. It is not the official academic record.
 */
@Injectable({ providedIn: 'root' })
export class TenantAcademicService {
  private readonly tenant = inject(TenantContextService);
  private readonly years = inject(AcademicYearsService);
  private readonly residents = inject(ResidentsService);
  private readonly notices = inject(TenantNotificationService);
  private readonly auth = inject(AuthService);
  private readonly subject = new BehaviorSubject<TenantAcademicInfo[]>(this.load());

  readonly disclaimer = 'This information is supplied by your college / hostel office. It is not the official academic record of your institution.';

  /** The signed-in Tenant's academic view (read-only). */
  readonly mine$: Observable<TenantAcademicView> = combineLatest([this.subject, this.years.years$]).pipe(map(() => this.mine));

  get mine(): TenantAcademicView {
    const me = this.tenant.residentId;
    const info = me ? this.subject.value.find((i) => i.residentId === me) : undefined;
    const active = this.years.activeYear();
    const activeYearName = active?.name ?? '';
    let yearNote = '';
    if (info && active && normaliseYear(info.academicYear) !== normaliseYear(active.name)) {
      yearNote = `Your supplied academic year (${info.academicYear}) differs from the hostel's active academic year (${active.name}). Ask the hostel office to confirm.`;
    }
    return { info: info ? this.copy(info) : undefined, yearNote, activeYearName, assignedToActiveYear: !!(me && active && active.residentIds.includes(me)) };
  }

  /** Owner side: first problem with the input, or '' when it can be saved. */
  validate(input: TenantAcademicInput): string {
    if (!input.rollNumber?.trim() || !ROLL_NUMBER_PATTERN.test(input.rollNumber.trim())) return 'Roll number must be 4-20 letters, digits, "-" or "/".';
    if (!input.institution?.trim()) return 'Institution is required.';
    if (!input.department?.trim()) return 'Department is required.';
    if (!input.course?.trim()) return 'Course is required.';
    if (!Number.isInteger(input.year) || input.year < 1 || input.year > 8) return 'Year must be a whole number from 1 to 8.';
    if (!Number.isInteger(input.semester) || input.semester < 1 || input.semester > 12) return 'Semester must be a whole number from 1 to 12.';
    if (!ACADEMIC_YEAR_PATTERN.test(input.academicYear ?? '')) return 'Academic year must look like 2026–2027.';
    if (!input.classSection?.trim()) return 'Class / section is required.';
    return '';
  }

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.auth.isHostelOwner || this.auth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  /** Owner side: supply or replace one resident's academic information. */
  setAcademicInfo(residentId: string, input: TenantAcademicInput): TenantAcademicInfo {
    this.requireStaff();
    if (!this.residents.byId(residentId)) throw new Error('Resident not found.');
    const problem = this.validate(input);
    if (problem) throw new Error(problem);
    const existing = this.subject.value.find((i) => i.residentId === residentId);
    const now = new Date();
    const info: TenantAcademicInfo = {
      residentId,
      rollNumber: input.rollNumber.trim().toUpperCase(),
      institution: input.institution.trim(),
      department: input.department.trim(),
      course: input.course.trim(),
      year: input.year,
      semester: input.semester,
      academicYear: normaliseYear(input.academicYear),
      classSection: input.classSection.trim(),
      hostelEligibility: input.hostelEligibility?.trim() || existing?.hostelEligibility || 'Eligibility not stated.',
      documents: input.documents ?? existing?.documents ?? [],
      updatedAt: `${localDateIso(now)}T${now.toTimeString().slice(0, 8)}`,
      suppliedBy: this.auth.currentUser?.name ?? 'Hostel office',
    };
    this.save([...this.subject.value.filter((i) => i.residentId !== residentId), info]);
    this.notices.push(residentId, { category: 'Profile', title: 'Academic details updated', body: 'Your hostel office updated your academic information.', route: '/my/academic' });
    return info;
  }

  private copy(i: TenantAcademicInfo): TenantAcademicInfo {
    return { ...i, documents: i.documents.map((d) => ({ ...d })) };
  }

  private save(list: TenantAcademicInfo[]): void {
    this.subject.next(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* kept in memory */
    }
  }

  private load(): TenantAcademicInfo[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as TenantAcademicInfo[]) : null;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* use seed */
    }
    return seed();
  }
}
