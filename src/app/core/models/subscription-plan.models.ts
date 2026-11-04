export interface SubscriptionPlanRow {
  planId: string;
  planName: string;
  price: string;
  billingCycle: 'Monthly' | 'Yearly' | 'Quarterly';
  residentLimit: number;
  status: 'Active' | 'Inactive';
  createdDate: string;
  features?: string;
  featureConfig?: Record<string, boolean>;
}

export interface FeatureItem {
  id: string;
  name: string;
  icon: string;
  /** Icon tile colour in the plan dialog. */
  tone?: 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'pink' | 'indigo';
}

export const FEATURE_CONFIG_ITEMS: FeatureItem[] = [
  { id: 'residentManagement', name: 'Tenant Management', icon: 'groups', tone: 'blue' },
  { id: 'roomManagement', name: 'Room Management', icon: 'bed', tone: 'purple' },
  { id: 'payments', name: 'Payments', icon: 'payments', tone: 'green' },
  { id: 'complaints', name: 'Complaints', icon: 'chat_bubble', tone: 'orange' },
  { id: 'laundry', name: 'Laundry', icon: 'checkroom', tone: 'blue' },
  { id: 'washingMachine', name: 'Washing Machine', icon: 'local_laundry_service', tone: 'teal' },
  { id: 'visitors', name: 'Visitors', icon: 'groups_2', tone: 'purple' },
  { id: 'announcements', name: 'Announcements', icon: 'campaign', tone: 'blue' },
  { id: 'mess', name: 'Mess', icon: 'restaurant', tone: 'orange' },
  { id: 'attendance', name: 'Attendance', icon: 'event_available', tone: 'green' },
  { id: 'leaveOutpass', name: 'Leave / Outpass', icon: 'exit_to_app', tone: 'pink' },
  { id: 'parentAccess', name: 'Parent Access', icon: 'family_restroom', tone: 'teal' },
  { id: 'reports', name: 'Reports', icon: 'bar_chart', tone: 'indigo' },
];
