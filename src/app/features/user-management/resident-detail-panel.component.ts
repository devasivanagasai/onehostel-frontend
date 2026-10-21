import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { AppFormatService } from '../../core/services/app-format.service';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { shouldCloseOnEscape } from '../../shared/utils/panel-escape';
import { AuditLogService } from '../../core/services/audit-log.service';
import { auditAction, auditEventLabel } from '../../core/models/audit.models';
import { LogoutType, formatDuration, sessionMinutes } from '../admin-management/admin.models';
import { Resident, residentAuditEntity, residentFullName } from './resident.models';
import { RESIDENT_ACTION_META, ResidentAction, ResidentService, residentActions } from './resident.service';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { AppButtonComponent, AppButtonVariant } from '../../shared/components/button/app-button.component';

/** Status → shared badge tone (same palette as the list tables). */
export const RESIDENT_STATUS_TONE: Record<Resident['status'], 'success' | 'neutral' | 'danger'> = {
  Active: 'success',
  Inactive: 'neutral',
  Blocked: 'danger',
};

export type ResidentPanelTab = 'details' | 'activity';

interface ActivityItem {
  timestamp: string;
  kind: 'login' | 'logout' | 'account';
  icon: string;
  tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral';
  title: string;
  /** Sign-ins/outs: "OneHostel App · Android". */
  device?: string;
  /** Sign-ins/outs: client IP. */
  ip?: string;
  /** Sign-outs: how long the session lasted. */
  duration?: string;
  /** Account changes: who made the change. */
  by?: string;
  /** Account changes: "Field: old → new" lines. */
  changes?: string[];
}

interface ActivityDay {
  /** "Today", "Yesterday" or "Sat, 27 Sep 2026". */
  label: string;
  items: ActivityItem[];
}

const LOGOUT_TITLES: Record<LogoutType, string> = {
  Manual: 'Signed out',
  'Session timeout': 'Signed out — session timed out',
  'Ended by SuperAdmin': 'Signed out by Admin',
};

const ACCOUNT_ICONS: Record<string, string> = {
  Activate: 'check_circle',
  Deactivate: 'person_off',
  Block: 'block',
  Unblock: 'lock_open',
};

@Component({
  selector: 'app-resident-detail-panel',
  standalone: true,
  imports: [AppDatePipe, CommonModule, MatIconModule, AppButtonComponent],
  templateUrl: './resident-detail-panel.component.html',
  styleUrl: './resident-detail-panel.component.scss',
})
export class ResidentDetailPanelComponent implements OnChanges {
  /** Currency, date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  @Input() isOpen = false;
  @Input() residentId?: string;
  @Output() closePanel = new EventEmitter<void>();

  @ViewChild('panelBody') private panelBody?: ElementRef<HTMLElement>;

  tab: ResidentPanelTab = 'details';

  readonly meta = RESIDENT_ACTION_META;
  readonly actions = residentActions;
  readonly name = residentFullName;
  readonly tone = RESIDENT_STATUS_TONE;

  constructor(
    private residentService: ResidentService,
    private auditLog: AuditLogService,
  ) {}

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.isOpen && shouldCloseOnEscape(event)) this.closePanel.emit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] && this.isOpen) || changes['residentId']) {
      this.tab = 'details';
      this.scrollTop();
    }
  }

  setTab(tab: ResidentPanelTab): void {
    this.tab = tab;
    this.scrollTop();
  }

  private scrollTop(): void {
    setTimeout(() => {
      if (this.panelBody) this.panelBody.nativeElement.scrollTop = 0;
    }, 0);
  }

  /** Always read live from the service so status changes show immediately. */
  get resident(): Resident | undefined {
    return this.residentId ? this.residentService.byId(this.residentId) : undefined;
  }

  initials(r: Resident): string {
    return `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`.toUpperCase();
  }

  /** Button colour (same as the admin panel): green for Unblock/Activate, red outline for Block/Deactivate. */
  actionStyle(action: ResidentAction): AppButtonVariant {
    if (action === 'unblock' || action === 'activate') return 'success';
    return this.meta[action].danger ? 'danger-outline' : 'secondary';
  }

  run(r: Resident, action: ResidentAction): void {
    this.residentService.perform(r, action).subscribe();
  }

  // ---- Activity ----------------------------------------------------------------

  /** Resident-app sign-ins and sign-outs merged with Admin actions on the account, newest first. */
  get activity(): ActivityItem[] {
    const r = this.resident;
    if (!r) return [];

    const logins: ActivityItem[] = r.loginHistory.map((l) => ({
      timestamp: l.timestamp,
      kind: 'login',
      icon: l.status === 'Success' ? 'login' : 'gpp_bad',
      tone: l.status === 'Success' ? 'success' : 'danger',
      title: l.status === 'Success' ? 'Signed in' : `Failed sign-in${l.reason ? ' — ' + l.reason : ''}`,
      device: l.device,
      ip: l.ipAddress,
    }));

    // Each completed session also produces a sign-out entry.
    const logouts: ActivityItem[] = r.loginHistory
      .filter((l) => l.status === 'Success' && l.logoutAt)
      .map((l) => ({
        timestamp: l.logoutAt!,
        kind: 'logout',
        icon: l.logoutType === 'Session timeout' ? 'timer_off' : 'logout',
        tone: 'neutral',
        title: LOGOUT_TITLES[l.logoutType ?? 'Manual'],
        device: l.device,
        ip: l.ipAddress,
        duration: formatDuration(sessionMinutes(l.timestamp, l.logoutAt!)),
      }));

    const entity = residentAuditEntity(r);
    const accountEvents: ActivityItem[] = this.auditLog.logs
      .filter((l) => l.entity === entity)
      .map((l) => {
        const action = auditAction(l);
        return {
          timestamp: l.timestamp,
          kind: 'account',
          icon: ACCOUNT_ICONS[action] ?? 'edit',
          tone: l.status === 'Failed' ? 'danger' : ['Block', 'Deactivate'].includes(action) ? 'warning' : 'info',
          title: `${auditEventLabel(l.event)}${l.status === 'Failed' ? ' (failed)' : ''}`,
          by: l.user,
          changes: l.changes?.map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`),
        };
      });

    return [...logins, ...logouts, ...accountEvents].sort((x, y) => y.timestamp.localeCompare(x.timestamp));
  }

  /** Activity grouped by calendar day, newest day first. */
  get activityDays(): ActivityDay[] {
    const days: ActivityDay[] = [];
    let currentKey = '';
    for (const item of this.activity) {
      const key = item.timestamp.slice(0, 10);
      if (key !== currentKey) {
        currentKey = key;
        days.push({ label: this.dayLabel(item.timestamp), items: [] });
      }
      days[days.length - 1].items.push(item);
    }
    return days;
  }

  /** Phone sign-ins get a phone icon; everything else a laptop. */
  deviceIcon(device: string): string {
    return /iPhone|iPad|Android|Mobile/i.test(device) ? 'smartphone' : 'laptop';
  }

  private dayLabel(iso: string): string {
    const day = new Date(iso.slice(0, 10) + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return this.fmt.date(day, 'dayDate');
  }
}
