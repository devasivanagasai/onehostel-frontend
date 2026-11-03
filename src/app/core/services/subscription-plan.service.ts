import { Injectable } from '@angular/core';
import { SubscriptionPlanRow } from '../models/subscription-plan.models';

const SEED_PLANS: SubscriptionPlanRow[] = [
  {
    planId: 'PLN-1001',
    planName: 'Basic',
    price: '₹999 / mo',
    billingCycle: 'Monthly',
    residentLimit: 50,
    status: 'Active',
    createdDate: '2026-08-01',
  },
  {
    planId: 'PLN-1002',
    planName: 'Standard',
    price: '₹1,999 / mo',
    billingCycle: 'Monthly',
    residentLimit: 150,
    status: 'Active',
    createdDate: '2026-08-01',
  },
  {
    planId: 'PLN-1003',
    planName: 'Premium',
    price: '₹19,999 / yr',
    billingCycle: 'Yearly',
    residentLimit: 500,
    status: 'Active',
    createdDate: '2026-08-01',
  },
  {
    planId: 'PLN-1004',
    planName: 'Legacy Basic',
    price: '₹799 / mo',
    billingCycle: 'Monthly',
    residentLimit: 50,
    status: 'Inactive',
    createdDate: '2025-11-12',
  },
];

const STORAGE_KEY = 'onehostel_subscription_plans';

/**
 * Subscription plans, shared by the Plans screen and Onboard Hostel so a plan edited or
 * deactivated in one place is what the other offers. Kept in localStorage (UI-only build).
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionPlanService {
  private rows: SubscriptionPlanRow[] = this.read();

  get plans(): SubscriptionPlanRow[] {
    return this.rows;
  }

  /** Only active plans can be assigned to a new hostel. */
  get activePlans(): SubscriptionPlanRow[] {
    return this.rows.filter((p) => p.status === 'Active');
  }

  byName(name: string): SubscriptionPlanRow | undefined {
    return this.rows.find((p) => p.planName === name);
  }

  /** True when another plan (other than `exceptId`) already uses this name, ignoring case and spacing. */
  nameTaken(name: string, exceptId?: string): boolean {
    const key = name.trim().toLowerCase();
    return this.rows.some((p) => p.planId !== exceptId && p.planName.trim().toLowerCase() === key);
  }

  /** Adds a new plan at the top, or replaces the plan with the same ID. */
  save(plan: SubscriptionPlanRow): void {
    const index = this.rows.findIndex((p) => p.planId === plan.planId);
    this.rows = index === -1 ? [plan, ...this.rows] : this.rows.map((p, i) => (i === index ? plan : p));
    this.write();
  }

  private read(): SubscriptionPlanRow[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as SubscriptionPlanRow[]) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* fall back to the seed plans */
    }
    return [...SEED_PLANS];
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rows));
    } catch {
      /* storage unavailable; plans stay in memory */
    }
  }
}
