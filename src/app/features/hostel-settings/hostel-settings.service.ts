import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuditLogService } from '../../core/services/audit-log.service';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { AuditChange, diffForAudit } from '../../core/models/audit.models';
import { BUILT_IN_HOSTEL_OWNER } from '../../core/models/built-in-accounts';
import { FEATURE_CONFIG_ITEMS } from '../subscription-plans/add-plan-side-panel.component';
import { RoomsService } from '../rooms-management/rooms.service';
import { ResidentsService } from '../residents/residents.service';
import {
  HostelSettingsPermissions,
  HostelSettingsState,
  HostelSettingsValue,
  HostelSubscription,
  LimitKey,
  NOTIFICATION_EVENTS,
  NotificationChannel,
  NotificationPrefs,
} from './hostel-settings.models';

const STORAGE_KEY = 'onehostel_hostel_settings_';
const HOSTEL_ID = BUILT_IN_HOSTEL_OWNER.hostelId;

const PROFILE_LABELS: Record<string, string> = {
  logoFileName: 'Logo',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  state: 'State',
  pincode: 'PIN Code',
  phone: 'Contact Phone',
  email: 'Contact Email',
  website: 'Website',
};

const RULE_LABELS: Record<string, string> = {
  checkInTime: 'Check-in Time',
  checkOutTime: 'Check-out Time',
  gateClosingTime: 'Gate Closing Time',
  visitorsAllowed: 'Visitors Allowed',
  visitingFrom: 'Visiting From',
  visitingTo: 'Visiting To',
  maxVisitors: 'Max Visitors',
  visitorIdRequired: 'Visitor ID Required',
};

/** Modules on the Standard plan (ids from Subscription Plans → features). */
const STANDARD_MODULES = new Set([
  'residentManagement', 'roomManagement', 'payments', 'complaints', 'visitors', 'announcements', 'attendance', 'reports',
]);

/** The hostel's subscription, assigned by SuperAdmin (Standard plan in Subscription Plans). */
const SUBSCRIPTION: HostelSubscription = {
  planId: 'PLN-1002',
  planName: 'Standard',
  billingCycle: 'Monthly',
  price: '₹1,999 / mo',
  status: 'Active',
  startDate: '2026-04-15',
  expiryDate: '2026-11-15',
  limits: { rooms: 40, beds: 150, residents: 150, staffUsers: 5 },
  staffUsersUsed: 3,
  modules: Object.fromEntries(FEATURE_CONFIG_ITEMS.map((f) => [f.id, STANDARD_MODULES.has(f.id)])),
  channels: { inApp: true, push: true, email: true, sms: false },
};

function seedNotifications(): NotificationPrefs {
  const on = (email: boolean) => ({ inApp: true, push: true, email, sms: false });
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((e) => [e.key, on(e.key === 'paymentReceived' || e.key === 'feeDueReminder')]),
  ) as NotificationPrefs;
}

function seedState(): HostelSettingsState {
  return {
    hostelId: HOSTEL_ID,
    hostelType: 'Regular Hostel',
    value: {
      profile: {
        hostelName: BUILT_IN_HOSTEL_OWNER.hostelName,
        logoDataUrl: '',
        logoFileName: '',
        addressLine1: 'Plot 42, Road No. 3, Madhapur',
        addressLine2: 'Near Cyber Towers',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
        phone: BUILT_IN_HOSTEL_OWNER.mobileNumber,
        email: BUILT_IN_HOSTEL_OWNER.email,
        website: '',
      },
      rules: {
        checkInTime: '12:00',
        checkOutTime: '11:00',
        gateClosingTime: '22:30',
        visitorsAllowed: true,
        visitingFrom: '10:00',
        visitingTo: '19:00',
        maxVisitors: 2,
        visitorIdRequired: true,
        houseRules: [
          'Keep your room and common areas clean.',
          'No smoking or alcohol on the premises.',
          'Inform the warden before staying out overnight.',
          'Switch off lights, fans and AC when leaving the room.',
        ],
      },
      facilities: ['Wi-Fi', 'Power Backup', 'Geyser / Hot Water', 'RO Drinking Water', 'CCTV Security', 'Daily Housekeeping'],
      notifications: seedNotifications(),
    },
    pendingNameChange: null,
    upgradeRequest: null,
    updatedAt: null,
  };
}

export interface SaveResult {
  /** Set when the hostel name change was sent for SuperAdmin approval. */
  nameRequested: string | null;
  changed: boolean;
}

/**
 * Hostel Owner's own hostel profile, rules, facilities and notification preferences.
 *
 * UI-only build: kept in localStorage per hostel. Subscription details and permissions
 * come from SuperAdmin and are read-only here — swap for API calls once the backend exists.
 */
@Injectable({ providedIn: 'root' })
export class HostelSettingsService {
  private readonly auditLog = inject(AuditLogService);
  private readonly systemSettings = inject(SystemSettingsService);
  private readonly roomsService = inject(RoomsService);
  private readonly residentsService = inject(ResidentsService);

  private readonly stateSubject = new BehaviorSubject<HostelSettingsState>(this.load());
  readonly state$: Observable<HostelSettingsState> = this.stateSubject.asObservable();

  readonly permissions: HostelSettingsPermissions = {
    canEditIdentity: true,
    identityChangeNeedsApproval: true,
    canEditContact: true,
    canEditFacilities: true,
  };

  readonly subscription = SUBSCRIPTION;

  get state(): HostelSettingsState {
    return this.stateSubject.value;
  }

  /** Current usage against each plan limit. */
  usage(): Record<LimitKey, number> {
    const rooms = this.roomsService.rooms.filter((r) => r.hostelId === HOSTEL_ID);
    return {
      rooms: rooms.length,
      beds: rooms.reduce((n, r) => n + r.beds.length, 0),
      residents: this.residentsService.residents.filter((r) => r.status !== 'Checked Out').length,
      staffUsers: this.subscription.staffUsersUsed,
    };
  }

  /**
   * Why a channel can't be used, or null when it can. The platform must have a provider
   * configured (Settings → Communication) and the plan must include the channel.
   */
  channelBlockedReason(channel: NotificationChannel): string | null {
    const c = this.systemSettings.settings.communication;
    const platformOn: Record<NotificationChannel, boolean> = {
      inApp: true,
      push: c.pushEnabled,
      email: !!(c.emailApiKey || c.smtpHost),
      sms: !!c.smsApiKey,
    };
    if (!platformOn[channel]) return 'Not enabled on the platform';
    if (!this.subscription.channels[channel]) return 'Not in your plan';
    return null;
  }

  /**
   * Saves the edited settings. A new hostel name is not applied — it becomes a
   * pending request for SuperAdmin approval and the current name stays.
   */
  save(next: HostelSettingsValue): SaveResult {
    const current = this.state;
    const prev = current.value;
    const requestedName = next.profile.hostelName.trim();
    const nameChanged = requestedName !== prev.profile.hostelName;

    let nameRequested: string | null = null;
    let pendingNameChange = current.pendingNameChange;
    let hostelName = prev.profile.hostelName;
    if (nameChanged && this.permissions.canEditIdentity) {
      if (this.permissions.identityChangeNeedsApproval) {
        nameRequested = requestedName;
        pendingNameChange = { requestedName, requestedAt: new Date().toISOString() };
        this.auditLog.record('Update Hostel', prev.profile.hostelName, {
          details: `Name change requested → "${requestedName}" (pending SuperAdmin approval)`,
        });
      } else {
        hostelName = requestedName;
      }
    }

    const value: HostelSettingsValue = { ...next, profile: { ...next.profile, hostelName } };
    const changes = this.auditChanges(prev, value);
    if (changes.length) this.auditLog.record('Update Hostel', hostelName, { changes });

    const changed = changes.length > 0 || !!nameRequested;
    if (changed) {
      this.commit({ ...current, value, pendingNameChange, updatedAt: new Date().toISOString() });
    }
    return { nameRequested, changed };
  }

  withdrawNameChange(): void {
    const pending = this.state.pendingNameChange;
    if (!pending) return;
    this.commit({ ...this.state, pendingNameChange: null });
    this.auditLog.record('Update Hostel', this.state.value.profile.hostelName, {
      details: `Name change request withdrawn ("${pending.requestedName}")`,
    });
  }

  /** Records a plan upgrade request for SuperAdmin / billing review. Nothing about the plan changes here. */
  requestUpgrade(desiredPlan: string, note: string): void {
    this.commit({
      ...this.state,
      upgradeRequest: { desiredPlan, note: note.trim(), requestedAt: new Date().toISOString() },
    });
  }

  private auditChanges(prev: HostelSettingsValue, next: HostelSettingsValue): AuditChange[] {
    const rec = (o: object) => o as Record<string, unknown>;
    const changes = [
      ...diffForAudit(rec(prev.profile), rec(next.profile), PROFILE_LABELS),
      ...diffForAudit(rec(prev.rules), rec(next.rules), RULE_LABELS),
    ];
    if (prev.profile.logoDataUrl !== next.profile.logoDataUrl && !changes.some((c) => c.field === 'Logo')) {
      changes.push({ field: 'Logo', oldValue: prev.profile.logoFileName || '—', newValue: 'Replaced' });
    }
    const list = (v: string[]) => v.join(', ') || '—';
    if (list(prev.rules.houseRules) !== list(next.rules.houseRules)) {
      changes.push({ field: 'House Rules', oldValue: `${prev.rules.houseRules.length} rules`, newValue: `${next.rules.houseRules.length} rules` });
    }
    if (list([...prev.facilities].sort()) !== list([...next.facilities].sort())) {
      changes.push({ field: 'Facilities', oldValue: list(prev.facilities), newValue: list(next.facilities) });
    }
    if (JSON.stringify(prev.notifications) !== JSON.stringify(next.notifications)) {
      changes.push({ field: 'Notification Preferences', oldValue: '—', newValue: 'Updated' });
    }
    return changes;
  }

  private commit(state: HostelSettingsState): void {
    this.stateSubject.next(state);
    try {
      localStorage.setItem(STORAGE_KEY + HOSTEL_ID, JSON.stringify(state));
    } catch {
      // Storage full (large logo) or blocked — keep the in-memory state for this session.
    }
  }

  /** Stored state merged over the seed, so settings added later still get a value. */
  private load(): HostelSettingsState {
    const seed = seedState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY + HOSTEL_ID);
      if (!raw) return seed;
      const stored = JSON.parse(raw) as Partial<HostelSettingsState>;
      const v = stored.value ?? seed.value;
      return {
        ...seed,
        ...stored,
        hostelType: seed.hostelType,
        value: {
          profile: { ...seed.value.profile, ...v.profile },
          rules: { ...seed.value.rules, ...v.rules },
          facilities: v.facilities ?? seed.value.facilities,
          notifications: Object.fromEntries(
            NOTIFICATION_EVENTS.map((e) => [e.key, { ...seed.value.notifications[e.key], ...v.notifications?.[e.key] }]),
          ) as NotificationPrefs,
        },
      };
    } catch {
      return seed;
    }
  }
}
