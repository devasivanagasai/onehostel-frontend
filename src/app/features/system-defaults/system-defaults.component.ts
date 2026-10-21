import { Component, HostListener, OnDestroy } from '@angular/core';
import { Observable, of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  PASSWORD_EXPIRY_OPTIONS,
  PAYMENT_GATEWAYS,
  SettingsSection,
  SystemSettings,
  TIME_ZONE_OPTIONS,
} from '../../core/models/system-settings.models';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { UnsavedChangesAware } from '../../core/guards/unsaved-changes.guard';
import { applyTax, lateFeeFor } from '../subscription-payments/subscription-payment.models';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

export interface PolicyStrength {
  score: number;
  max: number;
  label: 'Weak' | 'Moderate' | 'Strong';
  tips: string[];
}

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

interface SectionNavItem {
  key: SettingsSection;
  label: string;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-system-defaults',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
    MatRadioModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    AppButtonComponent,
  ],
  templateUrl: './system-defaults.component.html',
  styleUrl: './system-defaults.component.scss',
})
export class SystemDefaultsComponent implements OnDestroy, UnsavedChangesAware {
  readonly sections: SectionNavItem[] = [
    { key: 'general', label: 'General', icon: 'tune', description: 'Branding, support contact and regional formats.' },
    { key: 'security', label: 'Security', icon: 'shield', description: 'Password, login and session policies for all users.' },
    { key: 'payment', label: 'Payment', icon: 'account_balance', description: 'Payment gateway and invoice numbering.' },
    { key: 'fees', label: 'Fees', icon: 'request_quote', description: 'GST and other charges on subscription payments, such as late payment fees.' },
  ];

  readonly countries = COUNTRY_OPTIONS;
  readonly currencies = CURRENCY_OPTIONS;
  readonly timeZones = TIME_ZONE_OPTIONS;
  readonly dateFormats = DATE_FORMAT_OPTIONS;
  readonly passwordExpiryOptions = PASSWORD_EXPIRY_OPTIONS;
  readonly paymentGateways = PAYMENT_GATEWAYS;

  readonly today = new Date();
  readonly samplePlanAmount = 1999;

  /** Secret inputs the user has chosen to reveal. */
  readonly revealed = new Set<string>();

  form!: FormGroup;
  private subs = new Subscription();

  constructor(
    private fb: FormBuilder,
    private settingsService: SystemSettingsService,
    private snackBar: MatSnackBar,
  ) {
    this.buildForm(this.settingsService.settings);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ---------------------------------------------------------------------------
  // Unsaved-changes protection & shortcuts
  // ---------------------------------------------------------------------------

  get hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  /** In-app navigation away from the page (route guard). */
  /** Leaving Settings never prompts: unsaved changes are simply dropped. */
  confirmLeave(): Observable<boolean> {
    return of(true);
  }

  /** Browser refresh / tab close. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges) event.preventDefault();
  }

  /** Ctrl+S / Cmd+S saves all settings instead of the browser's "Save page". */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
    }
  }

  /** Invalid fields across the sections being edited, shown next to Submit. */
  get invalidCount(): number {
    return this.dirtySections.reduce(
      (n, s) => n + Object.values(this.group(s.key).controls).filter((c) => c.invalid).length,
      0,
    );
  }

  // ---------------------------------------------------------------------------
  // Security: policy strength
  // ---------------------------------------------------------------------------

  get policyStrength(): PolicyStrength {
    return this.strengthOf(this.group('security').getRawValue());
  }

  /** "an uppercase letter, a number and a special character" — for the policy summary line. */
  get formatSummary(): string {
    const p = this.group('security').getRawValue();
    const parts = [
      p.requireUppercase && 'an uppercase letter',
      p.requireLowercase && 'a lowercase letter',
      p.requireNumber && 'a number',
      p.requireSpecialChar && 'a special character',
    ].filter(Boolean) as string[];
    if (parts.length <= 1) return parts[0] ?? '';
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  /** Scores the password, lockout and session policy. */
  private strengthOf(p: {
    minPasswordLength: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumber?: boolean;
    requireSpecialChar?: boolean;
    passwordExpiryDays: number;
    maxLoginAttempts: number;
    sessionTimeoutMinutes: number;
  }): PolicyStrength {
    const tips: string[] = [];
    let score = 0;
    let max = 0;

    max += 3;
    const len = Number(p.minPasswordLength);
    if (len >= 12) score += 2;
    else if (len >= 8) {
      score += 1;
      tips.push('Use 12+ characters for the strongest passwords.');
    } else tips.push('Minimum password length below 8 is easy to guess.');

    max += 1;
    const formatRules = [p.requireUppercase, p.requireLowercase, p.requireNumber, p.requireSpecialChar].filter(Boolean).length;
    if (formatRules >= 3) score += 1;
    else tips.push('Require at least 3 of: uppercase, lowercase, number, special character.');

    const expiry = Number(p.passwordExpiryDays);
    if (expiry > 0 && expiry <= 90) score += 1;
    else tips.push(expiry === 0 ? 'Passwords never expire.' : 'Expire passwords within 90 days.');

    max += 2;
    if (Number(p.maxLoginAttempts) <= 5) score += 1;
    else tips.push('Lock accounts after 5 or fewer failed logins.');

    if (Number(p.sessionTimeoutMinutes) <= 30) score += 1;
    else tips.push('A session timeout of 30 minutes or less limits unattended access.');

    const ratio = score / max;
    const label = ratio >= 0.8 ? 'Strong' : ratio >= 0.5 ? 'Moderate' : 'Weak';
    return { score, max, label, tips };
  }

  /** 1..n, for drawing the strength meter's segments. */
  segments(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------

  private buildForm(s: SystemSettings): void {
    this.subs.unsubscribe();
    this.subs = new Subscription();

    this.form = this.fb.group({
      general: this.fb.group({
        applicationName: [s.general.applicationName, [Validators.required, Validators.maxLength(40)]],
        logoDataUrl: [s.general.logoDataUrl],
        logoFileName: [s.general.logoFileName],
        // Support contact is read-only here (disabled); getRawValue() still saves it unchanged.
        supportEmail: [{ value: s.general.supportEmail, disabled: true }],
        supportPhoneCode: [{ value: s.general.supportPhoneCode, disabled: true }],
        supportPhone: [{ value: s.general.supportPhone, disabled: true }],
        defaultCountry: [s.general.defaultCountry, Validators.required],
        currency: [s.general.currency, Validators.required],
        timeZone: [s.general.timeZone, Validators.required],
        dateFormat: [s.general.dateFormat, Validators.required],
      }),
      security: this.fb.group({
        minPasswordLength: [s.security.minPasswordLength, this.intRange(6, 32)],
        requireUppercase: [s.security.requireUppercase],
        requireLowercase: [s.security.requireLowercase],
        requireNumber: [s.security.requireNumber],
        requireSpecialChar: [s.security.requireSpecialChar],
        passwordExpiryDays: [s.security.passwordExpiryDays, Validators.required],
        maxLoginAttempts: [s.security.maxLoginAttempts, this.intRange(3, 10)],
        sessionTimeoutMinutes: [s.security.sessionTimeoutMinutes, this.intRange(5, 480)],
      }),
      payment: this.fb.group({
        paymentGateway: [s.payment.paymentGateway, Validators.required],
        gatewayMode: [s.payment.gatewayMode, Validators.required],
        gatewayKeyId: [s.payment.gatewayKeyId, Validators.required],
        gatewayKeySecret: [s.payment.gatewayKeySecret, Validators.required],
        currency: [s.payment.currency, Validators.required],
        invoicePrefix: [s.payment.invoicePrefix, [Validators.required, Validators.pattern(/^[A-Z0-9/-]{1,10}$/)]],
      }),
      fees: this.fb.group({
        gstEnabled: [s.fees.gstEnabled],
        gstRate: [s.fees.gstRate],
        gstin: [s.fees.gstin],
        pricesIncludeTax: [s.fees.pricesIncludeTax],
        lateFeeEnabled: [s.fees.lateFeeEnabled],
        lateFeeType: [s.fees.lateFeeType],
        lateFeeValue: [s.fees.lateFeeValue],
        lateFeeGraceDays: [s.fees.lateFeeGraceDays],
      }),
    });

    // Validators that depend on another field's value.
    const fees = this.group('fees');
    this.watch(fees.get('gstEnabled')!, (enabled) => {
      this.setRequired(fees.get('gstRate')!, !!enabled, [Validators.min(0), Validators.max(28)]);
      this.setRequired(fees.get('gstin')!, !!enabled, [Validators.pattern(GSTIN_PATTERN)]);
    });
    // Late fee: fields are required only while it's on; % is capped at 100.
    const applyLateFeeRules = () => {
      const enabled = !!fees.get('lateFeeEnabled')!.value;
      const percent = fees.get('lateFeeType')!.value === 'Percentage';
      this.setRequired(fees.get('lateFeeType')!, enabled);
      this.setRequired(fees.get('lateFeeValue')!, enabled, [Validators.min(0.01), ...(percent ? [Validators.max(100)] : [])]);
      this.setRequired(fees.get('lateFeeGraceDays')!, enabled, [Validators.min(0), Validators.max(60), Validators.pattern(/^\d+$/)]);
    };
    this.watch(fees.get('lateFeeEnabled')!, applyLateFeeRules);
    this.watch(fees.get('lateFeeType')!, applyLateFeeRules);
  }

  private watch(control: AbstractControl, apply: (value: any) => void): void {
    apply(control.value);
    this.subs.add(control.valueChanges.subscribe(apply));
  }

  private setRequired(control: AbstractControl, required: boolean, extra: ValidatorFn[] = []): void {
    control.setValidators(required ? [Validators.required, ...extra] : []);
    control.updateValueAndValidity({ emitEvent: false });
  }

  private intRange(min: number, max: number): ValidatorFn[] {
    return [Validators.required, Validators.min(min), Validators.max(max), Validators.pattern(/^\d+$/)];
  }

  group(section: SettingsSection): FormGroup {
    return this.form.get(section) as FormGroup;
  }

  value(section: SettingsSection, key: string): any {
    return this.group(section).get(key)?.value;
  }

  /** Heading data (label, icon, description) for a section card. */
  nav(key: SettingsSection): SectionNavItem {
    return this.sections.find((s) => s.key === key)!;
  }

  isDirty(section: SettingsSection): boolean {
    return this.group(section).dirty;
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  /** Sections with unsaved edits, in page order. */
  get dirtySections(): SectionNavItem[] {
    return this.sections.filter((s) => this.isDirty(s.key));
  }

  /** e.g. "Security, Fees" — shown next to Submit. */
  get unsavedSummary(): string {
    return this.dirtySections.map((s) => s.label).join(', ');
  }

  /** Single Submit for the whole screen: saves every section that has edits. */
  save(): void {
    const dirty = this.dirtySections;

    // Nothing is saved while any edited section has errors; jump to the first one.
    const invalid = dirty.find((s) => this.group(s.key).invalid);
    if (invalid) {
      this.group(invalid.key).markAllAsTouched();
      document.getElementById(`settings-${invalid.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.snackBar.open(`Please fix the highlighted fields in ${invalid.label} settings before saving`, 'x', { duration: 4000 });
      return;
    }

    let total = 0;
    const saved: string[] = [];
    for (const s of dirty) {
      const group = this.group(s.key);
      const changes = this.settingsService.saveSection(s.key, this.normalize(s.key, group.getRawValue()));
      group.markAsPristine();
      if (changes.length) {
        total += changes.length;
        saved.push(s.label);
      }
    }

    this.snackBar.open(
      total
        ? `System defaults saved (${saved.join(', ')}) · ${total} change${total > 1 ? 's' : ''} recorded in Audit Logs`
        : 'No changes to save',
      'x',
      { duration: 4000, panelClass: total ? ['app-snackbar--success', 'green-snackbar'] : [] },
    );
  }

  /** Number inputs arrive as strings from some browsers; store them as numbers. */
  private normalize(section: SettingsSection, raw: any): any {
    const numericKeys: Record<SettingsSection, string[]> = {
      general: [],
      security: ['minPasswordLength', 'passwordExpiryDays', 'maxLoginAttempts', 'sessionTimeoutMinutes'],
      communication: ['smtpPort'],
      payment: [],
      fees: ['gstRate', 'lateFeeValue', 'lateFeeGraceDays'],
    };
    const out = { ...raw };
    numericKeys[section].forEach((k) => {
      if (out[k] !== null && out[k] !== '') out[k] = Number(out[k]);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Secrets
  // ---------------------------------------------------------------------------

  toggleReveal(key: string): void {
    if (this.revealed.has(key)) this.revealed.delete(key);
    else this.revealed.add(key);
  }

  // ---------------------------------------------------------------------------
  // Previews
  // ---------------------------------------------------------------------------

  /** Example of the next invoice number under the current prefix. */
  /**
   * Example for the Late Payment Fee preview: the sample plan's amount due
   * (with GST as configured), paid a few days after the grace period ends.
   */
  get lateFeePreview(): { amountDue: number; daysLate: number; fee: number; payable: number } | null {
    if (!this.value('fees', 'lateFeeEnabled')) return null;
    const value = Number(this.value('fees', 'lateFeeValue'));
    const graceDays = Number(this.value('fees', 'lateFeeGraceDays'));
    if (isNaN(value) || isNaN(graceDays)) return null;

    // Amount due includes GST exactly as configured above on this tab.
    const amountDue = this.taxPreview?.total ?? this.samplePlanAmount;
    const daysLate = graceDays + 3;
    const fee = lateFeeFor(amountDue, daysLate, {
      enabled: true,
      type: this.value('fees', 'lateFeeType') === 'Percentage' ? 'Percentage' : 'Fixed',
      value,
      graceDays,
    });
    return { amountDue, daysLate, fee, payable: Math.round((amountDue + fee) * 100) / 100 };
  }

  get invoicePreview(): string {
    return `${this.value('payment', 'invoicePrefix') || ''}${this.today.getFullYear()}-0143`;
  }

  /** Same calculation that new payments use (applyTax), so the preview matches real invoices. */
  get taxPreview(): { base: number; tax: number; total: number } | null {
    if (!this.value('fees', 'gstEnabled')) return null;
    const gstRate = Number(this.value('fees', 'gstRate'));
    if (isNaN(gstRate)) return null;
    const t = applyTax(this.samplePlanAmount, {
      gstEnabled: true,
      gstRate,
      pricesIncludeTax: !!this.value('fees', 'pricesIncludeTax'),
    });
    return { base: t.amount, tax: t.tax, total: t.totalAmount };
  }

  get paymentCurrencySymbol(): string {
    return this.value('payment', 'currency') || 'INR';
  }

  /** Codes like GSTIN / invoice prefix / sender ID are upper-case only; convert as the user types. */
  toUpper(section: SettingsSection, key: string): void {
    const c = this.group(section).get(key);
    const v: string = c?.value ?? '';
    if (v !== v.toUpperCase()) c!.setValue(v.toUpperCase());
  }

  hasError(section: SettingsSection, key: string, error: string): boolean {
    const c = this.group(section).get(key);
    return !!c && c.touched && c.hasError(error);
  }
}
