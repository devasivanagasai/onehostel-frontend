export interface PlanDetail {
  residentLimit: number;
  features: string[];
}

import { FEATURE_CONFIG_ITEMS, SubscriptionPlanRow } from '../../../core/models/subscription-plan.models';

export type PlanName = 'Basic' | 'Standard' | 'Premium';

/** Single source of truth for what each subscription plan unlocks — read by both Step 6 and the Confirmation step. */
export const PLAN_DETAILS: Record<PlanName, PlanDetail> = {
  Basic: {
    residentLimit: 50,
    features: ['Tenant Management', 'Basic Reports'],
  },
  Standard: {
    residentLimit: 150,
    features: ['Tenant Management', 'Basic Reports', 'Advanced Reports', 'SMS Notifications'],
  },
  Premium: {
    residentLimit: 500,
    features: [
      'Tenant Management',
      'Basic Reports',
      'Advanced Reports',
      'SMS Notifications',
      'API Access',
      'Priority Support',
    ],
  },
};

/** Limit and enabled modules of a plan from the Subscription Plans screen (falls back to the built-in defaults). */
export function planDetailFor(plan: SubscriptionPlanRow | undefined, fallbackName: string): PlanDetail {
  if (!plan) return PLAN_DETAILS[fallbackName as PlanName] ?? PLAN_DETAILS.Standard;
  const features = plan.featureConfig
    ? FEATURE_CONFIG_ITEMS.filter((f) => plan.featureConfig![f.id]).map((f) => f.name)
    : FEATURE_CONFIG_ITEMS.map((f) => f.name);
  return { residentLimit: plan.residentLimit, features };
}
