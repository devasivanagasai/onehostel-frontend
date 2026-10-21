import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DecimalPipe, LowerCasePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { AppFormatService } from '../../core/services/app-format.service';
import { FEATURE_CONFIG_ITEMS } from '../subscription-plans/add-plan-side-panel.component';
import { HostelSettingsService } from './hostel-settings.service';
import { LimitKey, UpgradeRequest } from './hostel-settings.models';
import { UpgradeRequestDialogComponent, UpgradeRequestResult } from './upgrade-request-dialog.component';

const DAY_MS = 86_400_000;

/** Subscription (read-only): plan, dates, limits with usage, enabled modules, upgrade request. */
@Component({
  selector: 'app-hs-subscription-section',
  standalone: true,
  imports: [DecimalPipe, LowerCasePipe, MatIconModule, AppButtonComponent],
  templateUrl: './subscription-section.component.html',
  styleUrl: './subscription-section.component.scss',
})
export class SubscriptionSectionComponent {
  private readonly service = inject(HostelSettingsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly fmt = inject(AppFormatService);

  @Input() upgradeRequest: UpgradeRequest | null = null;
  @Output() requested = new EventEmitter<void>();

  readonly sub = this.service.subscription;
  readonly modules = FEATURE_CONFIG_ITEMS;

  readonly limits: { key: LimitKey; label: string; icon: string; used: number; max: number; pct: number }[];
  readonly daysLeft: number;

  constructor() {
    const usage = this.service.usage();
    const labels: Record<LimitKey, [string, string]> = {
      rooms: ['Rooms', 'meeting_room'],
      beds: ['Beds', 'bed'],
      residents: ['Tenants', 'groups'],
      staffUsers: ['Staff users', 'badge'],
    };
    this.limits = (Object.keys(labels) as LimitKey[]).map((key) => {
      const max = this.sub.limits[key];
      const used = usage[key];
      return { key, label: labels[key][0], icon: labels[key][1], used, max, pct: Math.min(100, Math.round((used / max) * 100)) };
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.daysLeft = Math.ceil((new Date(this.sub.expiryDate + 'T00:00:00').getTime() - today.getTime()) / DAY_MS);
  }

  barTone(pct: number): string {
    return pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok';
  }

  openUpgrade(): void {
    this.dialog
      .open<UpgradeRequestDialogComponent, { currentPlan: string }, UpgradeRequestResult>(UpgradeRequestDialogComponent, {
        width: '520px',
        maxWidth: '94vw',
        autoFocus: false,
        data: { currentPlan: this.sub.planName },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) return;
        this.service.requestUpgrade(result.desiredPlan, result.note);
        this.requested.emit();
        this.snackBar.open('Upgrade request sent to OneHostel for review.', 'OK', { duration: 3500 });
      });
  }
}
