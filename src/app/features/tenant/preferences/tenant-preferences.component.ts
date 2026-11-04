import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantPreferencesService } from '../../../core/services/tenant-preferences.service';
import { TenantNotificationCategory } from '../../../core/services/tenant-notification.service';
import { DATA_COLLECTED, PRIVACY_NOTICE, PrefChannel, TenantLanguage, TenantPreferences, TenantTextSize, TenantTheme } from '../../../core/models/tenant-preferences.models';
import { errMsg, fmtDateTime } from '../guardians/tn-ui';

@Component({
  selector: 'app-tenant-preferences',
  standalone: true,
  imports: [MatIconModule],
  styleUrl: './tenant-preferences.component.scss',
  template: `
    <div class="tn-page">
      @if (message) { <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div> }
      @if (actionError) { <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div> }

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading preferences"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError || !prefs) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError || 'Your preferences could not be loaded.' }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else {
        <section class="tn-card" aria-label="Language and display">
          <h2>Language and display</h2>
          <div class="tn-form">
            <div class="tn-field">
              <label for="pf-lang">Language</label>
              <select id="pf-lang" (change)="setLanguage($event)" [value]="prefs.language" aria-describedby="pf-lang-hint">
                @for (l of service.languages; track l) { <option [value]="l" [selected]="l === prefs.language">{{ l }}</option> }
              </select>
              <span class="tn-hint" id="pf-lang-hint">Your choice is saved. The screens are in English for now.</span>
            </div>
            <div class="tn-field">
              <label for="pf-theme">Theme</label>
              <select id="pf-theme" (change)="setTheme($event)" [value]="prefs.theme" [disabled]="!service.darkThemeSupported">
                @for (t of service.themes; track t) { <option [value]="t" [selected]="t === prefs.theme">{{ t }}</option> }
              </select>
              @if (!service.darkThemeSupported) { <span class="tn-hint">Dark theme: coming soon.</span> }
            </div>
            <div class="tn-field">
              <span class="tn-label" id="pf-size-label">Text size</span>
              <div class="tn-chip-row" role="radiogroup" aria-labelledby="pf-size-label">
                @for (s of service.textSizes; track s) {
                  <button type="button" class="tn-chip" role="radio" [attr.aria-checked]="prefs.textSize === s" [attr.aria-pressed]="prefs.textSize === s" (click)="setSize(s)">{{ s }}</button>
                }
              </div>
            </div>
          </div>
        </section>

        <section class="tn-card" aria-label="Notification preferences">
          <h2>Notifications</h2>
          <p class="tn-sub">Essential notifications (account, invoices, payments, complaints, room and transfer) are always on so you never miss something important. Channels your hostel plan does not include are unavailable.</p>
          <div class="tn-table-wrap">
            <table class="tn-table">
              <caption class="sr-only">Notification categories and channels</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  @for (c of service.channels; track c.key) { <th scope="col">{{ c.label }}@if (blocked(c.key)) { <div class="tn-sub" style="text-transform:none">{{ blocked(c.key) }}</div> }</th> }
                </tr>
              </thead>
              <tbody>
                @for (cat of service.categories; track cat.key) {
                  <tr>
                    <th scope="row" style="text-transform:none;font-size:0.9rem;color:inherit">{{ cat.label }} @if (essential(cat.key)) { <span class="tn-pill tn-pill--info">Essential</span> }</th>
                    @for (c of service.channels; track c.key) {
                      <td>
                        <input type="checkbox" [checked]="isOn(cat.key, c.key)" [disabled]="essential(cat.key) || !!blocked(c.key)"
                               (change)="toggle(cat.key, c.key, $event)" [attr.aria-label]="cat.label + ' by ' + c.label + (essential(cat.key) ? ' (always on)' : '')" />
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="tn-card" aria-label="Biometric sign-in">
          <h2>Biometric login</h2>
          <label class="tn-row" style="gap:10px">
            <input type="checkbox" [checked]="prefs.biometric" [disabled]="!bioAvailable" (change)="toggleBio($event)" />
            <span>Use fingerprint / face / device PIN to sign in on this device</span>
          </label>
          @if (!bioAvailable) {
            <p class="tn-sub" role="status">Not available: this browser or device does not offer a built-in authenticator (WebAuthn).</p>
          } @else {
            <p class="tn-sub">Saved as a preference only in this demo. Signing in still uses your password.</p>
          }
        </section>

        <section class="tn-card" aria-label="Privacy and consent">
          <h2>Privacy and consent</h2>
          <dl class="tn-kv">
            <div><dt>Consent recorded</dt><dd>@if (consentAt) { {{ dateTime(consentAt) }} } @else { Consent recorded at account setup }</dd></div>
            <div><dt>Preferences last saved</dt><dd>{{ prefs.updatedAt ? dateTime(prefs.updatedAt) : 'Not changed yet' }}</dd></div>
          </dl>
          <h3 style="margin-top:12px">Data we collect</h3>
          <ul>@for (d of dataCollected; track d) { <li>{{ d }}</li> }</ul>
          <h3 style="margin-top:12px">Privacy notice</h3>
          <p>{{ privacy }}</p>
        </section>

        <div class="tn-row">
          @if (confirmReset) {
            <button type="button" class="tn-btn tn-btn--danger" (click)="reset()">Yes, reset everything</button>
            <button type="button" class="tn-btn tn-btn--ghost" (click)="confirmReset = false">Keep my settings</button>
          } @else {
            <button type="button" class="tn-btn tn-btn--ghost" (click)="confirmReset = true"><mat-icon aria-hidden="true">restart_alt</mat-icon>Reset to defaults</button>
          }
        </div>
      }
    </div>
  `,
})
export class TenantPreferencesComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantPreferencesService);
  readonly dateTime = fmtDateTime;
  readonly dataCollected = DATA_COLLECTED;
  readonly privacy = PRIVACY_NOTICE;

  prefs: TenantPreferences | null = null;
  bioAvailable = false;
  consentAt: string | null = null;
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  confirmReset = false;
  private sub?: Subscription;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.sub?.unsubscribe();
    setTimeout(async () => {
      try {
        this.sub = this.service.mine$.subscribe((p) => (this.prefs = p));
        this.consentAt = this.service.consentRecordedAt;
        this.service.apply();
        this.bioAvailable = await this.service.biometricAvailable();
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  essential(c: TenantNotificationCategory): boolean {
    return this.service.isEssential(c);
  }

  blocked(ch: PrefChannel): string {
    return this.service.channelBlocked(ch);
  }

  isOn(c: TenantNotificationCategory, ch: PrefChannel): boolean {
    return !this.blocked(ch) && !!this.prefs?.notifications[c]?.[ch];
  }

  toggle(c: TenantNotificationCategory, ch: PrefChannel, event: Event): void {
    const box = event.target as HTMLInputElement;
    this.run(() => this.service.setNotification(c, ch, box.checked), 'Notification preference saved.', () => (box.checked = !box.checked));
  }

  setLanguage(event: Event): void {
    this.run(() => this.service.setLanguage((event.target as HTMLSelectElement).value as TenantLanguage), 'Language saved. The screens stay in English for now.');
  }

  setTheme(event: Event): void {
    this.run(() => this.service.setTheme((event.target as HTMLSelectElement).value as TenantTheme), 'Theme saved.');
  }

  setSize(s: TenantTextSize): void {
    this.run(() => this.service.setTextSize(s), `Text size set to ${s}.`);
  }

  toggleBio(event: Event): void {
    const box = event.target as HTMLInputElement;
    this.run(() => this.service.setBiometric(box.checked), box.checked ? 'Biometric login preference turned on.' : 'Biometric login preference turned off.', () => (box.checked = !box.checked));
  }

  reset(): void {
    this.confirmReset = false;
    this.run(() => this.service.reset(), 'Preferences reset to defaults.');
  }

  private run(action: () => unknown, ok: string, undo?: () => void): void {
    this.message = '';
    this.actionError = '';
    try {
      action();
      this.message = ok;
    } catch (e) {
      undo?.();
      this.actionError = errMsg(e);
    }
  }
}
