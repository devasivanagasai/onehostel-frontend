import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { HostelSettingsService } from './hostel-settings.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationCategory } from './tenant-notification.service';
import {
  ESSENTIAL_CATEGORIES,
  LANGUAGES,
  NOTIFICATION_CATEGORIES,
  NotificationPrefsMap,
  PREF_CHANNELS,
  PrefChannel,
  TEXT_SCALE,
  TEXT_SIZES,
  THEMES,
  TenantLanguage,
  TenantPreferences,
  TenantTextSize,
  TenantTheme,
} from '../models/tenant-preferences.models';
import { localDateIso } from '../../shared/utils/local-date';

const STORAGE_KEY = 'onehostel_tenant_preferences_v1';
const ACCOUNTS_KEY = 'onehostel_tenant_accounts_v1';

const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${d.toTimeString().slice(0, 8)}`;
};

/** True when the app ships a dark theme (`.dark-theme` rules exist in src/styles/_colors.scss and _theme.scss). */
export const DARK_THEME_SUPPORTED = true;

/**
 * Per-Tenant preferences kept in this browser (FRD 7.8). Essential notification categories can never be
 * switched off; SMS / email only work when the hostel's plan includes the channel.
 * `allows(category, channel)` is what notification routing should ask before sending.
 */
@Injectable({ providedIn: 'root' })
export class TenantPreferencesService {
  private readonly tenant = inject(TenantContextService);
  private readonly settings = inject(HostelSettingsService);
  private readonly store = new BehaviorSubject<Record<string, TenantPreferences>>(this.load());
  private mediaBound = false;

  readonly languages = LANGUAGES;
  readonly themes = THEMES;
  readonly textSizes = TEXT_SIZES;
  readonly channels = PREF_CHANNELS;
  readonly categories = NOTIFICATION_CATEGORIES;
  readonly darkThemeSupported = DARK_THEME_SUPPORTED;

  /** The signed-in Tenant's preferences (defaults for anyone without saved ones). */
  readonly mine$: Observable<TenantPreferences> = this.store.pipe(map(() => this.mine));

  constructor() {
    if (this.tenant.residentId) this.apply();
  }

  get mine(): TenantPreferences {
    const me = this.tenant.residentId;
    const saved = me ? this.store.value[me] : undefined;
    return saved ? this.normalise(saved) : this.defaults();
  }

  isEssential(category: TenantNotificationCategory): boolean {
    return ESSENTIAL_CATEGORIES.includes(category);
  }

  /** Why a channel cannot be used (empty when it can): the hostel plan must include it. */
  channelBlocked(channel: PrefChannel): string {
    return this.settings.subscription.channels[channel] ? '' : 'Not included in your hostel plan';
  }

  /** Should a notification of this category go out on this channel for this Tenant? */
  allows(category: TenantNotificationCategory, channel: PrefChannel, residentId?: string): boolean {
    if (this.channelBlocked(channel)) return false;
    if (this.isEssential(category)) return true;
    const id = residentId ?? this.tenant.residentId;
    const saved = id ? this.store.value[id] : undefined;
    return (saved ? this.normalise(saved) : this.defaults()).notifications[category]?.[channel] ?? false;
  }

  setNotification(category: TenantNotificationCategory, channel: PrefChannel, on: boolean): TenantPreferences {
    const me = this.tenant.requireResidentId();
    if (!NOTIFICATION_CATEGORIES.some((c) => c.key === category)) throw new Error('Unknown notification category.');
    if (!PREF_CHANNELS.some((c) => c.key === channel)) throw new Error('Unknown channel.');
    if (this.isEssential(category) && !on) throw new Error(`${category} notifications are essential and cannot be switched off.`);
    const blocked = this.channelBlocked(channel);
    if (on && blocked) throw new Error(`${PREF_CHANNELS.find((c) => c.key === channel)!.label} is unavailable: ${blocked.toLowerCase()}.`);
    const cur = this.mine;
    return this.commit(me, { ...cur, notifications: { ...cur.notifications, [category]: { ...cur.notifications[category], [channel]: on } } });
  }

  setLanguage(language: TenantLanguage): TenantPreferences {
    const me = this.tenant.requireResidentId();
    if (!LANGUAGES.includes(language)) throw new Error('Choose English, Hindi or Telugu.');
    return this.commit(me, { ...this.mine, language });
  }

  setTheme(theme: TenantTheme): TenantPreferences {
    const me = this.tenant.requireResidentId();
    if (!THEMES.includes(theme)) throw new Error('Choose System, Light or Dark.');
    return this.commit(me, { ...this.mine, theme });
  }

  setTextSize(textSize: TenantTextSize): TenantPreferences {
    const me = this.tenant.requireResidentId();
    if (!TEXT_SIZES.includes(textSize)) throw new Error('Choose Normal, Large or Extra large.');
    return this.commit(me, { ...this.mine, textSize });
  }

  /** Biometric sign-in is only a stored preference here; turning it on needs a browser that supports WebAuthn. */
  setBiometric(on: boolean): TenantPreferences {
    const me = this.tenant.requireResidentId();
    if (on && !this.biometricSupported) throw new Error('Biometric sign-in is not available in this browser.');
    return this.commit(me, { ...this.mine, biometric: on });
  }

  get biometricSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
  }

  /** Whether a device authenticator (fingerprint / face / PIN) is present. */
  async biometricAvailable(): Promise<boolean> {
    try {
      if (!this.biometricSupported) return false;
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /** Back to defaults. Essential categories stay on either way. */
  reset(): TenantPreferences {
    const me = this.tenant.requireResidentId();
    return this.commit(me, this.defaults());
  }

  /** When the Tenant gave consent: from their sign-in account, or null for the built-in demo Tenant. */
  get consentRecordedAt(): string | null {
    const me = this.tenant.residentId;
    if (!me) return null;
    try {
      const raw = localStorage.getItem(ACCOUNTS_KEY);
      const list = raw ? (JSON.parse(raw) as { residentId: string; consentAt?: string }[]) : [];
      return (Array.isArray(list) ? list.find((a) => a.residentId === me)?.consentAt : undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** Applies theme and text size to the page. Call when the page opens and after every save. */
  apply(prefs: TenantPreferences = this.mine): void {
    if (typeof document === 'undefined') return;
    const dark = prefs.theme === 'Dark' || (prefs.theme === 'System' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-theme', DARK_THEME_SUPPORTED && dark);
    const scale = TEXT_SCALE[prefs.textSize];
    document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
    document.documentElement.style.setProperty('--tenant-text-scale', String(scale / 100));
    if (!this.mediaBound && typeof matchMedia === 'function') {
      this.mediaBound = true;
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (this.tenant.residentId && this.mine.theme === 'System') this.apply();
      });
    }
  }

  // ---- internals ----------------------------------------------------------------------

  private defaults(): TenantPreferences {
    const notifications = {} as NotificationPrefsMap;
    for (const c of NOTIFICATION_CATEGORIES) {
      const essential = this.isEssential(c.key);
      notifications[c.key] = { inApp: true, push: true, email: essential, sms: false };
    }
    return { language: 'English', theme: 'System', textSize: 'Normal', biometric: false, notifications, updatedAt: '' };
  }

  /** Fills gaps and forces essential categories on, whatever is stored. */
  private normalise(p: TenantPreferences): TenantPreferences {
    const base = this.defaults();
    const notifications = {} as NotificationPrefsMap;
    for (const c of NOTIFICATION_CATEGORIES) {
      const merged = { ...base.notifications[c.key], ...(p.notifications?.[c.key] ?? {}) };
      if (this.isEssential(c.key)) {
        for (const ch of PREF_CHANNELS) merged[ch.key] = true;
      }
      notifications[c.key] = merged;
    }
    return {
      language: LANGUAGES.includes(p.language) ? p.language : 'English',
      theme: THEMES.includes(p.theme) ? p.theme : 'System',
      textSize: TEXT_SIZES.includes(p.textSize) ? p.textSize : 'Normal',
      biometric: !!p.biometric,
      notifications,
      updatedAt: p.updatedAt ?? '',
    };
  }

  private commit(residentId: string, prefs: TenantPreferences): TenantPreferences {
    const next = { ...prefs, updatedAt: nowIso() };
    const all = { ...this.store.value, [residentId]: next };
    this.store.next(all);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* kept in memory */
    }
    this.apply(this.normalise(next));
    return this.normalise(next);
  }

  private load(): Record<string, TenantPreferences> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, TenantPreferences>) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* start empty */
    }
    return {};
  }
}
