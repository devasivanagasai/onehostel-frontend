import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppFormatService } from '../../../core/services/app-format.service';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';
import { AppDialogComponent } from '../../../shared/components/dialog/app-dialog.component';
import { TenantAnnouncementView, TenantAnnouncementsService } from '../../../core/services/tenant-announcements.service';
import { formatFileSize } from '../../../core/models/tenant-support.models';

@Component({
  selector: 'app-tenant-announcement-detail-dialog',
  standalone: true,
  imports: [MatIconModule, AppDialogComponent, AppButtonComponent],
  styleUrl: './tenant-announcements.component.scss',
  template: `
    <app-dialog eyebrow="Notice" [title]="a ? a.title : 'Announcement'" icon="campaign" tone="teal">
      <ng-container dialogMeta>
        @if (a?.archived) { <span class="tk-badge tk-badge--neutral">Archived</span> }
      </ng-container>
      @if (a; as n) {
        <dl class="tk-facts">
          <div><dt>Published by</dt><dd>{{ n.publishedBy }}</dd></div>
          <div><dt>Published</dt><dd>{{ fmt.date(n.publishedAt) }} {{ fmt.date(n.publishedAt, 'time') }}</dd></div>
          @if (n.expiryDate) { <div><dt>{{ n.archived ? 'Expired' : 'Expires' }}</dt><dd>{{ fmt.date(n.expiryDate) }}</dd></div> }
        </dl>
        <section class="tk-section"><p>{{ n.message }}</p></section>
        @if (n.attachments.length) {
          <section class="tk-section">
            <h3>Attachments</h3>
            <ul class="tk-attach">
              @for (f of n.attachments; track $index) {
                <li><mat-icon>{{ f.type === 'application/pdf' ? 'picture_as_pdf' : 'image' }}</mat-icon><span>{{ f.name }}</span><small>{{ formatFileSize(f.size) }}</small></li>
              }
            </ul>
            <p class="tk-muted">Ask the hostel office if you need a copy of the file.</p>
          </section>
        }
      } @else {
        <div class="tk-state" role="alert"><mat-icon>error_outline</mat-icon><p>{{ error }}</p></div>
      }
      <ng-container dialogFooter>
        <app-button variant="secondary" type="button" (clicked)="close()">Close</app-button>
      </ng-container>
    </app-dialog>
  `,
})
export class TenantAnnouncementDetailDialogComponent {
  private readonly service = inject(TenantAnnouncementsService);
  private readonly dialogRef = inject(MatDialogRef<TenantAnnouncementDetailDialogComponent>);
  private readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  readonly fmt = inject(AppFormatService);
  readonly formatFileSize = formatFileSize;

  a?: TenantAnnouncementView;
  error = '';

  constructor() {
    try {
      this.a = this.service.get(this.data.id);
      this.service.markRead(this.data.id);
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'This notice is not available.';
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
