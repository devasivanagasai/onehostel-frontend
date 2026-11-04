import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../button/app-button.component';

export type AppDialogTone = 'blue' | 'teal' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

/**
 * Shared frame for every form / detail pop-up: icon + title header with a close button,
 * a scrollable body and a footer for the actions. Open the feature component with MatDialog
 * as usual and wrap its template in <app-dialog>.
 *
 *   <form [formGroup]="form" (ngSubmit)="save()">
 *     <app-dialog title="Add Resident" subtitle="…" icon="person_add">
 *       …fields…
 *       <ng-container dialogFooter>
 *         <app-button variant="secondary" (clicked)="cancel()">Cancel</app-button>
 *         <app-button type="submit">Save</app-button>
 *       </ng-container>
 *     </app-dialog>
 *   </form>
 *
 * Slots: [dialogLead] (replaces the icon, e.g. an avatar), [dialogMeta] (badges beside the title), default (body), [dialogFooter] (actions,
 * right-aligned; put an <span class="app-dialog__spacer"></span> first to push some left).
 * The × closes the dialog with no result unless (closed) is handled.
 */
@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, AppButtonComponent],
  templateUrl: './app-dialog.component.html',
  styleUrl: './app-dialog.component.scss',
})
export class AppDialogComponent {
  private readonly dialogRef = inject(MatDialogRef, { optional: true });

  @Input() title = '';
  @Input() subtitle?: string;
  /** Small caption above the title, e.g. "Complaint ID". */
  @Input() eyebrow?: string;
  @Input() icon?: string;
  @Input() iconOutlined = true;
  @Input() tone: AppDialogTone = 'blue';
  /** Hide the × button (e.g. while a save is in flight). */
  @Input() hideClose = false;
  /** Drop the footer bar entirely (detail views without actions). */
  @Input() hideFooter = false;

  /** Emits when × is clicked. When nothing listens, the dialog just closes. */
  @Output() closed = new EventEmitter<void>();

  close(): void {
    if (this.closed.observed) {
      this.closed.emit();
    } else {
      this.dialogRef?.close();
    }
  }
}
