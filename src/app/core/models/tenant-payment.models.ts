// Tenant fees & payments (FRD 5.5): the Tenant's view of invoices, the simulated gateway attempt and the transaction list.

import { PaymentStatus } from './fees.models';

export type TenantInvoiceStatus = 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Waived' | 'Cancelled';
export const TENANT_INVOICE_STATUSES: TenantInvoiceStatus[] = ['Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Waived', 'Cancelled'];

/** Payment methods the Tenant can use at the (simulated) gateway. */
export const TENANT_PAYMENT_METHODS = ['UPI', 'Card', 'Net Banking'] as const;
export type TenantPaymentMethod = (typeof TENANT_PAYMENT_METHODS)[number];

export const TENANT_PAYMENT_METHOD_ICONS: Record<TenantPaymentMethod, string> = {
  UPI: 'qr_code_2',
  Card: 'credit_card',
  'Net Banking': 'account_balance',
};

/** Billing policy applied to Tenant payments. Mirrors what FeesService.recordPayment enforces for staff. */
export interface TenantPaymentPolicy {
  /** Pay part of an invoice. */
  allowPartial: boolean;
  /** Pay more than the outstanding amount. Off: the amount may never exceed the outstanding balance. */
  allowAdvance: boolean;
  minAmount: number;
}

export type TenantTransactionStatus = 'Initiated' | 'Pending' | 'Successful' | 'Failed' | 'Refunded' | 'Reversed';

/** One invoice (a resident charge) as the Tenant sees it. */
export interface TenantInvoice {
  id: string;
  feeType: string;
  description: string;
  /** e.g. "Oct 2026", or "One-time". */
  period: string;
  issueDate: string;
  dueDate: string;
  baseAmount: number;
  taxAmount: number;
  lateFeeAmount: number;
  total: number;
  paid: number;
  outstanding: number;
  status: TenantInvoiceStatus;
  /** Gateway payment awaiting a result (Initiated or Pending): blocks starting another payment. */
  activeAttemptRef?: string;
  /** Amount held by Pending payments. */
  pendingAmount: number;
}

export type TenantAttemptStatus = 'Initiated' | 'Pending' | 'Successful' | 'Failed';

/** A payment attempt through the gateway. Only a confirmed result changes the invoice. */
export interface TenantPaymentAttempt {
  /** Gateway reference, e.g. GW-LX9K2A4F. */
  ref: string;
  /** Client-generated key; a repeated submit with the same key returns this attempt instead of making a new one. */
  idempotencyKey: string;
  residentId: string;
  invoiceId: string;
  amount: number;
  method: TenantPaymentMethod;
  status: TenantAttemptStatus;
  /** The FeesService payment created when the gateway first reported Pending / Successful. */
  paymentId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantTransaction {
  ref: string;
  invoiceId: string;
  invoiceLabel: string;
  amount: number;
  method: string;
  status: TenantTransactionStatus;
  /** Local date-time. */
  date: string;
  receiptNumber?: string;
  paymentId?: string;
  note?: string;
}

export interface TenantFeesSummary {
  outstandingTotal: number;
  nextDue?: { date: string; invoiceId: string; amount: number };
  latestPayment?: { status: TenantTransactionStatus; amount: number; date: string };
  overdueCount: number;
}

export type GatewayResult = 'success' | 'failed' | 'pending';

/** Badge tone per status, for the shared status-badge styles. */
export const INVOICE_TONES: Record<TenantInvoiceStatus, string> = {
  Unpaid: 'info',
  'Partially Paid': 'warning',
  Paid: 'success',
  Overdue: 'danger',
  Waived: 'neutral',
  Cancelled: 'neutral',
};

export const TRANSACTION_TONES: Record<TenantTransactionStatus, string> = {
  Initiated: 'info',
  Pending: 'warning',
  Successful: 'success',
  Failed: 'danger',
  Refunded: 'neutral',
  Reversed: 'neutral',
};
