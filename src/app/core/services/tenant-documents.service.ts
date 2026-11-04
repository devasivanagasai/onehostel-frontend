import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { FeesService } from './fees.service';
import { HostelSettingsService } from './hostel-settings.service';
import { LeaveOutpassService } from './leave-outpass.service';
import { ResidentsService } from './residents.service';
import { TenantContextService } from './tenant-context.service';
import { TenantNotificationService } from './tenant-notification.service';
import { residentFullName } from '../models/residents.models';
import {
  DocumentAction,
  DocumentActivityEntry,
  DocumentFile,
  PublishDocumentInput,
  StoredTenantDocument,
  TENANT_DOCUMENT_TYPES,
  TenantDocumentStatus,
  TenantDocumentView,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_COUNT,
  UPLOAD_MIME_TYPES,
  UploadInput,
} from '../models/tenant-documents.models';
import { localDateIso } from '../../shared/utils/local-date';

const DOCS_KEY = 'onehostel_tenant_documents_v1';
const ACTIVITY_KEY = 'onehostel_tenant_document_activity_v1';
const POLICY_KEY = 'onehostel_tenant_document_policy_v1';

const pad = (n: number): string => String(n).padStart(2, '0');
const nowIso = (): string => {
  const d = new Date();
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const opaqueId = (): string => `doc_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function read<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* use fallback */
  }
  return fallback();
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kept in memory */
  }
}

function seedDocs(): StoredTenantDocument[] {
  const d = (id: string, residentId: string, x: Partial<StoredTenantDocument> & Pick<StoredTenantDocument, 'type' | 'title' | 'status' | 'issuedAt'>): StoredTenantDocument => ({ id, residentId, ...x });
  return [
    d('doc_seed001', 'RES000001', { type: 'Hostel Allotment Letter', title: 'Hostel Allotment Letter', status: 'Verified', issuedAt: '2026-08-01' }),
    d('doc_seed002', 'RES000001', { type: 'Hostel Rules/Undertaking', title: 'Hostel Rules & Undertaking 2026-27', status: 'Verified', issuedAt: '2026-08-01', requiresAck: true }),
    d('doc_seed003', 'RES000001', { type: 'Identity/Supporting', title: 'Aadhaar card', status: 'Verified', issuedAt: '2026-08-02', uploadedByTenant: true, fileName: 'aadhaar-front.pdf', mime: 'application/pdf', sizeBytes: 420_000, reviewedAt: '2026-08-03T10:00:00', remark: 'Checked against original.' }),
    d('doc_seed004', 'RES000001', { type: 'Identity/Supporting', title: 'College ID card', status: 'Verified', issuedAt: '2025-08-10', expiresAt: '2026-06-30', uploadedByTenant: true, fileName: 'college-id-2025.png', mime: 'image/png', sizeBytes: 310_000 }),
    d('doc_seed005', 'RES000001', { type: 'Identity/Supporting', title: 'Medical certificate', status: 'Pending Review', issuedAt: '2026-10-28', uploadedByTenant: true, fileName: 'medical-cert.pdf', mime: 'application/pdf', sizeBytes: 640_000 }),
    d('doc_seed006', 'RES000001', { type: 'Identity/Supporting', title: 'Address proof', status: 'Rejected', issuedAt: '2026-09-02', uploadedByTenant: true, fileName: 'address.jpg', mime: 'image/jpeg', sizeBytes: 900_000, remark: 'Image is blurred. Please upload a clear copy.', reviewedAt: '2026-09-03T11:00:00' }),
    d('doc_seed007', 'RES000002', { type: 'Hostel Allotment Letter', title: 'Hostel Allotment Letter', status: 'Verified', issuedAt: '2026-08-01' }),
    d('doc_seed008', 'RES000002', { type: 'Identity/Supporting', title: 'Passport (private)', status: 'Verified', issuedAt: '2026-08-02', uploadedByTenant: true, fileName: 'passport.pdf', mime: 'application/pdf', sizeBytes: 500_000 }),
  ];
}

function seedActivity(): DocumentActivityEntry[] {
  const a = (i: number, documentId: string, documentTitle: string, action: DocumentAction, at: string): DocumentActivityEntry => ({ id: `DA${String(i).padStart(6, '0')}`, residentId: 'RES000001', documentId, documentTitle, action, at });
  return [a(1, 'doc_seed003', 'Aadhaar card', 'Uploaded', '2026-08-02T10:15:00'), a(2, 'doc_seed005', 'Medical certificate', 'Uploaded', '2026-10-28T16:40:00')];
}

/**
 * The Tenant's digital documents. Everything is scoped to the signed-in Tenant: a document id that
 * belongs to someone else behaves exactly like one that does not exist. Documents are served only by
 * `view()` / `download()`, which build a print-ready page for the owning Tenant and log the access.
 */
@Injectable({ providedIn: 'root' })
export class TenantDocumentsService {
  private readonly tenant = inject(TenantContextService);
  private readonly staffAuth = inject(AuthService);
  private readonly fees = inject(FeesService);
  private readonly leave = inject(LeaveOutpassService);
  private readonly residents = inject(ResidentsService);
  private readonly settings = inject(HostelSettingsService);
  private readonly notices = inject(TenantNotificationService);

  private readonly docs = new BehaviorSubject<StoredTenantDocument[]>(read(DOCS_KEY, seedDocs));
  private readonly log = new BehaviorSubject<DocumentActivityEntry[]>(read(ACTIVITY_KEY, seedActivity));
  private readonly policy = new BehaviorSubject<{ allowUpload: boolean }>(read(POLICY_KEY, () => ({ allowUpload: true })));

  readonly types = TENANT_DOCUMENT_TYPES;
  readonly uploadLimits = { maxBytes: UPLOAD_MAX_BYTES, maxCount: UPLOAD_MAX_COUNT, accept: '.jpg,.jpeg,.png,.pdf' };

  readonly mine$: Observable<TenantDocumentView[]> = combineLatest([this.docs, this.fees.payments$, this.leave.requests$]).pipe(map(() => this.mine));
  readonly activity$: Observable<DocumentActivityEntry[]> = this.log.pipe(map(() => this.myActivity));
  readonly canUpload$: Observable<boolean> = this.policy.pipe(map((p) => p.allowUpload));

  get canUpload(): boolean {
    return this.policy.value.allowUpload;
  }

  get mine(): TenantDocumentView[] {
    const me = this.tenant.residentId;
    if (!me) return [];
    const stored = this.docs.value.filter((d) => d.residentId === me).map((d) => this.toView(d));
    return [...stored, ...this.derived(me)].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || a.title.localeCompare(b.title));
  }

  get myActivity(): DocumentActivityEntry[] {
    const me = this.tenant.residentId;
    return me ? this.log.value.filter((e) => e.residentId === me).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)) : [];
  }

  get myUploadCount(): number {
    return this.mine.filter((d) => d.uploadedByTenant).length;
  }

  /** First problem with an upload, or '' when it is allowed. */
  uploadProblem(file: UploadInput | null | undefined): string {
    if (!this.tenant.residentId) return 'Sign in as a Tenant to upload.';
    if (!this.canUpload) return 'Uploads are turned off by your hostel. Ask the hostel office to add your document.';
    if (!file || !file.name?.trim()) return 'Choose a file to upload.';
    const name = file.name.trim();
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (!UPLOAD_EXTENSIONS.includes(ext) || !(UPLOAD_MIME_TYPES as readonly string[]).includes(file.mime)) return 'Only JPG, PNG or PDF files are allowed.';
    if (!(file.size > 0)) return 'The file is empty.';
    if (file.size > UPLOAD_MAX_BYTES) return 'The file is larger than 5 MB.';
    if (this.myUploadCount >= UPLOAD_MAX_COUNT) return `You can keep at most ${UPLOAD_MAX_COUNT} uploaded documents. Delete one first.`;
    const me = this.tenant.residentId!;
    if (this.docs.value.some((d) => d.residentId === me && d.uploadedByTenant && (d.fileName ?? '').toLowerCase() === name.toLowerCase())) return 'You already uploaded a file with this name. Rename it or delete the earlier one.';
    return '';
  }

  /** Records an upload (name, type and size only; no file content is kept). Always lands as Pending Review. */
  upload(file: UploadInput, title?: string): TenantDocumentView {
    const me = this.tenant.requireResidentId();
    const problem = this.uploadProblem(file);
    if (problem) throw new Error(problem);
    const name = file.name.trim();
    const label = (title ?? '').trim() || name.replace(/\.[^.]+$/, '');
    if (label.length > 80) throw new Error('Keep the document name within 80 characters.');
    const doc: StoredTenantDocument = {
      id: opaqueId(),
      residentId: me,
      type: 'Identity/Supporting',
      title: label,
      status: 'Pending Review',
      issuedAt: localDateIso(),
      uploadedByTenant: true,
      fileName: name,
      mime: file.mime,
      sizeBytes: file.size,
    };
    this.saveDocs([doc, ...this.docs.value]);
    this.record(doc, 'Uploaded');
    return this.toView(doc);
  }

  /** Deletes one of MY uploads, only while it is still Pending Review. */
  deleteUpload(id: string): void {
    const d = this.requireOwnStored(id);
    if (!d.uploadedByTenant) throw new Error('Only documents you uploaded can be deleted.');
    if (d.status !== 'Pending Review') throw new Error('A reviewed document cannot be deleted. Contact your hostel office.');
    this.saveDocs(this.docs.value.filter((x) => x.id !== id));
    this.record(d, 'Deleted');
  }

  /** Acknowledge a rules / undertaking document. Recorded once; it can never be undone. */
  acknowledge(id: string): TenantDocumentView {
    const d = this.requireOwnStored(id);
    if (!d.requiresAck) throw new Error('This document does not need an acknowledgement.');
    if (d.acknowledgedAt) throw new Error('You have already acknowledged this document.');
    const next = { ...d, acknowledgedAt: nowIso() };
    this.saveDocs(this.docs.value.map((x) => (x.id === id ? next : x)));
    this.record(next, 'Acknowledged');
    return this.toView(next);
  }

  /** Print-ready page to view. Logged as a view. */
  view(id: string): DocumentFile {
    return this.serve(id, 'Viewed');
  }

  /** Print-ready file to download. Logged as a download. */
  download(id: string): DocumentFile {
    return this.serve(id, 'Downloaded');
  }

  // ---- Owner side ---------------------------------------------------------------------

  /** Owner-side actions are for the Hostel Owner or Admin; a Tenant can never call them. */
  private requireStaff(): void {
    if (!(this.staffAuth.isHostelOwner || this.staffAuth.isAdmin)) throw new Error('Only the Hostel Owner can do this.');
  }

  /** Owner decision on a Tenant upload. A rejection needs a remark. */
  reviewDocument(id: string, status: 'Verified' | 'Rejected', remark?: string): TenantDocumentView {
    this.requireStaff();
    const d = this.docs.value.find((x) => x.id === id);
    if (!d) throw new Error('Document not found.');
    if (status !== 'Verified' && status !== 'Rejected') throw new Error('Choose Verified or Rejected.');
    if (status === 'Rejected' && !(remark ?? '').trim()) throw new Error('A remark is required when rejecting a document.');
    const next: StoredTenantDocument = { ...d, status, remark: remark?.trim() || undefined, reviewedAt: nowIso() };
    this.saveDocs(this.docs.value.map((x) => (x.id === id ? next : x)));
    this.notices.push(d.residentId, { category: 'Profile', title: `Document ${status.toLowerCase()}`, body: `Your document "${d.title}" was ${status.toLowerCase()}.`, route: '/my/documents' });
    return this.toView(next);
  }

  /** Owner publishes a document to one Tenant (allotment letter, rules, ...). */
  publishDocument(residentId: string, input: PublishDocumentInput): TenantDocumentView {
    this.requireStaff();
    if (!this.residents.byId(residentId)) throw new Error('Resident not found.');
    if (!TENANT_DOCUMENT_TYPES.includes(input.type)) throw new Error('Unknown document type.');
    if (input.type === 'Fee Invoice/Receipt' || input.type === 'Leave Approval') throw new Error('Receipts and leave approvals are generated from fee and leave records.');
    if (!input.title?.trim()) throw new Error('A title is required.');
    if (input.expiresAt && input.expiresAt < localDateIso()) throw new Error('The expiry date cannot be in the past.');
    const doc: StoredTenantDocument = {
      id: opaqueId(),
      residentId,
      type: input.type,
      title: input.title.trim(),
      status: 'Verified',
      issuedAt: localDateIso(),
      expiresAt: input.expiresAt || undefined,
      requiresAck: input.type === 'Hostel Rules/Undertaking' ? input.requiresAck !== false : false,
    };
    this.saveDocs([doc, ...this.docs.value]);
    this.notices.push(residentId, { category: 'Profile', title: 'New document available', body: `"${doc.title}" is now in your Documents.`, route: '/my/documents' });
    return this.toView(doc);
  }

  /** Owner policy: may Tenants upload identity / supporting documents? */
  setUploadPolicy(allowUpload: boolean): void {
    this.requireStaff();
    this.policy.next({ allowUpload });
    write(POLICY_KEY, { allowUpload });
  }

  // ---- internals ----------------------------------------------------------------------

  private toView(d: StoredTenantDocument): TenantDocumentView {
    const expired = !!d.expiresAt && d.expiresAt < localDateIso();
    return {
      id: d.id,
      type: d.type,
      title: d.title,
      status: expired ? 'Expired' : d.status,
      issuedAt: d.issuedAt,
      expiresAt: d.expiresAt,
      requiresAck: !!d.requiresAck,
      acknowledgedAt: d.acknowledgedAt,
      uploadedByTenant: !!d.uploadedByTenant,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      remark: d.remark,
      derived: false,
      canDelete: !!d.uploadedByTenant && d.status === 'Pending Review',
    };
  }

  /** Fee receipts (successful payments) and approved leave, for ONE resident, generated on demand. */
  private derived(me: string): TenantDocumentView[] {
    const base = { requiresAck: false, uploadedByTenant: false, derived: true, canDelete: false, status: 'Verified' as TenantDocumentStatus };
    const receipts = this.fees.payments
      .filter((p) => p.residentId === me && p.status === 'Successful' && !!p.receiptId)
      .map((p): TenantDocumentView => ({ ...base, id: `rcp_${p.id}`, type: 'Fee Invoice/Receipt', title: `Receipt ${p.receiptId} · ${p.chargeDescription}`, issuedAt: p.paidAt.slice(0, 10) }));
    const leaves = this.leave.requests
      .filter((r) => r.residentId === me && r.status === 'Approved')
      .map((r): TenantDocumentView => ({ ...base, id: `lv_${r.id}`, type: 'Leave Approval', title: `${r.type} approval ${r.id}`, issuedAt: (r.decidedAt ?? r.createdAt).slice(0, 10) }));
    return [...receipts, ...leaves];
  }

  private requireOwnStored(id: string): StoredTenantDocument {
    const me = this.tenant.requireResidentId();
    const d = this.docs.value.find((x) => x.id === id);
    if (!d || d.residentId !== me) throw new Error('Document not found.');
    return d;
  }

  private serve(id: string, action: DocumentAction): DocumentFile {
    const me = this.tenant.requireResidentId();
    const resident = this.tenant.requireResident();
    const hostel = this.tenant.hostelName;
    const name = residentFullName(resident);
    const stored = this.docs.value.find((x) => x.id === id);
    let title = '';
    let body = '';
    if (stored) {
      if (stored.residentId !== me) throw new Error('Document not found.');
      title = stored.title;
      body = this.storedBody(stored, name);
      this.record(stored, action);
    } else if (id.startsWith('rcp_')) {
      const p = this.fees.payments.find((x) => `rcp_${x.id}` === id);
      if (!p || p.residentId !== me || p.status !== 'Successful') throw new Error('Document not found.');
      title = `Payment Receipt ${p.receiptId}`;
      body = this.rows([['Receipt no.', p.receiptId], ['Payment ref.', p.id], ['Invoice', p.chargeId], ['For', p.chargeDescription], ['Amount paid', `Rs. ${p.amount.toLocaleString('en-IN')}`], ['Method', p.method], ['Transaction ref.', p.transactionRef ?? '-'], ['Paid on', p.paidAt.replace('T', ' ')], ['Paid by', name]]);
      this.record({ id, residentId: me, title }, action);
    } else if (id.startsWith('lv_')) {
      const r = this.leave.requests.find((x) => `lv_${x.id}` === id);
      if (!r || r.residentId !== me || r.status !== 'Approved') throw new Error('Document not found.');
      title = `${r.type} Approval ${r.id}`;
      body = this.rows([['Reference', r.id], ['Resident', name], ['Type', r.type], ['From', r.departAt.replace('T', ' ')], ['To', r.returnAt.replace('T', ' ')], ['Destination', r.destination ?? '-'], ['Approved on', (r.decidedAt ?? '').replace('T', ' ')]]);
      this.record({ id, residentId: me, title }, action);
    } else {
      throw new Error('Document not found.');
    }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:720px;margin:32px auto;padding:0 20px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:24px 0 8px}
.sub{color:#64748b;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}td{border-bottom:1px solid #e2e8f0;padding:8px 6px;font-size:14px}td:first-child{color:#64748b;width:38%}
.foot{margin-top:32px;font-size:12px;color:#64748b}@media print{body{margin:0}}</style></head><body>
<h1>${esc(hostel)}</h1><div class="sub">${esc(title)} - generated ${esc(nowIso().replace('T', ' '))}</div>${body}
<div class="foot">Computer-generated for ${esc(name)} (${esc(me)}). Print this page or save it as PDF.</div></body></html>`;
    return { fileName: `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.html`, html };
  }

  private storedBody(d: StoredTenantDocument, name: string): string {
    const alloc = this.tenant.allocation;
    const resident = this.tenant.resident;
    switch (d.type) {
      case 'Hostel Allotment Letter':
        return `<p>Dear ${esc(name)},</p><p>You are allotted accommodation in our hostel as per the details below.</p>${this.rows([
          ['Resident ID', d.residentId],
          ['Room', alloc ? `${alloc.room.building}, Room ${alloc.room.roomNumber}` : 'Not allotted at present'],
          ['Bed', alloc ? alloc.bed.bedNumber : '-'],
          ['Joining date', resident?.joiningDate ?? '-'],
          ['Issued on', d.issuedAt],
        ])}`;
      case 'Hostel Rules/Undertaking': {
        const rules = this.settings.state.value.rules;
        const list = rules.houseRules.length ? `<ol>${rules.houseRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>` : '<p>No house rules are recorded.</p>';
        return `<h2>House rules</h2>${list}${this.rows([['Gate closes', rules.gateClosingTime], ['Check-in', rules.checkInTime], ['Check-out', rules.checkOutTime]])}<p>I have read and agree to follow these rules.</p>${d.acknowledgedAt ? `<p><strong>Acknowledged on ${esc(d.acknowledgedAt.replace('T', ' '))}</strong></p>` : '<p>Not yet acknowledged.</p>'}`;
      }
      default:
        return `<p>Document record (file content is not kept in this demo build).</p>${this.rows([['Document', d.title], ['Type', d.type], ['File name', d.fileName ?? '-'], ['Size', d.sizeBytes ? `${Math.round(d.sizeBytes / 1024)} KB` : '-'], ['Status', this.toView(d).status], ['Uploaded', d.issuedAt], ['Expires', d.expiresAt ?? '-'], ['Remark', d.remark ?? '-']])}`;
    }
  }

  private rows(pairs: [string, unknown][]): string {
    return `<table>${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  }

  private record(d: Pick<StoredTenantDocument, 'id' | 'residentId' | 'title'>, action: DocumentAction): void {
    const entry: DocumentActivityEntry = {
      id: `DA${String(this.log.value.length + 1).padStart(6, '0')}`,
      residentId: d.residentId,
      documentId: d.id,
      documentTitle: d.title,
      action,
      at: nowIso(),
    };
    const next = [...this.log.value, entry];
    this.log.next(next);
    write(ACTIVITY_KEY, next);
  }

  private saveDocs(list: StoredTenantDocument[]): void {
    this.docs.next(list);
    write(DOCS_KEY, list);
  }
}
