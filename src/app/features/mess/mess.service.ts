import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { FeesService } from '../fees-payments/fees.service';
import { ResidentsService } from '../residents/residents.service';
import { HostelResident, residentFullName } from '../residents/residents.models';
import {
  AttendanceMark,
  DietaryAccess,
  MEAL_TIMES,
  MEAL_TYPES,
  MealPlan,
  MealProfile,
  MealType,
  MenuInput,
  MenuStatus,
  MessBilling,
  MessMenu,
  MessNotice,
  MessSettings,
  PLAN_MEALS,
  addDays,
  clock,
  localIso,
  monthOffset,
  periodLabel,
  todayStr,
  weekDates,
  weekStart,
} from './mess.models';

// Audit: AUDIT_EVENTS has no mess events, so menu changes, notifications and dietary-note access are
// logged in this service. Pay-per-meal charges are audited by FeesService ("Create Charge").

const STORAGE_KEY = 'onehostel_mess_v1';
export const HOSTEL_ID = 'HST-OWNER-01';

const CHARGE_DUE_DAYS = 10;

interface MessState {
  settings: MessSettings;
  menus: MessMenu[];
  profiles: MealProfile[];
  /** `${date}|${meal}` → residentId → mark */
  attendance: Record<string, Record<string, AttendanceMark>>;
  dietaryLog: DietaryAccess[];
  notices: MessNotice[];
  billing: MessBilling[];
}

export interface BillingPreviewRow {
  residentId: string;
  residentName: string;
  meals: number;
  amount: number;
  /** Set when this resident + period is already billed. */
  chargeId?: string;
}

/** Plans covered by the monthly Mess fee in Fees & Payments. */
const MONTHLY_PLANS: MealPlan[] = ['Full Board', 'Breakfast & Dinner'];

/** Reference written into each pay-per-meal charge; used to detect an existing charge. */
export const billingRef = (period: string, residentId: string): string => `MESS-${period}-${residentId}`;

const attKey = (date: string, meal: MealType): string => `${date}|${meal}`;

@Injectable({ providedIn: 'root' })
export class MessService {
  private readonly residents = inject(ResidentsService);
  private readonly fees = inject(FeesService);
  private readonly auth = inject(AuthService);

  private readonly state = new BehaviorSubject<MessState>(this.load());
  readonly state$ = this.state.asObservable();

  constructor() {
    this.syncMessFee();
  }

  get settings(): MessSettings {
    return this.state.value.settings;
  }

  get menus(): MessMenu[] {
    return this.state.value.menus;
  }

  get notices(): MessNotice[] {
    return this.state.value.notices;
  }

  get billing(): MessBilling[] {
    return this.state.value.billing;
  }

  updateSettings(patch: Partial<MessSettings>): void {
    this.commit({ settings: { ...this.settings, ...patch } });
  }

  // ---- Residents & plans ----------------------------------------------------------

  /** Current residents (Active / On Leave, not deactivated). */
  get currentResidents(): HostelResident[] {
    return this.residents.residents.filter((r) => !r.deactivatedAt && (r.status === 'Active' || r.status === 'On Leave'));
  }

  roomOf(residentId: string): string {
    const alloc = this.residents.allocationFor(residentId);
    return alloc ? this.residents.describe(alloc) : 'No bed';
  }

  profile(residentId: string): MealProfile {
    return this.state.value.profiles.find((p) => p.residentId === residentId) ?? { residentId, plan: 'Full Board' };
  }

  /** Current residents on any mess plan — the audience for menu notifications. */
  get messResidents(): HostelResident[] {
    return this.currentResidents.filter((r) => this.profile(r.residentId).plan !== 'No Mess');
  }

  /** Residents expected at a meal (plan covers it). */
  expectedAt(meal: MealType): HostelResident[] {
    return this.currentResidents.filter((r) => PLAN_MEALS[this.profile(r.residentId).plan].includes(meal));
  }

  /** Changes plan / dietary note. A note change is logged as an access. */
  saveProfile(residentId: string, plan: MealPlan, dietaryNote: string): void {
    const prev = this.profile(residentId);
    const note = dietaryNote.trim() || undefined;
    const noteChanged = note !== prev.dietaryNote;
    const next: MealProfile = { ...prev, plan, dietaryNote: note, noteUpdatedAt: noteChanged ? localIso() : prev.noteUpdatedAt };
    this.commit({
      profiles: [...this.state.value.profiles.filter((p) => p.residentId !== residentId), next],
      dietaryLog: noteChanged ? [this.access(residentId, 'Updated'), ...this.state.value.dietaryLog] : this.state.value.dietaryLog,
    });
    if (prev.plan !== plan) this.syncMessFee();
  }

  /**
   * Billing rule, part 1: the monthly "Mess" fee in Fees & Payments applies only to residents on a monthly plan
   * (Full Board, Breakfast & Dinner). Pay-per-meal residents are billed per meal attended and "No Mess"
   * residents not at all, so neither may also receive the monthly fee.
   */
  private syncMessFee(): void {
    const fee = this.fees.fees.find((f) => f.name === 'Mess' && f.status === 'Active');
    if (!fee) return;
    const monthly = this.currentResidents
      .filter((r) => MONTHLY_PLANS.includes(this.profile(r.residentId).plan))
      .map((r) => r.residentId)
      .sort();
    const current = fee.applicability.mode === 'Residents' ? [...fee.applicability.residentIds].sort() : null;
    if (!monthly.length || (current && current.join() === monthly.join())) return;
    const { id, createdAt, updatedAt, ...input } = fee;
    this.fees.saveFee({ ...input, applicability: { mode: 'Residents', residentIds: monthly } }, id);
  }

  /** Reveals a restricted dietary note and records who looked at it. */
  revealNote(residentId: string): string {
    this.commit({ dietaryLog: [this.access(residentId, 'Viewed'), ...this.state.value.dietaryLog] });
    return this.profile(residentId).dietaryNote ?? '';
  }

  lastAccess(residentId: string): DietaryAccess | undefined {
    return this.state.value.dietaryLog.find((a) => a.residentId === residentId);
  }

  // ---- Menus --------------------------------------------------------------------

  /** Published menus become Archived once their date has passed. */
  menuStatus(m: MessMenu): MenuStatus {
    return m.status === 'Published' && m.date < todayStr() ? 'Archived' : m.status;
  }

  menuFor(date: string, meal: MealType): MessMenu | undefined {
    return this.menus.find((m) => m.date === date && m.mealType === meal);
  }

  weekMenus(monday: string): MessMenu[] {
    const days = weekDates(monday);
    return this.menus.filter((m) => days.includes(m.date));
  }

  /**
   * Saves a menu. New / draft menus stay Draft unless `publish` is set. Editing a published menu keeps it
   * published and records the change; residents are notified when notifications are on.
   */
  saveMenu(input: MenuInput, id?: string, publish = false): MessMenu {
    const items = input.items.map((i) => i.trim()).filter(Boolean);
    if (!input.date) throw new Error('Meal date is required.');
    if (!items.length) throw new Error('Add at least one menu item.');
    if (!input.start || !input.end || input.end <= input.start) throw new Error('Serving end time must be after the start time.');
    const clash = this.menuFor(input.date, input.mealType);
    if (clash && clash.id !== id) throw new Error(`There is already a ${input.mealType} menu for that date (${clash.id}).`);
    if (publish && input.date < todayStr()) throw new Error("Past menus can't be published.");

    const now = localIso();
    const clean = { ...input, items, notes: input.notes?.trim() || undefined };
    if (!id) {
      const created: MessMenu = {
        id: this.nextMenuId(),
        hostelId: HOSTEL_ID,
        ...clean,
        status: publish ? 'Published' : 'Draft',
        publishedAt: publish ? now : undefined,
        createdBy: this.userName,
        createdAt: now,
        updatedAt: now,
        changes: [],
      };
      this.commit({ menus: [...this.menus, created], notices: publish ? this.withNotice('Published', `${this.describe(created)} published`) : this.notices });
      return created;
    }

    const existing = this.requireMenu(id);
    if (this.menuStatus(existing) === 'Archived') throw new Error('Archived menus are read-only.');
    if (existing.status === 'Published' && clean.date < todayStr()) throw new Error("A published menu can't be moved to a past date.");
    let next: MessMenu = { ...existing, ...clean, updatedAt: now };
    let notices = this.notices;
    if (existing.status === 'Published') {
      const summary = this.diff(existing, next);
      if (!summary) return existing;
      const notified = this.settings.notifyResidents ? this.messResidents.length : 0;
      next = { ...next, changes: [{ at: now, by: this.userName, summary, notified }, ...existing.changes] };
      if (notified) notices = this.withNotice('Updated', `${this.describe(next)}: ${summary}`);
    } else if (publish) {
      next = { ...next, status: 'Published', publishedAt: now };
      notices = this.withNotice('Published', `${this.describe(next)} published`);
    }
    this.commit({ menus: this.menus.map((m) => (m.id === id ? next : m)), notices });
    return next;
  }

  /** Publishes the week's drafts dated today or later. Returns how many were published. */
  publishWeek(monday: string): number {
    const today = todayStr();
    const drafts = this.weekMenus(monday).filter((m) => m.status === 'Draft' && m.date >= today && m.items.length);
    if (!drafts.length) return 0;
    const now = localIso();
    const ids = new Set(drafts.map((m) => m.id));
    this.commit({
      menus: this.menus.map((m) => (ids.has(m.id) ? { ...m, status: 'Published', publishedAt: now, updatedAt: now } : m)),
      notices: this.withNotice('Published', `${drafts.length} menu(s) for the week of ${monday} published`),
    });
    return drafts.length;
  }

  deleteDraft(id: string): void {
    if (this.requireMenu(id).status !== 'Draft') throw new Error('Only drafts can be deleted.');
    this.commit({ menus: this.menus.filter((m) => m.id !== id) });
  }

  /** Copies last week's menus into this week's empty slots as drafts. */
  copyPreviousWeek(monday: string): { created: number; skipped: number } {
    const source = this.weekMenus(addDays(monday, -7));
    const now = localIso();
    let id = this.maxMenuNo();
    const created: MessMenu[] = [];
    let skipped = 0;
    for (const m of source) {
      const date = addDays(m.date, 7);
      if (this.menuFor(date, m.mealType)) {
        skipped++;
        continue;
      }
      created.push({
        id: `MNU${String(++id).padStart(5, '0')}`, hostelId: HOSTEL_ID, date, mealType: m.mealType, items: [...m.items], start: m.start, end: m.end,
        notes: m.notes, status: 'Draft', createdBy: this.userName, createdAt: now, updatedAt: now, changes: [],
      });
    }
    if (created.length) this.commit({ menus: [...this.menus, ...created] });
    return { created: created.length, skipped };
  }

  // ---- Attendance ---------------------------------------------------------------

  marks(date: string, meal: MealType): Record<string, AttendanceMark> {
    return this.state.value.attendance[attKey(date, meal)] ?? {};
  }

  /** Records (or clears, with null) a resident's participation for a meal. Present can't be marked ahead. */
  mark(date: string, meal: MealType, residentIds: string[], mark: AttendanceMark | null): void {
    if (!this.settings.attendanceEnabled) throw new Error('Meal attendance is turned off.');
    if (!date) throw new Error('Pick a meal date.');
    if (mark === 'Present' && date > todayStr()) throw new Error("Attendance can't be marked for a future meal.");
    const key = attKey(date, meal);
    const day = { ...(this.state.value.attendance[key] ?? {}) };
    for (const id of residentIds) {
      if (mark) day[id] = mark;
      else delete day[id];
    }
    this.commit({ attendance: { ...this.state.value.attendance, [key]: day } });
  }

  // ---- Billing ------------------------------------------------------------------

  /**
   * Billing rule: Full Board / Breakfast & Dinner residents are billed by the monthly "Mess" fee in
   * Fees & Payments, so nothing is generated here. Pay-per-meal residents get one charge per month:
   * meals marked Present × the meal's rate. Only completed months can be billed, and a resident + month
   * is billed once (stored here and checked against existing charges by reference).
   */
  previewBilling(period: string): BillingPreviewRow[] {
    const perMeal = this.currentResidents.filter((r) => this.profile(r.residentId).plan === 'Pay per Meal');
    const ids = new Set(perMeal.map((r) => r.residentId));
    const counts: Record<string, { meals: number; amount: number }> = {};
    for (const [key, marks] of Object.entries(this.state.value.attendance)) {
      if (!key.startsWith(period)) continue;
      const meal = key.split('|')[1] as MealType;
      for (const [rid, m] of Object.entries(marks)) {
        if (m !== 'Present' || !ids.has(rid)) continue;
        const c = (counts[rid] ??= { meals: 0, amount: 0 });
        c.meals++;
        c.amount += this.settings.rates[meal];
      }
    }
    return perMeal.map((r) => ({
      residentId: r.residentId,
      residentName: residentFullName(r),
      meals: counts[r.residentId]?.meals ?? 0,
      amount: counts[r.residentId]?.amount ?? 0,
      chargeId: this.existingCharge(period, r.residentId),
    }));
  }

  /** Creates the missing pay-per-meal charges for a completed month. Safe to run again. */
  generateBilling(period: string): { created: MessBilling[]; skipped: number } {
    if (period >= monthOffset(0)) throw new Error('Only completed months can be billed.');
    const rows = this.previewBilling(period);
    const created: MessBilling[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (row.chargeId || row.amount <= 0) {
        skipped++;
        continue;
      }
      const [charge] = this.fees.createOneTimeCharge({
        residentIds: [row.residentId],
        description: `Mess – ${row.meals} meals, ${periodLabel(period)} (${billingRef(period, row.residentId)})`,
        amount: row.amount,
        taxRate: 0,
        dueDate: addDays(todayStr(), CHARGE_DUE_DAYS),
      });
      created.push({ period, residentId: row.residentId, residentName: row.residentName, meals: row.meals, amount: row.amount, chargeId: charge.id, at: localIso() });
    }
    if (created.length) this.commit({ billing: [...created, ...this.billing] });
    return { created, skipped };
  }

  private existingCharge(period: string, residentId: string): string | undefined {
    const own = this.billing.find((b) => b.period === period && b.residentId === residentId)?.chargeId;
    if (own) return own;
    const ref = billingRef(period, residentId);
    return this.fees.charges.find((c) => c.residentId === residentId && !c.cancelledAt && c.description.includes(ref))?.id;
  }

  // ---------------------------------------------------------------------------

  describe(m: Pick<MessMenu, 'date' | 'mealType'>): string {
    return `${m.mealType} on ${m.date}`;
  }

  private diff(a: MessMenu, b: MessMenu): string {
    const parts: string[] = [];
    const added = b.items.filter((i) => !a.items.includes(i));
    const removed = a.items.filter((i) => !b.items.includes(i));
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    if (a.start !== b.start || a.end !== b.end) parts.push(`serving time ${clock(b.start)} – ${clock(b.end)}`);
    if ((a.notes ?? '') !== (b.notes ?? '')) parts.push('notes updated');
    if (a.date !== b.date || a.mealType !== b.mealType) parts.push(`moved to ${this.describe(b)}`);
    const s = parts.join('; ');
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  }

  private withNotice(kind: MessNotice['kind'], summary: string): MessNotice[] {
    if (!this.settings.notifyResidents) return this.notices;
    const notice: MessNotice = { id: `MN${Date.now()}`, at: localIso(), kind, summary, recipients: this.messResidents.length };
    return [notice, ...this.notices];
  }

  private access(residentId: string, action: DietaryAccess['action']): DietaryAccess {
    return { at: localIso(), by: this.userName, residentId, action };
  }

  private requireMenu(id: string): MessMenu {
    const m = this.menus.find((x) => x.id === id);
    if (!m) throw new Error('Menu not found.');
    return m;
  }

  private get userName(): string {
    return this.auth.currentUser?.name || 'Hostel Owner';
  }

  private maxMenuNo(): number {
    return this.menus.reduce((max, m) => Math.max(max, Number(m.id.slice(3)) || 0), 0);
  }

  private nextMenuId(): string {
    return `MNU${String(this.maxMenuNo() + 1).padStart(5, '0')}`;
  }

  private commit(patch: Partial<MessState>): void {
    const next = { ...this.state.value, ...patch };
    this.state.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked — keep the in-memory copy.
    }
  }

  private load(): MessState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MessState;
    } catch {
      // Fall through to the seed data.
    }
    const s = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
    return s;
  }
}

// ---- Seed data (relative to today) ---------------------------------------------------

const MENU_ROTATION: Record<MealType, string[][]> = {
  Breakfast: [
    ['Idli', 'Sambar', 'Coconut chutney', 'Tea / Coffee'],
    ['Poha', 'Boiled eggs', 'Banana', 'Tea'],
    ['Aloo paratha', 'Curd', 'Pickle', 'Tea'],
    ['Upma', 'Peanut chutney', 'Boiled eggs', 'Coffee'],
    ['Masala dosa', 'Sambar', 'Chutney', 'Tea'],
    ['Bread toast', 'Omelette', 'Jam', 'Milk'],
    ['Puri', 'Aloo bhaji', 'Tea'],
  ],
  Lunch: [
    ['Rice', 'Dal tadka', 'Aloo gobi', 'Chapati', 'Curd'],
    ['Jeera rice', 'Rajma', 'Mixed veg', 'Chapati', 'Salad'],
    ['Rice', 'Sambar', 'Beans poriyal', 'Rasam', 'Papad'],
    ['Veg pulao', 'Raita', 'Paneer butter masala', 'Chapati'],
    ['Rice', 'Chole', 'Bhindi fry', 'Chapati', 'Buttermilk'],
    ['Lemon rice', 'Dal fry', 'Cabbage sabzi', 'Curd'],
    ['Veg biryani', 'Mirchi ka salan', 'Raita', 'Gulab jamun'],
  ],
  Snacks: [['Samosa', 'Tea'], ['Bread pakora', 'Tea'], ['Biscuits', 'Coffee'], ['Veg puff', 'Tea'], ['Sprouts chaat', 'Lemon juice'], ['Mirchi bajji', 'Tea'], ['Pav bhaji', 'Tea']],
  Dinner: [
    ['Chapati', 'Dal makhani', 'Jeera aloo', 'Rice', 'Salad'],
    ['Chapati', 'Egg curry / Paneer curry', 'Rice', 'Dal'],
    ['Chapati', 'Mix veg kurma', 'Rice', 'Rasam'],
    ['Fried rice', 'Veg manchurian', 'Soup'],
    ['Chapati', 'Kadai paneer', 'Rice', 'Dal', 'Kheer'],
    ['Chapati', 'Chicken curry / Veg kofta', 'Rice', 'Salad'],
    ['Khichdi', 'Kadhi', 'Papad', 'Pickle'],
  ],
};

/** Stable 0..1 value per key, so seeded attendance doesn't change between loads. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

function seed(): MessState {
  const today = todayStr();
  const thisWeek = weekStart(today);
  const by = 'Hostel Owner';
  const profiles: MealProfile[] = [
    { residentId: 'RES000001', plan: 'Full Board' },
    { residentId: 'RES000002', plan: 'Full Board', dietaryNote: 'Lactose intolerant — no milk-based sweets or curd.', noteUpdatedAt: `${addDays(today, -40)}T10:00:00` },
    { residentId: 'RES000003', plan: 'Pay per Meal' },
    { residentId: 'RES000004', plan: 'Breakfast & Dinner', dietaryNote: 'Peanut allergy (severe). Carries an EpiPen.', noteUpdatedAt: `${addDays(today, -60)}T10:00:00` },
    { residentId: 'RES000005', plan: 'Pay per Meal', dietaryNote: 'Vegetarian (no egg).', noteUpdatedAt: `${addDays(today, -20)}T10:00:00` },
    { residentId: 'RES000006', plan: 'Full Board' },
    { residentId: 'RES000007', plan: 'No Mess' },
  ];

  // Last week + this week published (past days read as Archived); next week partly drafted.
  const menus: MessMenu[] = [];
  let n = 0;
  const add = (date: string, meal: MealType, status: MessMenu['status']) => {
    const dow = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
    const [start, end] = MEAL_TIMES[meal];
    const created = `${addDays(date, -8)}T11:00:00`;
    menus.push({
      id: `MNU${String(++n).padStart(5, '0')}`, hostelId: HOSTEL_ID, date, mealType: meal, items: [...MENU_ROTATION[meal][dow]], start, end,
      status, publishedAt: status === 'Published' ? `${addDays(date, -7)}T18:00:00` : undefined, createdBy: by, createdAt: created, updatedAt: created, changes: [],
    });
  };
  for (const d of [...weekDates(addDays(thisWeek, -7)), ...weekDates(thisWeek)]) MEAL_TYPES.forEach((m) => add(d, m, 'Published'));
  for (const d of weekDates(addDays(thisWeek, 7)).slice(0, 4)) MEAL_TYPES.forEach((m) => add(d, m, 'Draft'));

  // A published menu changed after publishing (residents notified).
  const changed = menus.find((m) => m.status === 'Published' && m.date === addDays(today, 1) && m.mealType === 'Dinner') ?? menus.find((m) => m.date === today && m.mealType === 'Dinner')!;
  changed.items = [...changed.items.filter((i) => i !== 'Salad'), 'Fruit custard'];
  changed.notes = 'Special dinner for the Diwali week';
  const changeAt = `${addDays(today, -1)}T16:20:00`;
  changed.changes = [{ at: changeAt, by, summary: 'Added Fruit custard; notes updated', notified: 6 }];
  changed.updatedAt = changeAt;

  // Attendance for every meal from the 1st of last month up to today's served meals.
  const attendance: MessState['attendance'] = {};
  const nowTime = localIso().slice(11, 16);
  const eligible = (meal: MealType) => profiles.filter((p) => PLAN_MEALS[p.plan].includes(meal));
  for (let d = `${monthOffset(-1)}-01`; d <= today; d = addDays(d, 1)) {
    for (const meal of MEAL_TYPES) {
      if (d === today && MEAL_TIMES[meal][1] > nowTime) continue;
      const day: Record<string, AttendanceMark> = {};
      for (const p of eligible(meal)) {
        const r = rand(`${d}${meal}${p.residentId}`);
        const onLeave = p.residentId === 'RES000004' && d >= addDays(today, -11);
        if (onLeave || r < 0.1) day[p.residentId] = 'Opted out';
        else if (r < 0.95) day[p.residentId] = 'Present';
      }
      attendance[`${d}|${meal}`] = day;
    }
  }

  const notices: MessNotice[] = [
    { id: 'MN-SEED-2', at: changeAt, kind: 'Updated', summary: `${changed.mealType} on ${changed.date}: Added Fruit custard; notes updated`, recipients: 6 },
    { id: 'MN-SEED-1', at: `${addDays(thisWeek, -1)}T18:00:00`, kind: 'Published', summary: `28 menu(s) for the week of ${thisWeek} published`, recipients: 6 },
  ];

  return {
    settings: { attendanceEnabled: true, notifyResidents: true, rates: { Breakfast: 50, Lunch: 90, Snacks: 30, Dinner: 90 } },
    menus,
    profiles,
    attendance,
    dietaryLog: [{ at: `${addDays(today, -3)}T12:10:00`, by, residentId: 'RES000004', action: 'Viewed' }],
    notices,
    billing: [],
  };
}
