import { Injectable } from '@angular/core';
import { AuditLogService } from '../../core/services/audit-log.service';
import { AuditChange, diffForAudit } from '../../core/models/audit.models';
import { CommunicationTemplateRow } from './communication-template.models';

const TEMPLATE_AUDIT_FIELDS: Record<string, string> = {
  templateName: 'Template Name',
  templateCode: 'Template Code',
  channel: 'Channel',
  trigger: 'Event / Trigger',
  subject: 'Subject',
  status: 'Status',
};

const SEED_TEMPLATES: CommunicationTemplateRow[] = [
  {
    templateId: 'TMP001',
    templateName: 'Hostel Owner Account Created',
    templateCode: 'ADMIN_ACCOUNT_CREATED',
    channel: 'Email',
    trigger: 'Hostel Owner Onboarding',
    subject: 'Welcome to {{hostel_name}}',
    body:
      'Hello {{admin_name}},\n\nYour Hostel Owner account has been created.\n\n' +
      'Username: {{username}}\nTemporary Password: {{temporary_password}}\n\nLogin: {{login_link}}',
    status: 'Active',
    lastModified: '2026-09-17',
  },
  {
    templateId: 'TMP002',
    templateName: 'Hostel Owner Account Created (SMS)',
    templateCode: 'ADMIN_ACCOUNT_CREATED_SMS',
    channel: 'SMS',
    trigger: 'Hostel Owner Onboarding',
    subject: '',
    body:
      'Hi {{admin_name}}, your {{hostel_name}} hostel owner account is ready. ' +
      'Username: {{username}}, Temp password: {{temporary_password}}. Login: {{login_link}}',
    status: 'Active',
    lastModified: '2026-09-17',
  },
  {
    templateId: 'TMP003',
    templateName: 'Password Reset',
    templateCode: 'PASSWORD_RESET',
    channel: 'Email',
    trigger: 'Password Reset',
    subject: 'Reset your {{hostel_name}} password',
    body:
      'Hello {{admin_name}},\n\nWe received a request to reset your password.\n\n' +
      'Temporary Password: {{temporary_password}}\n\nLogin: {{login_link}}\n\n' +
      'If you did not request this, please contact support.',
    status: 'Active',
    lastModified: '2026-09-10',
  },
  {
    templateId: 'TMP004',
    templateName: 'Hostel Onboarded',
    templateCode: 'HOSTEL_ONBOARDED_PUSH',
    channel: 'Push Notification',
    trigger: 'Hostel Onboarding',
    subject: '{{hostel_name}} is live',
    body: 'Hi {{admin_name}}, {{hostel_name}} has been onboarded successfully. Tap to get started.',
    status: 'Active',
    lastModified: '2026-09-05',
  },
  {
    templateId: 'TMP005',
    templateName: 'Subscription Renewal Reminder',
    templateCode: 'SUBSCRIPTION_RENEWAL_REMINDER',
    channel: 'Email',
    trigger: 'Subscription Renewal Reminder',
    subject: 'Your {{hostel_name}} subscription is due for renewal',
    body:
      'Hello {{admin_name}},\n\nYour subscription for {{hostel_name}} is due for renewal soon.\n\n' +
      'Login to renew: {{login_link}}',
    status: 'Inactive',
    lastModified: '2026-08-22',
  },
];

/**
 * In-memory store for communication templates, shared by the list page and the
 * full-page editor so a save on one route is visible on the other. Swap the
 * array for HTTP calls once a backend exists.
 */
@Injectable({ providedIn: 'root' })
export class CommunicationTemplateService {
  private rows: CommunicationTemplateRow[] = [...SEED_TEMPLATES];

  constructor(private auditLog: AuditLogService) {}

  get templates(): CommunicationTemplateRow[] {
    return this.rows;
  }

  getById(templateId: string): CommunicationTemplateRow | undefined {
    return this.rows.find((r) => r.templateId === templateId);
  }

  getNextTemplateId(): string {
    const numericIds = this.rows
      .map((r) => {
        const match = r.templateId.match(/TMP(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
    return `TMP${String(maxId + 1).padStart(3, '0')}`;
  }

  /** Creates or updates a template and records the audit entry. Returns true when it was newly created. */
  save(result: CommunicationTemplateRow): boolean {
    const previous = this.getById(result.templateId);
    if (!previous) {
      this.rows = [result, ...this.rows];
      this.auditLog.record('Create Template', result.templateName, {
        details: `${result.templateCode} · ${result.channel} · ${result.trigger}`,
      });
      return true;
    }

    const changes: AuditChange[] = diffForAudit({ ...previous }, { ...result }, TEMPLATE_AUDIT_FIELDS);
    // The body can be long; record that it changed rather than storing the whole text twice.
    if (previous.body !== result.body) {
      changes.push({ field: 'Message Body', oldValue: `${previous.body.length} chars`, newValue: `${result.body.length} chars (edited)` });
    }
    if (changes.length) this.auditLog.record('Update Template', result.templateName, { changes });
    this.rows = this.rows.map((r) => (r.templateId === result.templateId ? result : r));
    return false;
  }
}
