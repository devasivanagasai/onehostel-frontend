export type SubscriptionStatus =
  | 'Trial'
  | 'Active'
  | 'Payment Pending'
  | 'Expired'
  | 'Suspended'
  | 'Cancelled';

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'Trial',
  'Active',
  'Payment Pending',
  'Expired',
  'Suspended',
  'Cancelled',
];

export type PaymentStatus = 'Paid' | 'Pending' | 'Failed' | 'Refunded' | 'N/A';

export const PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending', 'Failed', 'Refunded'];

export type BillingCycle = 'Monthly' | 'Quarterly' | 'Yearly';

export type PaymentMethod = 'UPI' | 'Card' | 'Net Banking' | 'Bank Transfer';

export type PaymentGateway = 'Razorpay' | 'PayU' | 'Cashfree' | 'PhonePe' | 'Manual';

// ---- GST ------------------------------------------------------------------------

/** GST rule for a payment. New payments take it from Settings → Payment at the time of payment. */
export interface TaxPolicy {
  gstEnabled: boolean;
  /** Percent, e.g. 18. */
  gstRate: number;
  /** true = the plan price already includes GST; false = GST is added on top. */
  pricesIncludeTax: boolean;
  /** Platform GSTIN printed on invoices while GST is enabled. */
  gstin?: string;
}

/** Tax fields stored on every payment, so old invoices never change when Settings change. */
export interface TaxBreakdown {
  /** Base amount, before GST. */
  amount: number;
  tax: number;
  totalAmount: number;
  /** Percent applied to this payment (0 = no GST). */
  taxRate: number;
  /** The plan price included GST (amount was derived from it). */
  taxInclusive: boolean;
  gstin?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Works out base amount, GST and total for a plan price under a tax policy:
 *  - GST disabled          → no tax; total = price.
 *  - prices exclude GST    → GST added on top: total = price + price × rate.
 *  - prices include GST    → price is the total; base = price ÷ (1 + rate), GST = total − base.
 */
export function applyTax(price: number, policy: TaxPolicy): TaxBreakdown {
  const rate = policy.gstEnabled ? Math.max(0, policy.gstRate) : 0;
  const gstin = rate > 0 && policy.gstin ? policy.gstin : undefined;
  if (rate === 0) {
    return { amount: round2(price), tax: 0, totalAmount: round2(price), taxRate: 0, taxInclusive: false, gstin };
  }
  if (policy.pricesIncludeTax) {
    const total = round2(price);
    const amount = round2(total / (1 + rate / 100));
    return { amount, tax: round2(total - amount), totalAmount: total, taxRate: rate, taxInclusive: true, gstin };
  }
  const tax = round2((price * rate) / 100);
  return { amount: round2(price), tax, totalAmount: round2(price + tax), taxRate: rate, taxInclusive: false, gstin };
}

// ---- Late payment fee -------------------------------------------------------------

/** Late-fee rule from Settings → Payment. */
export interface LateFeePolicy {
  enabled: boolean;
  type: 'Fixed' | 'Percentage';
  /** Fixed: currency amount. Percentage: % of the amount due. */
  value: number;
  graceDays: number;
}

/**
 * Late fee for a payment made `daysLate` days after its due date.
 * Nothing is charged within the grace period, or when the fee is disabled.
 */
export function lateFeeFor(amountDue: number, daysLate: number, policy: LateFeePolicy): number {
  if (!policy.enabled || policy.value <= 0 || daysLate <= policy.graceDays) return 0;
  return policy.type === 'Percentage' ? round2((amountDue * policy.value) / 100) : round2(policy.value);
}

/**
 * When a payment is due:
 *  - settling a Pending payment → the date it was billed (its paymentDate);
 *  - renewing → the current period's expiry date (the next period must be paid by then).
 */
export function paymentDueDate(sub: HostelSubscription, pending?: PaymentTransaction): string {
  return pending ? pending.paymentDate : sub.expiryDate;
}

/** Whole days from `dueIso` to `onIso` (both yyyy-mm-dd); 0 or less = on time. */
export function daysLateBetween(dueIso: string, onIso: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(onIso) - toUtc(dueIso)) / 86_400_000);
}

/** Policy used for the historical sample payments (matches the default Settings at the time). */
const SAMPLE_TAX_POLICY: TaxPolicy = { gstEnabled: true, gstRate: 18, pricesIncludeTax: false, gstin: '36AABCO1234F1Z5' };

/**
 * Subscription lifecycle rule (agreed business rule):
 *
 *  - A hostel has at most ONE open subscription at a time (see OPEN_SUBSCRIPTION_STATUSES).
 *  - Renewals, upgrades/downgrades and payment recovery KEEP the same subscriptionId —
 *    the expiry date / plan change and a new payment + invoice is added under it.
 *  - A NEW subscriptionId is issued only when the hostel is onboarded, or when it
 *    subscribes again after its previous subscription was Cancelled or Expired.
 *
 * So over its lifetime a hostel may have several subscription IDs (old closed ones
 * plus the current one), but never two open ones. Subscriptions link to hostels by
 * `hostelId` (not by name, which can change or repeat).
 */
export interface HostelSubscription {
  subscriptionId: string;
  /** Owning hostel, e.g. HST-1001. */
  hostelId: string;
  hostelName: string;
  planName: string;
  billingCycle: BillingCycle;
  /** ISO dates; rendered as dd-MMM-yy. */
  startDate: string;
  expiryDate: string;
  /** Plan amount per billing cycle, before tax. */
  amount: number;
  paymentStatus: PaymentStatus;
  status: SubscriptionStatus;
}

export interface PaymentTransaction {
  transactionId: string;
  subscriptionId: string;
  hostelName: string;
  planName: string;
  billingCycle: BillingCycle;
  /** Base amount, before GST. */
  amount: number;
  tax: number;
  /** Everything collected: amount + tax + lateFee. */
  totalAmount: number;
  /** Late payment fee charged (Settings → Fees), fixed once recorded. Absent/0 = paid on time. */
  lateFee?: number;
  /** Days after the due date the payment was made, when a late fee was charged. */
  daysLate?: number;
  /** GST percent applied when this payment was made (0 = no GST). Fixed once recorded. */
  taxRate: number;
  /** The plan price included GST, so `amount` was derived from the total. */
  taxInclusive: boolean;
  /** Platform GSTIN printed on this invoice (only when GST applied). */
  gstin?: string;
  /** ISO date. */
  paymentDate: string;
  paymentMethod: PaymentMethod;
  paymentGateway: PaymentGateway;
  paymentStatus: Exclude<PaymentStatus, 'N/A'>;
  /** Only issued once money has been collected (Paid / Refunded). */
  invoiceNumber?: string;
}

/** Payments are only receipted once money has actually changed hands. */
export function hasInvoice(payment: PaymentTransaction): boolean {
  return !!payment.invoiceNumber;
}

// ---- Subscription lifecycle (see the rule on HostelSubscription) ----------------

/** Still belongs to the hostel and can be renewed, resumed or have its plan changed. */
export const OPEN_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['Trial', 'Active', 'Payment Pending', 'Suspended'];

/** Finished — the hostel needs a NEW subscription ID to subscribe again. */
export const CLOSED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['Expired', 'Cancelled'];

export function isOpenSubscription(sub: HostelSubscription): boolean {
  return OPEN_SUBSCRIPTION_STATUSES.includes(sub.status);
}

/** The hostel's one open subscription, if any. */
export function openSubscriptionFor(subs: HostelSubscription[], hostelId: string): HostelSubscription | undefined {
  return subs.find((s) => s.hostelId === hostelId && isOpenSubscription(s));
}

/** All of a hostel's subscriptions (current and past), newest first. */
export function subscriptionsFor(subs: HostelSubscription[], hostelId: string): HostelSubscription[] {
  return subs.filter((s) => s.hostelId === hostelId).sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** A new subscription ID may only be issued when the hostel has no open subscription. */
export function canStartNewSubscription(subs: HostelSubscription[], hostelId: string): boolean {
  return !openSubscriptionFor(subs, hostelId);
}

const CYCLE_MONTHS: Record<BillingCycle, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

/**
 * Expiry date of the next billing period. Periods end the day before the same
 * date one cycle later (01-Apr → 31-Mar, 10-Sep → 09-Oct), so the next period
 * runs from the day after `expiryDate`.
 */
export function nextExpiryDate(expiryDate: string, cycle: BillingCycle): string {
  const [y, m, d] = expiryDate.split('-').map(Number);
  const nextStart = new Date(Date.UTC(y, m - 1, d + 1));
  const end = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + CYCLE_MONTHS[cycle], nextStart.getUTCDate() - 1));
  return end.toISOString().slice(0, 10);
}

/** Renewal keeps the SAME subscription ID and extends the expiry by one billing cycle. */
export function renewSubscription(sub: HostelSubscription): HostelSubscription {
  if (!isOpenSubscription(sub)) {
    throw new Error(`${sub.subscriptionId} is ${sub.status}; start a new subscription instead of renewing.`);
  }
  return { ...sub, expiryDate: nextExpiryDate(sub.expiryDate, sub.billingCycle), status: 'Active', paymentStatus: 'Paid' };
}

/** Upgrade / downgrade keeps the SAME subscription ID; only the plan terms change. */
export function changeSubscriptionPlan(
  sub: HostelSubscription,
  change: Pick<HostelSubscription, 'planName' | 'billingCycle' | 'amount'>,
): HostelSubscription {
  if (!isOpenSubscription(sub)) {
    throw new Error(`${sub.subscriptionId} is ${sub.status}; start a new subscription instead of changing its plan.`);
  }
  return { ...sub, ...change };
}

/** Sample payment: `amount` is the plan price; tax fields come from the sample-era GST policy. */
function payment(p: Omit<PaymentTransaction, keyof TaxBreakdown> & { amount: number }): PaymentTransaction {
  return { ...p, ...applyTax(p.amount, SAMPLE_TAX_POLICY) };
}

export const MOCK_SUBSCRIPTIONS: HostelSubscription[] = [
  {
    subscriptionId: 'SUB000118',
    hostelId: 'HST-1001',
    hostelName: 'Grand Stay Hostel',
    planName: 'Premium',
    billingCycle: 'Yearly',
    startDate: '2026-04-01',
    expiryDate: '2027-03-31',
    amount: 19999,
    paymentStatus: 'Paid',
    status: 'Active',
  },
  {
    subscriptionId: 'SUB000119',
    hostelId: 'HST-1002',
    hostelName: 'Royal Palms Luxury Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    startDate: '2026-09-10',
    expiryDate: '2026-10-09',
    amount: 1999,
    paymentStatus: 'Paid',
    status: 'Active',
  },
  {
    subscriptionId: 'SUB000120',
    hostelId: 'HST-1003',
    hostelName: 'City Center PG & Hostel',
    planName: 'Basic',
    billingCycle: 'Monthly',
    startDate: '2026-09-01',
    expiryDate: '2026-09-30',
    amount: 999,
    paymentStatus: 'Pending',
    status: 'Payment Pending',
  },
  {
    subscriptionId: 'SUB000121',
    hostelId: 'HST-1004',
    hostelName: 'Green Valley Girls Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    startDate: '2026-09-20',
    expiryDate: '2026-10-04',
    amount: 0,
    paymentStatus: 'N/A',
    status: 'Trial',
  },
  {
    subscriptionId: 'SUB000122',
    hostelId: 'HST-1005',
    hostelName: 'Lakeview Residency',
    planName: 'Basic',
    billingCycle: 'Monthly',
    startDate: '2026-07-01',
    expiryDate: '2026-07-31',
    amount: 999,
    paymentStatus: 'Failed',
    status: 'Expired',
  },
  {
    subscriptionId: 'SUB000123',
    hostelId: 'HST-1006',
    hostelName: 'ABC Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    startDate: '2026-09-01',
    expiryDate: '2026-09-30',
    amount: 1999,
    paymentStatus: 'Paid',
    status: 'Active',
  },
  {
    subscriptionId: 'SUB000124',
    hostelId: 'HST-1007',
    hostelName: 'Metro Stay PG',
    planName: 'Premium',
    billingCycle: 'Yearly',
    startDate: '2025-11-01',
    expiryDate: '2026-10-31',
    amount: 19999,
    paymentStatus: 'Paid',
    status: 'Suspended',
  },
  {
    subscriptionId: 'SUB000125',
    hostelId: 'HST-1008',
    hostelName: 'Sunrise Boys Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    startDate: '2026-05-01',
    expiryDate: '2026-05-31',
    amount: 1999,
    paymentStatus: 'Refunded',
    status: 'Cancelled',
  },
];

export const MOCK_PAYMENTS: PaymentTransaction[] = [
  payment({
    transactionId: 'TXN10000431',
    subscriptionId: 'SUB000123',
    hostelName: 'ABC Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-09-01',
    paymentMethod: 'UPI',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0142',
  }),
  payment({
    transactionId: 'TXN10000430',
    subscriptionId: 'SUB000120',
    hostelName: 'City Center PG & Hostel',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-09-01',
    paymentMethod: 'UPI',
    paymentGateway: 'PhonePe',
    paymentStatus: 'Pending',
  }),
  payment({
    transactionId: 'TXN10000428',
    subscriptionId: 'SUB000119',
    hostelName: 'Royal Palms Luxury Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-09-10',
    paymentMethod: 'Card',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0141',
  }),
  payment({
    transactionId: 'TXN10000417',
    subscriptionId: 'SUB000119',
    hostelName: 'Royal Palms Luxury Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-08-10',
    paymentMethod: 'Card',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0128',
  }),
  payment({
    transactionId: 'TXN10000409',
    subscriptionId: 'SUB000120',
    hostelName: 'City Center PG & Hostel',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-08-01',
    paymentMethod: 'UPI',
    paymentGateway: 'PhonePe',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0119',
  }),
  payment({
    transactionId: 'TXN10000388',
    subscriptionId: 'SUB000122',
    hostelName: 'Lakeview Residency',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-07-01',
    paymentMethod: 'Card',
    paymentGateway: 'Cashfree',
    paymentStatus: 'Failed',
  }),
  payment({
    transactionId: 'TXN10000352',
    subscriptionId: 'SUB000122',
    hostelName: 'Lakeview Residency',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-06-01',
    paymentMethod: 'Card',
    paymentGateway: 'Cashfree',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0087',
  }),
  payment({
    transactionId: 'TXN10000311',
    subscriptionId: 'SUB000125',
    hostelName: 'Sunrise Boys Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-05-01',
    paymentMethod: 'Card',
    paymentGateway: 'PayU',
    paymentStatus: 'Refunded',
    invoiceNumber: 'INV-2026-0064',
  }),
  payment({
    transactionId: 'TXN10000276',
    subscriptionId: 'SUB000118',
    hostelName: 'Grand Stay Hostel',
    planName: 'Premium',
    billingCycle: 'Yearly',
    amount: 19999,
    paymentDate: '2026-04-01',
    paymentMethod: 'Net Banking',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0041',
  }),
  payment({
    transactionId: 'TXN10000154',
    subscriptionId: 'SUB000124',
    hostelName: 'Metro Stay PG',
    planName: 'Premium',
    billingCycle: 'Yearly',
    amount: 19999,
    paymentDate: '2025-11-01',
    paymentMethod: 'Bank Transfer',
    paymentGateway: 'Manual',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2025-0318',
  }),

  // ---- Earlier billing periods (renewals keep the same subscription ID) ----
  payment({
    transactionId: 'TXN10000398',
    subscriptionId: 'SUB000123',
    hostelName: 'ABC Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-08-01',
    paymentMethod: 'UPI',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0116',
  }),
  payment({
    transactionId: 'TXN10000371',
    subscriptionId: 'SUB000123',
    hostelName: 'ABC Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-07-01',
    paymentMethod: 'UPI',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0098',
  }),
  payment({
    transactionId: 'TXN10000402',
    subscriptionId: 'SUB000119',
    hostelName: 'Royal Palms Luxury Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-07-10',
    paymentMethod: 'Card',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0103',
  }),
  payment({
    transactionId: 'TXN10000384',
    subscriptionId: 'SUB000120',
    hostelName: 'City Center PG & Hostel',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-07-01',
    paymentMethod: 'UPI',
    paymentGateway: 'PhonePe',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0095',
  }),
  payment({
    transactionId: 'TXN10000329',
    subscriptionId: 'SUB000122',
    hostelName: 'Lakeview Residency',
    planName: 'Basic',
    billingCycle: 'Monthly',
    amount: 999,
    paymentDate: '2026-05-01',
    paymentMethod: 'Card',
    paymentGateway: 'Cashfree',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0061',
  }),
  payment({
    transactionId: 'TXN10000287',
    subscriptionId: 'SUB000125',
    hostelName: 'Sunrise Boys Hostel',
    planName: 'Standard',
    billingCycle: 'Monthly',
    amount: 1999,
    paymentDate: '2026-04-01',
    paymentMethod: 'Card',
    paymentGateway: 'PayU',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2026-0044',
  }),
  payment({
    transactionId: 'TXN10000118',
    subscriptionId: 'SUB000118',
    hostelName: 'Grand Stay Hostel',
    planName: 'Premium',
    billingCycle: 'Yearly',
    amount: 19999,
    paymentDate: '2025-04-01',
    paymentMethod: 'Net Banking',
    paymentGateway: 'Razorpay',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2025-0052',
  }),
  payment({
    transactionId: 'TXN10000061',
    subscriptionId: 'SUB000118',
    hostelName: 'Grand Stay Hostel',
    planName: 'Standard',
    billingCycle: 'Yearly',
    amount: 14999,
    paymentDate: '2024-04-01',
    paymentMethod: 'Bank Transfer',
    paymentGateway: 'Manual',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2024-0037',
  }),
  payment({
    transactionId: 'TXN10000044',
    subscriptionId: 'SUB000124',
    hostelName: 'Metro Stay PG',
    planName: 'Premium',
    billingCycle: 'Yearly',
    amount: 19999,
    paymentDate: '2024-11-01',
    paymentMethod: 'Bank Transfer',
    paymentGateway: 'Manual',
    paymentStatus: 'Paid',
    invoiceNumber: 'INV-2024-0291',
  }),
];
