// Resident fees & payments (Section 4.4). Distinct from platform subscription billing.

import { ResidentType } from './residents.models';

export const FEE_NAMES = ['Hostel Fee/Rent', 'Mess', 'Laundry', 'Maintenance', 'Other'] as const;
export type FeeName = (typeof FEE_NAMES)[number];

/** Configured fee categories. */
export const FEE_CATEGORIES = ['Accommodation', 'Food', 'Services', 'Utilities', 'Deposit', 'Other'] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const BILLING_FREQUENCIES = ['One-time', 'Monthly', 'Quarterly', 'Custom'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export type FeeStatus = 'Draft' | 'Active' | 'Inactive';
export const FEE_STATUSES: FeeStatus[] = ['Draft', 'Active', 'Inactive'];

/** Configured tax treatments: rate is added on top of the amount. */
export const TAX_OPTIONS = [
  { label: 'No tax', rate: 0 },
  { label: 'GST 5%', rate: 5 },
  { label: 'GST 12%', rate: 12 },
  { label: 'GST 18%', rate: 18 },
] as const;

export type DueRule =
  /** Due on this day of the billing period's first month (1–28). */
  | { type: 'day-of-period'; day: number }
  /** Due this many days after the charge is issued. */
  | { type: 'days-after-issue'; days: number }
  /** A fixed calendar date (one-time fees). */
  | { type: 'fixed-date'; date: string };

export interface LateFeeRule {
  type: 'Fixed' | 'Percentage';
  /** Fixed: currency amount. Percentage: % of the base amount. */
  value: number;
  /** Days after the due date before the late fee applies. */
  graceDays: number;
}

export type Applicability =
  | { mode: 'All' }
  | { mode: 'Types'; residentTypes: ResidentType[] }
  | { mode: 'Residents'; residentIds: string[] };

export interface FeeConfig {
  /** e.g. FEE001 */
  id: string;
  name: FeeName;
  /** Free-text label when name is "Other", or a more specific label (e.g. "Security Deposit"). */
  label?: string;
  category: FeeCategory;
  /** 'Bed rent' uses the allocated bed's monthly rent; falls back to `amount` when no bed. */
  amountSource: 'Fixed' | 'Bed rent';
  amount: number;
  frequency: BillingFrequency;
  /** Custom frequency only: months between charges. */
  customMonths?: number;
  /** ISO dates. */
  effectiveFrom?: string;
  effectiveTo?: string;
  dueRule: DueRule;
  lateFee?: LateFeeRule;
  /** Tax percent added on top (0 = no tax). */
  taxRate: number;
  applicability: Applicability;
  status: FeeStatus;
  createdAt: string;
  updatedAt: string;
}

export type ChargeStatus = 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'Cancelled';

/** A resident charge / invoice generated from a fee, or a one-time charge. */
export interface Charge {
  /** e.g. INV000001 */
  id: string;
  residentId: string;
  residentName: string;
  /** Source fee; undefined for authorised one-time charges. */
  feeId?: string;
  description: string;
  /** Billing period key, e.g. "2026-10" — prevents generating the same fee twice for a period. */
  period?: string;
  /** ISO date. */
  issueDate: string;
  /** ISO date. */
  dueDate: string;
  baseAmount: number;
  taxAmount: number;
  /** Applied once the charge is overdue past the grace period. */
  lateFeeAmount: number;
  /** baseAmount + taxAmount + lateFeeAmount */
  total: number;
  lateFeeRule?: LateFeeRule;
  /** ISO date-time of the last reminder. */
  lastReminderAt?: string;
  reminderCount: number;
  /** Adjustment: the charge is waived / closed. Kept for history, balance becomes 0. */
  cancelledAt?: string;
  cancelReason?: string;
  createdBy: string;
  createdAt: string;
}

export type PaymentStatus = 'Pending' | 'Successful' | 'Failed' | 'Reversed' | 'Refunded';
export const PAYMENT_STATUSES: PaymentStatus[] = ['Pending', 'Successful', 'Failed', 'Reversed', 'Refunded'];

export const OFFLINE_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'] as const;
export type PaymentMethod = (typeof OFFLINE_METHODS)[number] | 'Online';

/** Methods that must carry a transaction reference. */
export const REFERENCE_REQUIRED: PaymentMethod[] = ['UPI', 'Card', 'Bank Transfer', 'Online'];

export interface PaymentEvent {
  at: string;
  action: string;
  by: string;
  reason?: string;
}

export interface Payment {
  /** e.g. PAY000001 */
  id: string;
  /** Issued only once the payment is Successful, e.g. RCP000001. */
  receiptId?: string;
  residentId: string;
  residentName: string;
  chargeId: string;
  chargeDescription: string;
  /** Charge balance just before this payment. */
  amountDue: number;
  amount: number;
  method: PaymentMethod;
  transactionRef?: string;
  /** ISO date-time recorded. */
  paidAt: string;
  collectedBy: string;
  status: PaymentStatus;
  notes?: string;
  /** Reversal / refund reason. */
  reason?: string;
  history: PaymentEvent[];
}

export const feeDisplayName = (f: Pick<FeeConfig, 'name' | 'label'>): string => f.label?.trim() || f.name;

export const describeDueRule = (r: DueRule): string => {
  switch (r.type) {
    case 'day-of-period':
      return `Day ${r.day} of the period`;
    case 'days-after-issue':
      return `${r.days} days after issue`;
    case 'fixed-date':
      return `On ${r.date}`;
  }
};

export const describeLateFee = (r?: LateFeeRule): string =>
  !r ? 'None' : `${r.type === 'Fixed' ? '₹' + r.value : r.value + '%'} after ${r.graceDays} day${r.graceDays === 1 ? '' : 's'}`;

export const describeFrequency = (f: Pick<FeeConfig, 'frequency' | 'customMonths'>): string =>
  f.frequency === 'Custom' ? `Every ${f.customMonths ?? 1} months` : f.frequency;
