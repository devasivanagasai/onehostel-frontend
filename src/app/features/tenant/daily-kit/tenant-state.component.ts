import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppButtonComponent } from '../../../shared/components/button/app-button.component';

/**
 * Loading / error-with-retry wrapper for the Tenant pages. Content is projected only when neither
 * state applies, so pages render their own empty and success states inside it.
 *
 *   <app-tenant-state [loading]="loading" [error]="error" (retry)="reload()"> ...page... </app-tenant-state>
 */
@Component({
  selector: 'app-tenant-state',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule, AppButtonComponent],
  template: `
    @if (loading) {
      <div class="ts-box" role="status" aria-live="polite">
        <mat-spinner [diameter]="30"></mat-spinner>
        <span>{{ loadingText }}</span>
      </div>
    } @else if (error) {
      <div class="ts-box ts-box--error" role="alert">
        <mat-icon>error_outline</mat-icon>
        <p>{{ error }}</p>
        <app-button variant="secondary" icon="refresh" (clicked)="retry.emit()">Try again</app-button>
      </div>
    } @else {
      <ng-content></ng-content>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .ts-box {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
        min-height: 220px; padding: 32px 16px; border-radius: 16px; background: #fff; color: #475569; text-align: center;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.05);
      }
      .ts-box p { margin: 0; max-width: 460px; }
      .ts-box--error mat-icon { color: #d32f2f; font-size: 36px; width: 36px; height: 36px; }
    `,
  ],
})
export class TenantStateComponent {
  @Input() loading = false;
  @Input() error = '';
  @Input() loadingText = 'Loading...';
  @Output() retry = new EventEmitter<void>();
}
