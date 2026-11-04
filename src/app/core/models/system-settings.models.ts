export type SettingsSection = 'general' | 'security' | 'communication' | 'payment' | 'fees';

export interface GeneralSettings {
  applicationName: string;
  /** Data URL of the uploaded logo; empty = default brand mark. */
  logoDataUrl: string;
  logoFileName: string;
  supportEmail: string;
  supportPhoneCode: string;
  supportPhone: string;
  defaultCountry: string;
  currency: string;
  timeZone: string;
  dateFormat: string;
}

/** Password, lockout and session policy for every user (sign-in is password-only). */
export interface SecuritySettings {
  minPasswordLength: number;
  /** Password format rules, enforced on Change Password. */
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
  /** Days before a password must be changed; 0 = never expires. */
  passwordExpiryDays: number;
  maxLoginAttempts: number;
  sessionTimeoutMinutes: number;
}

export interface CommunicationSettings {
  emailProvider: string;
  emailSenderName: string;
  emailSenderAddress: string;
  /** API-based providers (SendGrid, SES, Mailgun). */
  emailApiKey: string;
  /** SMTP only. */
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;

  smsProvider: string;
  smsSenderId: string;
  smsApiKey: string;

  pushEnabled: boolean;
  pushProvider: string;
  pushProjectId: string;
  pushServerKey: string;
}

export interface PaymentSettings {
  paymentGateway: string;
  gatewayMode: 'Test' | 'Live';
  gatewayKeyId: string;
  gatewayKeySecret: string;
  currency: string;
  invoicePrefix: string;
}

export type LateFeeType = 'Fixed' | 'Percentage';

/** Tax and extra charges on subscription payments (Settings → Fees). */
export interface FeeSettings {
  gstEnabled: boolean;
  /** Percent, e.g. 18. */
  gstRate: number;
  gstin: string;
  /** true = plan prices already include GST. */
  pricesIncludeTax: boolean;
  /** Charge a fee when a payment is made after the due date + grace period. */
  lateFeeEnabled: boolean;
  lateFeeType: LateFeeType;
  /** Fixed: currency amount. Percentage: % of the amount due. */
  lateFeeValue: number;
  /** Days after the due date before the fee applies. */
  lateFeeGraceDays: number;
}

export interface SystemSettings {
  general: GeneralSettings;
  security: SecuritySettings;
  communication: CommunicationSettings;
  payment: PaymentSettings;
  fees: FeeSettings;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  general: {
    applicationName: 'OneHostel',
    logoDataUrl: '',
    logoFileName: '',
    supportEmail: 'support@onehostel.in',
    supportPhoneCode: '+91',
    supportPhone: '9876543210',
    defaultCountry: 'India',
    currency: 'INR',
    timeZone: 'Asia/Kolkata',
    dateFormat: 'dd-MMM-yy',
  },
  security: {
    minPasswordLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: true,
    passwordExpiryDays: 90,
    maxLoginAttempts: 5,
    sessionTimeoutMinutes: 30,
  },
  communication: {
    emailProvider: 'SendGrid',
    emailSenderName: 'OneHostel',
    emailSenderAddress: 'no-reply@onehostel.in',
    emailApiKey: 'SG.demo-key-4f9a',
    smtpHost: '',
    smtpPort: 587,
    smtpUsername: '',
    smtpPassword: '',
    smsProvider: 'MSG91',
    smsSenderId: 'ONEHST',
    smsApiKey: 'msg91-demo-key-77c2',
    pushEnabled: true,
    pushProvider: 'Firebase Cloud Messaging',
    pushProjectId: 'onehostel-prod',
    pushServerKey: 'fcm-demo-key-19bd',
  },
  payment: {
    paymentGateway: 'Razorpay',
    gatewayMode: 'Test',
    gatewayKeyId: 'rzp_test_1DP5mmOlF5G5ag',
    gatewayKeySecret: 'rzp-demo-secret-a81e',
    currency: 'INR',
    invoicePrefix: 'INV-',
  },
  fees: {
    gstEnabled: true,
    gstRate: 18,
    gstin: '36AABCO1234F1Z5',
    pricesIncludeTax: false,
    lateFeeEnabled: true,
    lateFeeType: 'Fixed',
    lateFeeValue: 100,
    lateFeeGraceDays: 5,
  },
};

/** Keys whose values are credentials: masked in the UI and never written to the audit log. */
export const SECRET_SETTING_KEYS = new Set<string>([
  'emailApiKey',
  'smtpPassword',
  'smsApiKey',
  'pushServerKey',
  'gatewayKeySecret',
]);

/** Human labels, used for the audit log's old → new table. */
export const SETTING_LABELS: Record<SettingsSection, Record<string, string>> = {
  general: {
    applicationName: 'Application Name',
    logoFileName: 'Logo',
    supportEmail: 'Support Email',
    supportPhoneCode: 'Support Mobile Code',
    supportPhone: 'Support Mobile Number',
    defaultCountry: 'Default Country',
    currency: 'Currency',
    timeZone: 'Time Zone',
    dateFormat: 'Date Format',
  },
  security: {
    minPasswordLength: 'Minimum Password Length',
    requireUppercase: 'Require Uppercase Letter',
    requireLowercase: 'Require Lowercase Letter',
    requireNumber: 'Require Number',
    requireSpecialChar: 'Require Special Character',
    passwordExpiryDays: 'Password Expiry (days)',
    maxLoginAttempts: 'Maximum Login Attempts',
    sessionTimeoutMinutes: 'Session Timeout (min)',
  },
  communication: {
    emailProvider: 'Email Provider',
    emailSenderName: 'Sender Name',
    emailSenderAddress: 'Sender Email',
    emailApiKey: 'Email API Key',
    smtpHost: 'SMTP Host',
    smtpPort: 'SMTP Port',
    smtpUsername: 'SMTP Username',
    smtpPassword: 'SMTP Password',
    smsProvider: 'SMS Provider',
    smsSenderId: 'SMS Sender ID',
    smsApiKey: 'SMS API Key',
    pushEnabled: 'Push Notifications',
    pushProvider: 'Push Provider',
    pushProjectId: 'Push Project / App ID',
    pushServerKey: 'Push Server Key',
  },
  payment: {
    paymentGateway: 'Payment Gateway',
    gatewayMode: 'Gateway Mode',
    gatewayKeyId: 'Gateway Key ID',
    gatewayKeySecret: 'Gateway Key Secret',
    currency: 'Currency',
    invoicePrefix: 'Invoice Prefix',
  },
  fees: {
    gstEnabled: 'GST Enabled',
    gstRate: 'GST Rate (%)',
    gstin: 'GSTIN',
    pricesIncludeTax: 'Prices Include Tax',
    lateFeeEnabled: 'Late Payment Fee',
    lateFeeType: 'Late Fee Type',
    lateFeeValue: 'Late Fee Amount / Rate',
    lateFeeGraceDays: 'Late Fee Grace Period (days)',
  },
};

export const SECTION_TITLES: Record<SettingsSection, string> = {
  general: 'General Settings',
  security: 'Security Settings',
  communication: 'Communication Settings',
  payment: 'Payment Settings',
  fees: 'Fee Settings',
};

// ---- Option lists ----

export const COUNTRY_OPTIONS = [
  { name: 'India', dialCode: '+91' },
  { name: 'United Arab Emirates', dialCode: '+971' },
  { name: 'United Kingdom', dialCode: '+44' },
  { name: 'United States', dialCode: '+1' },
  { name: 'Singapore', dialCode: '+65' },
];

export const CURRENCY_OPTIONS = [
  { code: 'INR', label: 'INR — Indian Rupee (₹)' },
  { code: 'AED', label: 'AED — UAE Dirham (د.إ)' },
  { code: 'GBP', label: 'GBP — British Pound (£)' },
  { code: 'USD', label: 'USD — US Dollar ($)' },
  { code: 'SGD', label: 'SGD — Singapore Dollar (S$)' },
];

export const TIME_ZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: '(UTC+05:30) India Standard Time — Kolkata' },
  { value: 'Asia/Dubai', label: '(UTC+04:00) Gulf Standard Time — Dubai' },
  { value: 'Asia/Singapore', label: '(UTC+08:00) Singapore Time' },
  { value: 'Europe/London', label: '(UTC+00:00) Greenwich Mean Time — London' },
  { value: 'America/New_York', label: '(UTC−05:00) Eastern Time — New York' },
];

/** Angular DatePipe formats. */
export const DATE_FORMAT_OPTIONS = ['dd-MMM-yy', 'dd-MMM-yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];

export const PASSWORD_EXPIRY_OPTIONS = [
  { days: 0, label: 'Never' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '365 days' },
];

export const EMAIL_PROVIDERS = ['SendGrid', 'Amazon SES', 'Mailgun', 'SMTP'];
export const SMS_PROVIDERS = ['MSG91', 'Twilio', 'Gupshup', 'Textlocal'];
export const PUSH_PROVIDERS = ['Firebase Cloud Messaging', 'OneSignal'];
export const PAYMENT_GATEWAYS = ['Razorpay', 'PayU', 'Cashfree', 'PhonePe'];
