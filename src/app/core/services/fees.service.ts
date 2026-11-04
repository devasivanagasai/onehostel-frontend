import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import { AuthService } from './auth.service';
import { ResidentsService } from './residents.service';
import { HostelResident, residentFullName } from '../models/residents.models';
import { localDateIso } from '../../shared/utils/local-date';
import {
  Charge,
  ChargeStatus,
  FeeConfig,
  FeeStatus,
  LateFeeRule,
  Payment,
  PaymentMethod,
  REFERENCE_REQUIRED,
  feeDisplayName,
} from '../models/fees.models';

const STORAGE_KEY = 'onehostel_fees_v1';

interface FeesState {
  fees: FeeConfig[];
  charges: Charge[];
  payments: Payment[];
}

export interface FeesStats {
  collectedThisMonth: number;
  paymentsThisMonth: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  pendingCount: number;
  pendingAmount: number;
  activeFees: number;
}

export type FeeInput = Omit<FeeConfig, 'id' | 'createdAt' | 'updatedAt'>;

export interface OneTimeChargeInput {
  residentIds: string[];
  description: string;
  amount: number;
  taxRate: number;
  dueDate: string;
}

export interface RecordPaymentInput {
  chargeId: string;
  amount: number;
  method: PaymentMethod;
  transactionRef?: string;
  /** ISO date-time. */
  paidAt: string;
  notes?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const todayIso = (): string => localDateIso();

/** Local wall-clock ISO (yyyy-mm-ddTHH:mm:ss), matching the rest of the mock data. */
const nowIso = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
};

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable({ providedIn: 'root' })
export class FeesService {
  private readonly residents = inject(ResidentsService);
  private readonly auditLog = inject(AuditLogService);
  private readonly auth = inject(AuthService);

  private readonly state = new BehaviorSubject<FeesState>(this.load());

  readonly fees$: Observable<FeeConfig[]> = this.state.pipe(map((s) => s.fees));
  readonly charges$: Observable<Charge[]> = this.state.pipe(map((s) => s.charges));
  readonly payments$: Observable<Payment[]> = this.state.pipe(map((s) => s.payments));

  readonly stats$: Observable<FeesStats> = this.state.pipe(
    map((s) => {
      const month = todayIso().slice(0, 7);
      const successfulThisMonth = s.payments.filter((p) => p.status === 'Successful' && p.paidAt.startsWith(month));
      const open = s.charges.filter((c) => this.balance(c) > 0);
      const overdue = open.filter((c) => this.chargeStatus(c) === 'Overdue');
      const pending = s.payments.filter((p) => p.status === 'Pending');
      return {
        collectedThisMonth: round2(successfulThisMonth.reduce((sum, p) => sum + p.amount, 0)),
        paymentsThisMonth: successfulThisMonth.length,
        outstanding: round2(open.reduce((sum, c) => sum + this.balance(c), 0)),
        overdueAmount: round2(overdue.reduce((sum, c) => sum + this.balance(c), 0)),
        overdueCount: overdue.length,
        pendingCount: pending.length,
        pendingAmount: round2(pending.reduce((sum, p) => sum + p.amount, 0)),
        activeFees: s.fees.filter((f) => f.status === 'Active').length,
      };
    }),
  );

  constructor() {
    if (!this.hasStoredState()) this.seedHistory();
    this.ensureTenantDemoCharges();
    this.applyLateFees();
    this.syncResidentBalances();
  }

  get fees(): FeeConfig[] {
    return this.state.value.fees;
  }

  get charges(): Charge[] {
    return this.state.value.charges;
  }

  get payments(): Payment[] {
    return this.state.value.payments;
  }

  /** Refunds and reversals need Admin or Hostel Owner rights. */
  get canReverse(): boolean {
    return this.auth.isAdmin || this.auth.isHostelOwner;
  }

  feeById(id?: string): FeeConfig | undefined {
    return id ? this.fees.find((f) => f.id === id) : undefined;
  }

  chargeById(id: string): Charge | undefined {
    return this.charges.find((c) => c.id === id);
  }

  paymentById(id: string): Payment | undefined {
    return this.payments.find((p) => p.id === id);
  }

  paymentsFor(chargeId: string): Payment[] {
    return this.payments.filter((p) => p.chargeId === chargeId);
  }

  /** Only Successful payments count as collected (Pending / Failed / Reversed / Refunded do not). */
  paidFor(chargeId: string): number {
    return round2(this.paymentsFor(chargeId).filter((p) => p.status === 'Successful').reduce((s, p) => s + p.amount, 0));
  }

  balance(c: Charge): number {
    return c.cancelledAt ? 0 : Math.max(0, round2(c.total - this.paidFor(c.id)));
  }

  chargeStatus(c: Charge, today = todayIso()): ChargeStatus {
    if (c.cancelledAt) return 'Cancelled';
    const paid = this.paidFor(c.id);
    if (paid >= c.total) return 'Paid';
    if (today > c.dueDate) return 'Overdue';
    return paid > 0 ? 'Partially Paid' : 'Due';
  }

  openChargesFor(residentId: string): Charge[] {
    return this.charges.filter((c) => c.residentId === residentId && this.balance(c) > 0);
  }

  residentBalance(residentId: string): number {
    return round2(this.openChargesFor(residentId).reduce((s, c) => s + this.balance(c), 0));
  }

  /** Residents a fee applies to right now: current, Active / On Leave, and matching the fee's applicability. */
  applicableResidents(fee: Pick<FeeConfig, 'applicability'>): HostelResident[] {
    return this.residents.residents.filter((r) => {
      if (r.deactivatedAt || (r.status !== 'Active' && r.status !== 'On Leave')) return false;
      const a = fee.applicability;
      if (a.mode === 'Types') return a.residentTypes.includes(r.residentType);
      if (a.mode === 'Residents') return a.residentIds.includes(r.residentId);
      return true;
    });
  }

  /** Label of the billing period that contains `date`, e.g. "Oct 2026", "Q4 2026". */
  periodLabel(fee: FeeConfig, date = todayIso()): string {
    const { key } = this.period(fee, date);
    if (fee.frequency === 'Monthly') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    if (fee.frequency === 'Quarterly') return `${key.slice(5)} ${key.slice(0, 4)}`;
    if (fee.frequency === 'Custom') return `Period starting ${this.period(fee, date).start}`;
    return 'One-time';
  }

  // ---- Fee configuration ----------------------------------------------------

  saveFee(input: FeeInput, id?: string): FeeConfig {
    this.validateFee(input);
    const now = nowIso();
    const existing = this.feeById(id);
    const fee: FeeConfig = existing
      ? { ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now }
      : { ...input, id: this.nextId('FEE', this.fees.map((f) => f.id), 3), createdAt: now, updatedAt: now };

    this.commit({ fees: existing ? this.fees.map((f) => (f.id === fee.id ? fee : f)) : [fee, ...this.fees] });
    this.auditLog.record(existing ? 'Update Fee' : 'Create Fee', `${feeDisplayName(fee)} (${fee.id})`, {
      details: `Status: ${fee.status}`,
    });
    return fee;
  }

  setFeeStatus(id: string, status: FeeStatus): void {
    const fee = this.feeById(id);
    if (!fee) throw new Error('Fee not found.');
    this.saveFee({ ...fee, status }, id);
  }

  /**
   * Generates this period's charge for every applicable resident (Section 4.4.3).
   * Idempotent: a resident never gets the same fee twice for one period.
   */
  generateCharges(feeId: string, date = todayIso()): { created: number; skipped: number; period: string } {
    const fee = this.feeById(feeId);
    if (!fee) throw new Error('Fee not found.');
    if (fee.status !== 'Active') throw new Error('Activate the fee before generating charges.');
    if ((fee.effectiveFrom && date < fee.effectiveFrom) || (fee.effectiveTo && date > fee.effectiveTo)) {
      throw new Error(`${feeDisplayName(fee)} is not effective on ${date}.`);
    }

    const { created, skipped } = this.buildCharges(fee, date);
    if (created.length) this.commit({ charges: [...created, ...this.charges] });
    const period = this.periodLabel(fee, date);
    this.auditLog.record('Generate Charges', `${feeDisplayName(fee)} (${fee.id})`, {
      details: `${period}: ${created.length} created, ${skipped} already existed.`,
    });
    return { created: created.length, skipped, period };
  }

  /** How many charges `generateCharges` would create now (for the confirm dialog). */
  previewGeneration(feeId: string, date = todayIso()): { toCreate: number; existing: number; period: string } {
    const fee = this.feeById(feeId)!;
    const { created, skipped } = this.buildCharges(fee, date);
    return { toCreate: created.length, existing: skipped, period: this.periodLabel(fee, date) };
  }

  /** Authorised one-time charge for one or more residents. */
  createOneTimeCharge(input: OneTimeChargeInput): Charge[] {
    if (!(input.amount > 0)) throw new Error('Amount must be greater than zero.');
    if (!input.residentIds.length) throw new Error('Select at least one resident.');
    const today = todayIso();
    const ids = this.charges.map((c) => c.id);
    const created = input.residentIds.map((rid) => {
      const r = this.residents.byId(rid)!;
      const tax = round2((input.amount * input.taxRate) / 100);
      const id = this.nextId('INV', ids, 6);
      ids.push(id);
      return {
        id,
        residentId: rid,
        residentName: residentFullName(r),
        description: input.description.trim(),
        issueDate: today,
        dueDate: input.dueDate,
        baseAmount: input.amount,
        taxAmount: tax,
        lateFeeAmount: 0,
        total: round2(input.amount + tax),
        reminderCount: 0,
        createdBy: this.userName,
        createdAt: nowIso(),
      } satisfies Charge;
    });
    this.commit({ charges: [...created, ...this.charges] });
    this.auditLog.record('Create Charge', input.description, {
      details: `One-time charge of ${input.amount} for ${created.length} resident(s).`,
    });
    return created;
  }

  // ---- Payments -------------------------------------------------------------

  /**
   * Records a payment against a charge.
   * Cash / UPI / Card / Bank Transfer recorded by staff are Successful straight away and get a receipt.
   * Online payments stay Pending until the provider result is confirmed — they don't count as collected.
   */
  recordPayment(input: RecordPaymentInput): Payment {
    const charge = this.chargeById(input.chargeId);
    if (!charge) throw new Error('Charge not found.');

    const amount = round2(input.amount);
    const due = this.balance(charge);
    if (!(amount > 0)) throw new Error('Payment amount must be greater than zero.');
    if (due <= 0) throw new Error(`${charge.id} is already fully paid.`);
    const pendingOnline = round2(this.payments.filter((p) => p.chargeId === charge.id && p.status === 'Pending').reduce((sum, p) => sum + p.amount, 0));
    const available = round2(due - pendingOnline);
    if (amount > available) {
      throw new Error(
        pendingOnline > 0
          ? `Pending online payments already cover ${pendingOnline} — the most you can collect now is ${Math.max(0, available)}.`
          : `Advance payments aren't enabled — the most you can collect is ${due}.`,
      );
    }

    const ref = input.transactionRef?.trim() || undefined;
    if (REFERENCE_REQUIRED.includes(input.method) && !ref) throw new Error(`A transaction reference is required for ${input.method}.`);
    const dup = ref && this.findByReference(ref);
    if (dup) throw new Error(`Reference ${ref} was already used by ${dup.id}. Duplicate payments are blocked.`);

    const online = input.method === 'Online';
    const status = online ? 'Pending' : 'Successful';
    const payment: Payment = {
      id: this.nextId('PAY', this.payments.map((p) => p.id), 6),
      receiptId: online ? undefined : this.nextReceiptId(),
      residentId: charge.residentId,
      residentName: charge.residentName,
      chargeId: charge.id,
      chargeDescription: charge.description,
      amountDue: due,
      amount,
      method: input.method,
      transactionRef: ref,
      paidAt: input.paidAt || nowIso(),
      collectedBy: online ? 'Online (payer)' : this.userName,
      status,
      notes: input.notes?.trim() || undefined,
      history: [{ at: nowIso(), action: online ? 'Online payment initiated' : 'Payment recorded', by: this.userName }],
    };

    this.commit({ payments: [payment, ...this.payments] });
    this.auditLog.record('Collect Payment', `${payment.id} · ${charge.residentName}`, {
      details: `${amount} via ${input.method} for ${charge.id}. Status: ${status}.`,
    });
    return payment;
  }

  /** Applies the provider's confirmed result to a Pending online payment. */
  confirmOnline(paymentId: string, success: boolean): Payment {
    const p = this.requirePayment(paymentId);
    if (p.status !== 'Pending') throw new Error(`${p.id} is ${p.status}, not Pending.`);

    let next: Payment;
    if (success) {
      const charge = this.chargeById(p.chargeId)!;
      const due = this.balance(charge);
      if (p.amount > due) {
        next = this.withEvent({ ...p, status: 'Failed' }, 'Provider confirmed — marked Failed', 'Would overpay the charge (already settled).');
      } else {
        next = this.withEvent({ ...p, status: 'Successful', receiptId: this.nextReceiptId(), amountDue: due }, 'Provider confirmed payment');
      }
    } else {
      next = this.withEvent({ ...p, status: 'Failed' }, 'Provider reported failure');
    }
    this.replacePayment(next);
    this.auditLog.record('Confirm Payment', `${p.id} · ${p.residentName}`, { details: `Provider result: ${next.status}.` });
    return next;
  }

  /**
   * Reversal (recorded in error, bounced) or refund (money returned).
   * The original transaction stays visible; only its status changes and the event is logged.
   */
  reverseOrRefund(paymentId: string, kind: 'Reversed' | 'Refunded', reason: string): Payment {
    if (!this.canReverse) throw new Error("You don't have permission to reverse or refund payments.");
    const p = this.requirePayment(paymentId);
    if (p.status !== 'Successful') throw new Error(`Only Successful payments can be ${kind.toLowerCase()}.`);
    if (reason.trim().length < 5) throw new Error('Give a reason (at least 5 characters).');

    const next = this.withEvent({ ...p, status: kind, reason: reason.trim() }, kind === 'Reversed' ? 'Payment reversed' : 'Payment refunded', reason.trim());
    this.replacePayment(next);
    this.auditLog.record(kind === 'Reversed' ? 'Reverse Payment' : 'Refund Payment', `${p.id} · ${p.residentName}`, {
      details: `${p.amount} ${kind.toLowerCase()}. Reason: ${reason.trim()}`,
    });
    return next;
  }

  /** Adjustment: waives a charge that has nothing collected against it. The charge stays visible. */
  cancelCharge(chargeId: string, reason: string): void {
    if (!this.canReverse) throw new Error("You don't have permission to cancel charges.");
    const c = this.chargeById(chargeId);
    if (!c) throw new Error('Charge not found.');
    if (c.cancelledAt) throw new Error(`${c.id} is already cancelled.`);
    if (this.paidFor(c.id) > 0) throw new Error('Reverse or refund the payments on this charge first.');
    if (this.paymentsFor(c.id).some((p) => p.status === 'Pending')) throw new Error('A payment on this charge is still pending confirmation.');
    if (reason.trim().length < 5) throw new Error('Give a reason (at least 5 characters).');
    this.commit({ charges: this.charges.map((x) => (x.id === c.id ? { ...x, cancelledAt: nowIso(), cancelReason: reason.trim() } : x)) });
    this.auditLog.record('Cancel Charge', `${c.id} · ${c.residentName}`, { details: `${c.description} (${c.total}) cancelled. Reason: ${reason.trim()}` });
  }

  /** Sends due / overdue reminders. Returns how many were sent. */
  sendReminders(chargeIds: string[]): number {
    const at = nowIso();
    const targets = new Set(chargeIds.filter((id) => {
      const c = this.chargeById(id);
      return !!c && this.balance(c) > 0;
    }));
    if (!targets.size) return 0;
    this.commit({
      charges: this.charges.map((c) => (targets.has(c.id) ? { ...c, lastReminderAt: at, reminderCount: c.reminderCount + 1 } : c)),
    });
    this.auditLog.record('Send Reminder', `${targets.size} charge(s)`, { details: [...targets].join(', ') });
    return targets.size;
  }

  findByReference(ref: string): Payment | undefined {
    const r = ref.trim().toLowerCase();
    return this.payments.find((p) => p.status !== 'Failed' && p.transactionRef?.toLowerCase() === r);
  }

  // ---------------------------------------------------------------------------

  /**
   * Demo data for the built-in Tenant (RES000001): one overdue and one upcoming charge so the Tenant
   * Fees page has something to pay. Runs once per browser (also on data stored before this existed).
   */
  private ensureTenantDemoCharges(): void {
    const r = this.residents.byId('RES000001');
    if (!r) return;
    const demo: [string, number, string, string][] = [
      ['Mess · Oct 2026 extra meals', 800, '2026-10-10', '2026-10-25'],
      ['Maintenance · Nov 2026', 1500, '2026-11-01', '2026-11-20'],
    ];
    const add = demo.filter(([d]) => !this.charges.some((c) => c.residentId === r.residentId && c.description === d));
    if (!add.length) return;
    const ids = this.charges.map((c) => c.id);
    const created = add.map(([description, amount, issueDate, dueDate]): Charge => {
      const id = this.nextId('INV', ids, 6);
      ids.push(id);
      return {
        id, residentId: r.residentId, residentName: residentFullName(r), description, issueDate, dueDate,
        baseAmount: amount, taxAmount: 0, lateFeeAmount: 0, total: amount, reminderCount: 0,
        createdBy: 'Hostel Owner', createdAt: `${issueDate}T10:00:00`,
      };
    });
    this.commit({ charges: [...this.charges, ...created] });
  }

  private get userName(): string {
    return this.auth.currentUser?.name ?? 'Hostel Owner';
  }

  private validateFee(f: FeeInput): void {
    if (!(f.amount >= 0)) throw new Error('Amount must be zero or more.');
    if (f.effectiveFrom && f.effectiveTo && f.effectiveTo < f.effectiveFrom) throw new Error('"Effective to" must be on or after "Effective from".');
    if (f.applicability.mode === 'Types' && !f.applicability.residentTypes.length) throw new Error('Pick at least one resident type.');
    if (f.applicability.mode === 'Residents' && !f.applicability.residentIds.length) throw new Error('Pick at least one resident.');
  }

  /** Billing period containing `date`: a stable key and its first day. */
  private period(fee: FeeConfig, date: string): { key: string; start: string } {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    switch (fee.frequency) {
      case 'Monthly':
        return { key: date.slice(0, 7), start: `${date.slice(0, 7)}-01` };
      case 'Quarterly': {
        const q = Math.ceil(m / 3);
        return { key: `${y}-Q${q}`, start: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01` };
      }
      case 'Custom': {
        const from = fee.effectiveFrom ?? `${y}-01-01`;
        const every = Math.max(1, fee.customMonths ?? 1);
        const elapsed = (y - Number(from.slice(0, 4))) * 12 + (m - Number(from.slice(5, 7)));
        const index = Math.max(0, Math.floor(elapsed / every));
        const sm = Number(from.slice(5, 7)) - 1 + index * every;
        const start = `${Number(from.slice(0, 4)) + Math.floor(sm / 12)}-${String((sm % 12) + 1).padStart(2, '0')}-01`;
        return { key: `C${index}`, start };
      }
      default:
        return { key: 'once', start: fee.effectiveFrom ?? date };
    }
  }

  private buildCharges(fee: FeeConfig, date: string, issueDate = date): { created: Charge[]; skipped: number } {
    const { key, start } = this.period(fee, date);
    const months = fee.frequency === 'Quarterly' ? 3 : fee.frequency === 'Custom' ? Math.max(1, fee.customMonths ?? 1) : 1;
    const ids = this.charges.map((c) => c.id);
    let skipped = 0;
    const created: Charge[] = [];

    for (const r of this.applicableResidents(fee)) {
      if (this.charges.some((c) => c.feeId === fee.id && c.period === key && c.residentId === r.residentId)) {
        skipped++;
        continue;
      }
      const bedRent = this.residents.allocationFor(r.residentId)?.bed.monthlyRent;
      if (fee.amountSource === 'Bed rent' && !bedRent && !fee.amount) continue; // no bed, no fallback amount
      const base = fee.amountSource === 'Bed rent' && bedRent ? bedRent * months : fee.amount;
      const tax = round2((base * fee.taxRate) / 100);
      const id = this.nextId('INV', ids, 6);
      ids.push(id);
      created.push({
        id,
        residentId: r.residentId,
        residentName: residentFullName(r),
        feeId: fee.id,
        description: `${feeDisplayName(fee)}${fee.frequency === 'One-time' ? '' : ' · ' + this.periodLabel(fee, date)}`,
        period: key,
        issueDate,
        dueDate: this.dueDate(fee, start, issueDate),
        baseAmount: base,
        taxAmount: tax,
        lateFeeAmount: 0,
        total: round2(base + tax),
        lateFeeRule: fee.lateFee,
        reminderCount: 0,
        createdBy: this.userName,
        createdAt: nowIso(),
      });
    }
    return { created, skipped };
  }

  /** Due date from the fee's rule — never before the issue date, so a charge generated late isn't born overdue. */
  private dueDate(fee: FeeConfig, periodStart: string, issueDate: string): string {
    const r = fee.dueRule;
    const due =
      r.type === 'day-of-period'
        ? addDays(periodStart, Math.min(28, Math.max(1, r.day)) - 1)
        : r.type === 'days-after-issue'
          ? addDays(issueDate, r.days)
          : r.date;
    return due < issueDate ? issueDate : due;
  }

  /** Adds the late fee once to open charges that are past due + grace. Idempotent. */
  private applyLateFees(today = todayIso()): void {
    let changed = false;
    const charges = this.charges.map((c) => {
      const rule: LateFeeRule | undefined = c.lateFeeRule;
      if (!rule || c.lateFeeAmount > 0 || this.balance(c) <= 0 || today <= addDays(c.dueDate, rule.graceDays)) return c;
      const fee = round2(rule.type === 'Fixed' ? rule.value : (c.baseAmount * rule.value) / 100);
      if (fee <= 0) return c;
      changed = true;
      return { ...c, lateFeeAmount: fee, total: round2(c.total + fee) };
    });
    if (changed) this.commit({ charges });
  }

  /** Pushes each resident's outstanding balance into their resident record. */
  private syncResidentBalances(): void {
    const balances: Record<string, number> = {};
    for (const r of this.residents.residents) balances[r.residentId] = this.residentBalance(r.residentId);
    this.residents.syncBalances(balances);
  }

  private withEvent(p: Payment, action: string, reason?: string): Payment {
    return { ...p, history: [{ at: nowIso(), action, by: this.userName, reason }, ...p.history] };
  }

  private requirePayment(id: string): Payment {
    const p = this.paymentById(id);
    if (!p) throw new Error('Payment not found.');
    return p;
  }

  private replacePayment(next: Payment): void {
    this.commit({ payments: this.payments.map((p) => (p.id === next.id ? next : p)) });
  }

  private nextReceiptId(): string {
    return this.nextId('RCP', this.payments.map((p) => p.receiptId ?? ''), 6);
  }

  private nextId(prefix: string, existing: string[], width: number): string {
    const max = existing.reduce((m, id) => (id.startsWith(prefix) ? Math.max(m, Number(id.slice(prefix.length)) || 0) : m), 0);
    return `${prefix}${String(max + 1).padStart(width, '0')}`;
  }

  private commit(patch: Partial<FeesState>): void {
    const next = { ...this.state.value, ...patch };
    this.state.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage quota
    }
    if (patch.charges || patch.payments) this.syncResidentBalances();
  }

  private load(): FeesState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored) as FeesState;
    } catch {
      // fall through to seed
    }
    return { fees: SEED_FEES, charges: [], payments: [] };
  }

  private hasStoredState(): boolean {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  }

  /** First run only: builds Sep/Oct 2026 history from the seed fees so the screens have realistic data. */
  private seedHistory(): void {
    const seedUser = 'Hostel Owner';
    const all: Charge[] = [];
    for (const date of ['2026-09-01', '2026-10-01']) {
      for (const fee of this.fees.filter((f) => f.status === 'Active' && f.frequency === 'Monthly')) {
        // build against the accumulated list so IDs stay unique
        this.state.next({ ...this.state.value, charges: all });
        all.push(...this.buildCharges(fee, date, date).created.map((c) => ({ ...c, createdBy: seedUser, createdAt: `${date}T09:00:00` })));
      }
    }
    const extra = (residentId: string, description: string, amount: number, issue: string, due: string): Charge => {
      const r = this.residents.byId(residentId);
      return {
        id: `INV${String(all.length + 1).padStart(6, '0')}`,
        residentId,
        residentName: r ? residentFullName(r) : residentId,
        description,
        issueDate: issue,
        dueDate: due,
        baseAmount: amount,
        taxAmount: 0,
        lateFeeAmount: 0,
        total: amount,
        reminderCount: 0,
        createdBy: seedUser,
        createdAt: `${issue}T10:00:00`,
      };
    };
    if (this.residents.byId('RES000011')) all.push(extra('RES000011', 'Pending dues · Jul–Aug 2026 rent', 14000, '2026-08-01', '2026-08-31'));
    if (this.residents.byId('RES000010')) all.push(extra('RES000010', 'Security Deposit', 5000, '2026-01-10', '2026-01-15'));

    const payments: Payment[] = [];
    const methods: PaymentMethod[] = ['UPI', 'Cash', 'Bank Transfer', 'Card'];
    const pay = (c: Charge, amount: number, method: PaymentMethod, at: string, status: Payment['status'] = 'Successful', reason?: string) => {
      const n = payments.length + 1;
      const receiptCount = payments.filter((p) => p.receiptId).length;
      const hasReceipt = status === 'Successful' || status === 'Reversed' || status === 'Refunded';
      const p: Payment = {
        id: `PAY${String(n).padStart(6, '0')}`,
        receiptId: hasReceipt ? `RCP${String(receiptCount + 1).padStart(6, '0')}` : undefined,
        residentId: c.residentId,
        residentName: c.residentName,
        chargeId: c.id,
        chargeDescription: c.description,
        amountDue: c.total,
        amount,
        method,
        transactionRef: method === 'Cash' ? undefined : `${method === 'Online' ? 'pay_' : method.slice(0, 3).toUpperCase() + '-'}${at.replace(/\D/g, '').slice(2, 10)}${n}`,
        paidAt: at,
        collectedBy: method === 'Online' ? 'Online (payer)' : seedUser,
        status,
        reason,
        history: [{ at, action: method === 'Online' ? 'Online payment initiated' : 'Payment recorded', by: method === 'Online' ? 'Resident (online)' : seedUser }],
      };
      if (status === 'Reversed' || status === 'Refunded') {
        p.history.unshift({ at: at.slice(0, 10) + 'T18:00:00', action: status === 'Reversed' ? 'Payment reversed' : 'Payment refunded', by: seedUser, reason });
      }
      if (status === 'Failed') p.history.unshift({ at, action: 'Provider reported failure', by: 'Razorpay' });
      payments.push(p);
    };

    const find = (rid: string, prefix: string, month: string) =>
      all.find((c) => c.residentId === rid && c.description.startsWith(prefix) && c.period === month);

    // September: everything settled
    all.filter((c) => c.period === '2026-09').forEach((c, i) => pay(c, c.total, methods[i % methods.length], `2026-09-0${3 + (i % 6)}T1${i % 9}:15:00`));

    // October
    const oct = (rid: string, prefix: string) => find(rid, prefix, '2026-10');
    for (const rid of ['RES000001', 'RES000003', 'RES000005']) {
      all.filter((c) => c.residentId === rid && c.period === '2026-10').forEach((c, i) => pay(c, c.total, methods[i % 3], `2026-10-0${3 + i}T11:30:00`));
    }
    const r3 = oct('RES000003', 'Hostel Fee');
    if (r3) pay(r3, r3.total, 'Cash', '2026-10-04T12:10:00', 'Reversed', 'Duplicate entry — same cash collection recorded twice.');
    const r7rent = oct('RES000007', 'Hostel Fee');
    if (r7rent) pay(r7rent, r7rent.total, 'UPI', '2026-10-04T09:40:00');
    const r7mess = oct('RES000007', 'Mess');
    if (r7mess) pay(r7mess, r7mess.total, 'Online', '2026-10-15T21:05:00', 'Pending');
    const r2rent = oct('RES000002', 'Hostel Fee');
    if (r2rent) pay(r2rent, r2rent.total, 'Bank Transfer', '2026-10-05T10:00:00');
    const r6rent = oct('RES000006', 'Hostel Fee');
    if (r6rent) pay(r6rent, 5000, 'Cash', '2026-10-06T17:20:00');
    const r4rent = oct('RES000004', 'Hostel Fee');
    if (r4rent) pay(r4rent, r4rent.total, 'Online', '2026-10-08T08:15:00', 'Failed');
    const deposit = all.find((c) => c.residentId === 'RES000010');
    if (deposit) {
      // Collected at joining, refunded at check-out; the charge is then closed as an adjustment.
      pay(deposit, 5000, 'Cash', '2026-01-10T12:00:00', 'Refunded', 'Security deposit returned on check-out.');
      deposit.cancelledAt = '2026-06-30T18:05:00';
      deposit.cancelReason = 'Deposit refunded on check-out.';
    }

    this.commit({ charges: all, payments: payments.reverse() });
  }
}

const SEED_FEES: FeeConfig[] = [
  {
    id: 'FEE001', name: 'Hostel Fee/Rent', category: 'Accommodation', amountSource: 'Bed rent', amount: 7000,
    frequency: 'Monthly', effectiveFrom: '2026-01-01', dueRule: { type: 'day-of-period', day: 5 },
    lateFee: { type: 'Fixed', value: 100, graceDays: 5 }, taxRate: 0, applicability: { mode: 'All' },
    status: 'Active', createdAt: '2026-01-01T09:00:00', updatedAt: '2026-01-01T09:00:00',
  },
  {
    id: 'FEE002', name: 'Mess', category: 'Food', amountSource: 'Fixed', amount: 3000,
    frequency: 'Monthly', effectiveFrom: '2026-01-01', dueRule: { type: 'day-of-period', day: 5 },
    taxRate: 5, applicability: { mode: 'All' },
    status: 'Active', createdAt: '2026-01-01T09:00:00', updatedAt: '2026-01-01T09:00:00',
  },
  {
    id: 'FEE003', name: 'Laundry', category: 'Services', amountSource: 'Fixed', amount: 500,
    frequency: 'Monthly', effectiveFrom: '2026-06-01', dueRule: { type: 'days-after-issue', days: 10 },
    taxRate: 0, applicability: { mode: 'Residents', residentIds: ['RES000002', 'RES000006'] },
    status: 'Active', createdAt: '2026-06-01T09:00:00', updatedAt: '2026-06-01T09:00:00',
  },
  {
    id: 'FEE004', name: 'Maintenance', category: 'Utilities', amountSource: 'Fixed', amount: 1500,
    frequency: 'Quarterly', effectiveFrom: '2026-10-01', dueRule: { type: 'day-of-period', day: 10 },
    lateFee: { type: 'Percentage', value: 2, graceDays: 7 }, taxRate: 18, applicability: { mode: 'All' },
    status: 'Draft', createdAt: '2026-10-12T15:00:00', updatedAt: '2026-10-12T15:00:00',
  },
  {
    id: 'FEE005', name: 'Other', label: 'Security Deposit', category: 'Deposit', amountSource: 'Fixed', amount: 5000,
    frequency: 'One-time', dueRule: { type: 'days-after-issue', days: 5 }, taxRate: 0, applicability: { mode: 'All' },
    status: 'Inactive', createdAt: '2026-01-01T09:00:00', updatedAt: '2026-03-01T09:00:00',
  },
];
