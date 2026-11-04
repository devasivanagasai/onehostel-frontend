import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantDocumentsService } from '../../../core/services/tenant-documents.service';
import { DocumentActivityEntry, DocumentFile, TenantDocumentView } from '../../../core/models/tenant-documents.models';
import { errMsg, fmtBytes, fmtDate, fmtDateTime, toneOf } from '../guardians/tn-ui';

@Component({
  selector: 'app-tenant-documents',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  styleUrl: './tenant-documents.component.scss',
  template: `
    <div class="tn-page">
      <div class="tn-banner" role="note">
        <mat-icon aria-hidden="true">lock</mat-icon>
        <div>Your documents are private to you. They have no public links: each one opens only while you are signed in, and every view, download, upload and acknowledgement is recorded below.</div>
      </div>

      @if (message) { <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div> }
      @if (actionError) { <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div> }

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading documents"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else {
        <section class="tn-card" aria-label="My documents">
          <h2>My documents</h2>
          @if (!docs.length) {
            <div class="tn-state" role="status"><mat-icon aria-hidden="true">folder_open</mat-icon><p>No documents yet.</p><p class="tn-sub">Letters and receipts appear here when your hostel publishes them.</p></div>
          } @else {
            <div class="tn-table-wrap">
              <table class="tn-table">
                <caption class="sr-only">Your documents</caption>
                <thead><tr><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  @for (d of docs; track d.id) {
                    <tr>
                      <td>
                        <strong>{{ d.title }}</strong>
                        @if (d.fileName) { <div class="tn-sub">{{ d.fileName }} @if (d.sizeBytes) { · {{ bytes(d.sizeBytes) }} }</div> }
                        @if (d.remark) { <div class="tn-sub">Hostel office: {{ d.remark }}</div> }
                        @if (d.requiresAck) {
                          <div class="tn-sub">@if (d.acknowledgedAt) { Acknowledged {{ dateTime(d.acknowledgedAt) }} } @else { Needs your acknowledgement }</div>
                        }
                      </td>
                      <td>{{ d.type }}</td>
                      <td>
                        <span class="tn-pill tn-pill--{{ tone(d.status) }}">{{ d.status }}</span>
                        @if (d.expiresAt) { <div class="tn-sub">Expires {{ date(d.expiresAt) }}</div> }
                      </td>
                      <td>{{ date(d.issuedAt) }}</td>
                      <td>
                        <div class="tn-row">
                          <button type="button" class="tn-btn tn-btn--ghost" (click)="open(d)" [attr.aria-label]="'View ' + d.title"><mat-icon aria-hidden="true">visibility</mat-icon>View</button>
                          <button type="button" class="tn-btn tn-btn--ghost" (click)="save(d)" [attr.aria-label]="'Download ' + d.title"><mat-icon aria-hidden="true">download</mat-icon>Download</button>
                          @if (d.requiresAck && !d.acknowledgedAt) {
                            <button type="button" class="tn-btn" (click)="ack(d)">I acknowledge</button>
                          }
                          @if (d.canDelete) {
                            @if (confirmDelete === d.id) {
                              <button type="button" class="tn-btn tn-btn--danger" (click)="remove(d)">Confirm delete</button>
                              <button type="button" class="tn-btn tn-btn--ghost" (click)="confirmDelete = ''">Keep</button>
                            } @else {
                              <button type="button" class="tn-btn tn-btn--danger" (click)="confirmDelete = d.id" [attr.aria-label]="'Delete ' + d.title">Delete</button>
                            }
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="tn-card" aria-label="Upload a document">
          <h2>Upload identity / supporting document</h2>
          @if (!canUpload) {
            <div class="tn-banner tn-banner--warn" role="status"><mat-icon aria-hidden="true">block</mat-icon><div>Uploads are not permitted by your hostel. Ask the hostel office to add your document.</div></div>
          } @else {
            <p class="tn-sub">JPG, PNG or PDF, up to 5 MB each, at most 10 uploaded documents ({{ uploaded }} used). Only the file name, type and size are kept in this demo. New uploads wait for the hostel office to review them.</p>
            <form (ngSubmit)="upload()" class="tn-form" novalidate>
              <div class="tn-field">
                <label for="doc-title">Document name (optional)</label>
                <input id="doc-title" name="title" [(ngModel)]="title" maxlength="80" autocomplete="off" />
              </div>
              <div class="tn-field">
                <label for="doc-file">File</label>
                <input id="doc-file" type="file" name="file" [accept]="accept" (change)="pick($event)" [attr.aria-invalid]="!!uploadError" aria-describedby="doc-file-err" />
                <span class="tn-err" id="doc-file-err" role="alert">{{ uploadError }}</span>
              </div>
              <div class="tn-wide"><button type="submit" class="tn-btn" [disabled]="!file"><mat-icon aria-hidden="true">upload</mat-icon>Upload</button></div>
            </form>
          }
        </section>

        <section class="tn-card" aria-label="Document activity">
          <h2>Document activity</h2>
          <p class="tn-sub">An append-only record of what was done with your documents. Entries cannot be edited or removed.</p>
          @if (!activity.length) {
            <p class="tn-sub" role="status">No activity yet.</p>
          } @else {
            <ul class="tn-list">
              @for (a of activity; track a.id) {
                <li class="tn-row tn-row--between"><span><strong>{{ a.action }}</strong> · {{ a.documentTitle }}</span><span class="tn-sub">{{ dateTime(a.at) }}</span></li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
})
export class TenantDocumentsComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantDocumentsService);
  readonly accept = this.service.uploadLimits.accept;
  readonly tone = toneOf;
  readonly date = fmtDate;
  readonly dateTime = fmtDateTime;
  readonly bytes = fmtBytes;

  docs: TenantDocumentView[] = [];
  activity: DocumentActivityEntry[] = [];
  canUpload = true;
  uploaded = 0;
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  title = '';
  file: File | null = null;
  uploadError = '';
  confirmDelete = '';
  private subs = new Subscription();

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subs.unsubscribe();
    this.subs = new Subscription();
    setTimeout(() => {
      try {
        this.subs.add(this.service.mine$.subscribe((d) => { this.docs = d; this.uploaded = d.filter((x) => x.uploadedByTenant).length; }));
        this.subs.add(this.service.activity$.subscribe((a) => (this.activity = a)));
        this.subs.add(this.service.canUpload$.subscribe((c) => (this.canUpload = c)));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.uploadError = this.file ? this.service.uploadProblem({ name: this.file.name, mime: this.file.type, size: this.file.size }) : '';
  }

  upload(): void {
    this.clear();
    if (!this.file) return;
    try {
      const doc = this.service.upload({ name: this.file.name, mime: this.file.type, size: this.file.size }, this.title);
      this.message = `"${doc.title}" was uploaded and is waiting for review.`;
      this.file = null;
      this.title = '';
      this.uploadError = '';
      const el = document.getElementById('doc-file') as HTMLInputElement | null;
      if (el) el.value = '';
    } catch (e) {
      this.uploadError = errMsg(e);
    }
  }

  open(d: TenantDocumentView): void {
    this.clear();
    try {
      const f = this.service.view(d.id);
      const url = this.blobUrl(f);
      const w = window.open(url, '_blank', 'noopener');
      if (!w) this.actionError = 'Your browser blocked the new tab. Allow pop-ups or use Download.';
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  save(d: TenantDocumentView): void {
    this.clear();
    try {
      const f = this.service.download(d.id);
      const url = this.blobUrl(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      this.message = `Downloaded ${f.fileName}. Open it and print or save as PDF.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  ack(d: TenantDocumentView): void {
    this.clear();
    try {
      this.service.acknowledge(d.id);
      this.message = `You acknowledged "${d.title}". This cannot be undone.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  remove(d: TenantDocumentView): void {
    this.clear();
    try {
      this.service.deleteUpload(d.id);
      this.message = `"${d.title}" was deleted.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
    this.confirmDelete = '';
  }

  private blobUrl(f: DocumentFile): string {
    return URL.createObjectURL(new Blob([f.html], { type: 'text/html' }));
  }

  private clear(): void {
    this.message = '';
    this.actionError = '';
  }
}
