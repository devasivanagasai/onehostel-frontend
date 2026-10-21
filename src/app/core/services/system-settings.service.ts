import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  DEFAULT_SYSTEM_SETTINGS,
  FeeSettings,
  PaymentSettings,
  SECRET_SETTING_KEYS,
  SECTION_TITLES,
  SETTING_LABELS,
  SettingsSection,
  SystemSettings,
} from '../models/system-settings.models';
import { AuditChange, diffForAudit } from '../models/audit.models';
import { AuditLogService } from './audit-log.service';

const STORAGE_KEY = 'onehostel_system_settings';

/**
 * Platform-wide defaults (branding, security policy, providers, billing).
 * Every save writes a "Change Settings" audit entry with old → new values;
 * credentials are masked in that entry.
 *
 * UI-only build: persisted to localStorage. Once the backend exists, load via
 * GET and save via PUT per section — and keep provider secrets server-side only.
 */
@Injectable({ providedIn: 'root' })
export class SystemSettingsService {
  private readonly settingsSubject = new BehaviorSubject<SystemSettings>(this.load());
  readonly settings$: Observable<SystemSettings> = this.settingsSubject.asObservable();

  constructor(private auditLog: AuditLogService) {}

  get settings(): SystemSettings {
    return this.settingsSubject.value;
  }

  /** Saves one section. Returns the recorded changes (empty if nothing changed). */
  saveSection<K extends SettingsSection>(section: K, value: SystemSettings[K]): AuditChange[] {
    const previous = this.settings[section] as unknown as Record<string, unknown>;
    const next = value as unknown as Record<string, unknown>;
    if (JSON.stringify(previous) === JSON.stringify(next)) return [];
    const changes = this.auditChanges(section, previous, next);

    const updated: SystemSettings = { ...this.settings, [section]: { ...value } };
    this.settingsSubject.next(updated);
    this.persist(updated);
    this.auditLog.record('Change Settings', SECTION_TITLES[section], { changes });
    return changes;
  }

  private auditChanges(
    section: SettingsSection,
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
  ): AuditChange[] {
    const labels = Object.entries(SETTING_LABELS[section]);
    const plainLabels = Object.fromEntries(labels.filter(([key]) => !SECRET_SETTING_KEYS.has(key)));
    const changes = diffForAudit(previous, next, plainLabels);

    // Credentials: record that they changed, never their values.
    for (const [key, field] of labels) {
      if (!SECRET_SETTING_KEYS.has(key) || previous[key] === next[key]) continue;
      changes.push({
        field,
        oldValue: previous[key] ? '••••••' : '—',
        newValue: next[key] ? '•••••• (updated)' : '— (removed)',
      });
    }

    // A logo swapped for a file with the same name still counts as a change.
    if (
      section === 'general' &&
      previous['logoDataUrl'] !== next['logoDataUrl'] &&
      !changes.some((c) => c.field === SETTING_LABELS.general['logoFileName'])
    ) {
      changes.push({
        field: SETTING_LABELS.general['logoFileName'],
        oldValue: String(previous['logoFileName'] || '—'),
        newValue: `${next['logoFileName'] || '—'} (replaced)`,
      });
    }
    return changes;
  }

  /** Stored values merged over defaults, so newly added settings still get a value. */
  private load(): SystemSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_SYSTEM_SETTINGS);
      const stored = JSON.parse(raw) as Partial<SystemSettings>;

      // GST and late-fee settings used to live under Payment; carry any saved values over to Fees.
      const {
        gstEnabled,
        gstRate,
        gstin,
        pricesIncludeTax,
        lateFeeEnabled,
        lateFeeType,
        lateFeeValue,
        lateFeeGraceDays,
        ...payment
      } = (stored.payment ?? {}) as Partial<PaymentSettings & FeeSettings>;
      const legacyFees = Object.fromEntries(
        Object.entries({
          gstEnabled,
          gstRate,
          gstin,
          pricesIncludeTax,
          lateFeeEnabled,
          lateFeeType,
          lateFeeValue,
          lateFeeGraceDays,
        }).filter(([, v]) => v !== undefined),
      ) as Partial<FeeSettings>;

      // Sign-in is password-only now: drop the OTP policy older builds stored.
      const { otpExpiryMinutes, otpLength, ...security } = (stored.security ?? {}) as Record<string, unknown>;

      return {
        general: { ...DEFAULT_SYSTEM_SETTINGS.general, ...stored.general },
        security: { ...DEFAULT_SYSTEM_SETTINGS.security, ...security },
        communication: { ...DEFAULT_SYSTEM_SETTINGS.communication, ...stored.communication },
        payment: { ...DEFAULT_SYSTEM_SETTINGS.payment, ...payment },
        fees: { ...DEFAULT_SYSTEM_SETTINGS.fees, ...legacyFees, ...stored.fees },
      };
    } catch {
      return structuredClone(DEFAULT_SYSTEM_SETTINGS);
    }
  }

  private persist(settings: SystemSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or blocked (a large logo can do this) — the change still applies for this session.
    }
  }
}
