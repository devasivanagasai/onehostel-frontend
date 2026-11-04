import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { AnnouncementsService } from '../../features/announcements/announcements.service';
import { Announcement, effectiveStatus } from '../../features/announcements/announcements.models';
import { TenantContextService } from './tenant-context.service';
import { TenantAttachmentMeta } from '../models/tenant-support.models';

const READS_KEY = 'onehostel_tenant_announcement_reads_v1';

export interface TenantAnnouncementView {
  id: string;
  title: string;
  message: string;
  /** Always the hostel office; individual staff names are not shown. */
  publishedBy: string;
  publishedAt: string;
  /** yyyy-mm-dd, when the notice has an expiry. */
  expiryDate?: string;
  attachments: TenantAttachmentMeta[];
  /** Read by this Tenant in this app. */
  read: boolean;
  archived: boolean;
}

export interface TenantAnnouncementLists {
  live: TenantAnnouncementView[];
  archive: TenantAnnouncementView[];
}

/**
 * Announcements for the signed-in Tenant: only Published, non-expired notices addressed to them
 * (Expired ones form the archive). Drafts, scheduled, cancelled and other audiences' notices never
 * reach this service's output. Read / unread is tracked per Tenant in this browser.
 */
@Injectable({ providedIn: 'root' })
export class TenantAnnouncementsService {
  private readonly tenant = inject(TenantContextService);
  private readonly source = inject(AnnouncementsService);

  /** residentId -> ids of announcements that Tenant has opened. */
  private readonly reads = new BehaviorSubject<Record<string, string[]>>(this.load());

  readonly lists$: Observable<TenantAnnouncementLists> = combineLatest([this.source.announcements$, this.reads]).pipe(map(() => this.lists()));
  /** Unread live notices, for the dashboard and menu badge. */
  readonly unreadCount$: Observable<number> = this.lists$.pipe(map((l) => l.live.filter((a) => !a.read).length));

  lists(): TenantAnnouncementLists {
    const me = this.tenant.residentId;
    if (!me) return { live: [], archive: [] };
    const { live, archive } = this.source.forResident(me);
    return { live: live.map((a) => this.toView(a, me, false)), archive: archive.map((a) => this.toView(a, me, true)) };
  }

  get unreadCount(): number {
    return this.lists().live.filter((a) => !a.read).length;
  }

  /** One notice the Tenant is allowed to see; throws "Announcement not found." otherwise. */
  get(id: string): TenantAnnouncementView {
    const { live, archive } = this.lists();
    const found = [...live, ...archive].find((a) => a.id === id);
    if (!found) throw new Error('Announcement not found.');
    return found;
  }

  /** Marks one notice read for the signed-in Tenant. */
  markRead(id: string): void {
    const me = this.tenant.requireResidentId();
    this.get(id);
    this.addReads(me, [id]);
  }

  /** Marks every live notice read for the signed-in Tenant. */
  markAllRead(): void {
    const me = this.tenant.requireResidentId();
    this.addReads(me, this.lists().live.map((a) => a.id));
  }

  private addReads(me: string, ids: string[]): void {
    const current = this.reads.value[me] ?? [];
    const merged = Array.from(new Set([...current, ...ids]));
    if (merged.length === current.length) return;
    const next = { ...this.reads.value, [me]: merged };
    this.reads.next(next);
    try {
      localStorage.setItem(READS_KEY, JSON.stringify(next));
    } catch {
      /* kept in memory */
    }
  }

  private toView(a: Announcement, me: string, archived: boolean): TenantAnnouncementView {
    const status = effectiveStatus(a);
    return {
      id: a.id,
      title: a.title,
      message: a.message,
      publishedBy: 'Hostel office',
      publishedAt: a.publishAt ?? a.createdAt,
      expiryDate: a.expiryDate,
      attachments: a.attachment ? [{ name: a.attachment.name, type: a.attachment.type, size: a.attachment.size }] : [],
      read: (this.reads.value[me] ?? []).includes(a.id),
      archived: archived || status === 'Expired',
    };
  }

  private load(): Record<string, string[]> {
    try {
      const raw = localStorage.getItem(READS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
    return {};
  }
}
