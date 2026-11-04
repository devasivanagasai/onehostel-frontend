export type CommunicationChannel = 'Email' | 'SMS' | 'Push Notification';

export const COMMUNICATION_CHANNELS: { value: CommunicationChannel; icon: string }[] = [
  { value: 'Email', icon: 'mail' },
  { value: 'SMS', icon: 'sms' },
  { value: 'Push Notification', icon: 'notifications_active' },
];

export const TEMPLATE_TRIGGERS: string[] = [
  'Hostel Owner Onboarding',
  'Hostel Onboarding',
  'Password Reset',
  'Subscription Activated',
  'Subscription Renewal Reminder',
  'Subscription Expired',
  'Account Blocked',
];

export interface TemplateVariable {
  key: string;
  label: string;
  sample: string;
}

/** Placeholders the system can substitute; `sample` feeds the side panel's live preview. */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: 'admin_name', label: 'Hostel Owner Name', sample: 'Ravi Kumar' },
  { key: 'hostel_name', label: 'Hostel Name', sample: 'Sunrise Boys Hostel' },
  { key: 'username', label: 'Username', sample: 'ravi.kumar' },
  { key: 'temporary_password', label: 'Temporary Password', sample: 'Tmp@4821' },
  { key: 'login_link', label: 'Login Link', sample: 'https://app.onehostel.in/login' },
];

export interface CommunicationTemplateRow {
  templateId: string;
  templateName: string;
  templateCode: string;
  channel: CommunicationChannel;
  trigger: string;
  subject: string;
  body: string;
  status: 'Active' | 'Inactive';
  /** ISO date; rendered as dd-MMM-yy in the table. */
  lastModified: string;
}
