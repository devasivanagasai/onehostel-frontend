import { Injectable, Injector } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuditChange, AuditEvent, AuditLog, AuditStatus } from '../models/audit.models';
import { SEED_AUDIT_LOGS } from './audit-log.seed';
import { AuthService } from './auth.service';

const STORAGE_KEY = 'onehostel_audit_logs';
const MAX_STORED = 500;
/**
 * The browser cannot see its own public IP. Until the backend stamps the real
 * client IP on each entry, locally recorded entries carry this placeholder.
 */
const CLIENT_IP_PLACEHOLDER = '103.21.58.14';

export interface AuditRecordOptions {
  status?: AuditStatus;
  details?: string;
  changes?: AuditChange[];
  /** Override the acting user (e.g. an unauthenticated password-reset request). */
  user?: string;
}

/**
 * Append-only record of important platform actions. Feature code calls
 * `record()`; nothing can edit or delete an entry.
 *
 * UI-only build: entries recorded in this browser are kept in localStorage and
 * shown on top of seeded history. A real audit trail must be written
 * server-side, where it can't be altered by the client — swap `record()` for an
 * API call and `logs$` for a paged query when the backend exists.
 */
@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly logsSubject = new BehaviorSubject<AuditLog[]>([...this.readStored(), ...SEED_AUDIT_LOGS]);
  readonly logs$: Observable<AuditLog[]> = this.logsSubject.asObservable();

  // AuthService records Login/Logout here, so resolve it lazily to avoid a circular constructor dependency.
  constructor(private injector: Injector) {}

  get logs(): AuditLog[] {
    return this.logsSubject.value;
  }

  record(event: AuditEvent, entity: string, options: AuditRecordOptions = {}): AuditLog {
    const entry: AuditLog = {
      logId: this.nextId(),
      timestamp: this.localIsoNow(),
      user: options.user ?? this.currentUserName(),
      event,
      entity,
      ipAddress: CLIENT_IP_PLACEHOLDER,
      status: options.status ?? 'Success',
      ...(options.details ? { details: options.details } : {}),
      ...(options.changes?.length ? { changes: options.changes } : {}),
    };

    this.logsSubject.next([entry, ...this.logs]);
    this.persist(entry);
    return entry;
  }

  private currentUserName(): string {
    return this.injector.get(AuthService).currentUser?.name || 'Admin';
  }

  private nextId(): string {
    const max = this.logs.reduce((m, l) => Math.max(m, parseInt(l.logId.replace(/\D/g, ''), 10) || 0), 0);
    return `LOG${String(max + 1).padStart(5, '0')}`;
  }

  /** Local wall-clock time as yyyy-mm-ddTHH:mm:ss, matching the seeded entries. */
  private localIsoNow(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private readStored(): AuditLog[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuditLog[]) : [];
    } catch {
      return [];
    }
  }

  private persist(entry: AuditLog): void {
    try {
      const stored = [entry, ...this.readStored()].slice(0, MAX_STORED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage full or blocked — the entry still shows for this session.
    }
  }
}
