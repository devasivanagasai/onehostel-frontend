/** One Tenant web page: its route, menu entry and the subscription feature that switches it on. */
export interface TenantModule {
  /** Short key, also the route segment ("/my/<key>"). */
  key: string;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
  group: 'My Stay' | 'Requests & Updates' | 'Daily Services' | 'More';
  /** Subscription feature id (see FEATURE_CONFIG_ITEMS); omitted when the page is always available. */
  feature?: string;
  /** Only for College Hostels. */
  collegeOnly?: boolean;
}

export const TENANT_MODULES: TenantModule[] = [
  { key: 'profile', label: 'My Profile', icon: 'person', title: 'My Profile', subtitle: 'Your details, documents and profile update requests', group: 'My Stay' },
  { key: 'hostel', label: 'My Hostel & Room', icon: 'meeting_room', title: 'My Hostel & Room', subtitle: 'Your room, bed, hostel rules and contacts', group: 'My Stay' },
  { key: 'fees', label: 'Fees & Payments', icon: 'payments', title: 'Fees & Payments', subtitle: 'Invoices, dues, payments and receipts', group: 'My Stay', feature: 'payments' },
  { key: 'activity', label: 'Activity History', icon: 'history', title: 'Activity History', subtitle: 'Your payments, complaints, bookings, visitors, leave and parcels', group: 'My Stay' },

  { key: 'complaints', label: 'Complaints', icon: 'build_circle', title: 'Complaints & Maintenance', subtitle: 'Raise an issue and track it to resolution', group: 'Requests & Updates', feature: 'complaints' },
  { key: 'announcements', label: 'Announcements', icon: 'campaign', title: 'Announcements', subtitle: 'Notices published by your hostel', group: 'Requests & Updates', feature: 'announcements' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications', title: 'Notifications', subtitle: 'Alerts about your account, dues, requests and notices', group: 'Requests & Updates' },
  { key: 'support', label: 'Help & Support', icon: 'support_agent', title: 'Help & Support', subtitle: 'Contact the hostel office and track your support requests', group: 'Requests & Updates' },

  { key: 'laundry', label: 'Laundry & Machines', icon: 'local_laundry_service', title: 'Laundry & Washing Machine', subtitle: 'Book a slot and manage your bookings', group: 'Daily Services', feature: 'laundry' },
  { key: 'visitors', label: 'Visitor Requests', icon: 'badge', title: 'Visitor Requests', subtitle: 'Request a visit and follow its approval', group: 'Daily Services', feature: 'visitors' },
  { key: 'mess', label: 'Mess & Food', icon: 'restaurant_menu', title: 'Mess & Food', subtitle: 'Menus, timings, your meal plan and feedback', group: 'Daily Services', feature: 'mess' },
  { key: 'leave', label: 'Leave & Outpass', icon: 'exit_to_app', title: 'Leave & Outpass', subtitle: 'Request leave or an outpass and see the decision', group: 'Daily Services', feature: 'leaveOutpass' },
  { key: 'attendance', label: 'Attendance', icon: 'fact_check', title: 'Attendance', subtitle: 'Your attendance history and correction requests', group: 'Daily Services', feature: 'attendance' },
  { key: 'parcels', label: 'Parcels', icon: 'inventory_2', title: 'Parcel Tracking', subtitle: 'Parcels received for you and their pickup status', group: 'Daily Services' },
  { key: 'events', label: 'Events', icon: 'event', title: 'Hostel Events', subtitle: 'Upcoming events and RSVP', group: 'Daily Services' },

  { key: 'guardians', label: 'Guardian Access', icon: 'family_restroom', title: 'Parent / Guardian Access', subtitle: 'Who can receive your alerts, and what they can see', group: 'More', feature: 'parentAccess' },
  { key: 'academic', label: 'Academic Info', icon: 'school', title: 'Student & Academic Information', subtitle: 'Institution, course and academic year', group: 'More', collegeOnly: true },
  { key: 'documents', label: 'Documents', icon: 'folder_open', title: 'Digital Documents', subtitle: 'Your letters, receipts, rules and uploads', group: 'More' },
  { key: 'room-transfer', label: 'Room Transfer', icon: 'swap_horiz', title: 'Room Transfer Request', subtitle: 'Ask for a different room or bed', group: 'More' },
  { key: 'surveys', label: 'Feedback & Surveys', icon: 'rate_review', title: 'Feedback & Surveys', subtitle: 'Respond to hostel surveys', group: 'More' },
  { key: 'community', label: 'Lost & Found', icon: 'travel_explore', title: 'Community & Lost-and-Found', subtitle: 'Report lost or found items and claim yours', group: 'More' },
  { key: 'preferences', label: 'Preferences', icon: 'tune', title: 'Preferences & Accessibility', subtitle: 'Notifications, theme, text size, language and privacy', group: 'More' },
];

export const tenantRoute = (key: string): string => `/my/${key}`;

export const tenantModuleForUrl = (url: string): TenantModule | undefined =>
  TENANT_MODULES.find((m) => url.split(/[?#]/)[0].startsWith(tenantRoute(m.key)));
