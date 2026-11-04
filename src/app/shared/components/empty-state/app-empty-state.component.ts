import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppButtonComponent } from '../button/app-button.component';

/**
 * Standard "no rows" block for list screens: an icon, a message, an optional hint
 * and an optional "Clear filters" button.
 * Styling comes from src/styles/_table.scss (`.empty-results*`, `.saas-table`).
 *
 *   <app-empty-state
 *     [message]="isFiltering ? 'No hostels match your search' : 'No hostels yet'"
 *     [hint]="isFiltering ? 'Try a different search, or clear the filters.' : ''"
 *     [clearable]="isFiltering"
 *     (clear)="clearFilters()"
 *   ></app-empty-state>
 *
 * Pass `headers` only when the real table is hidden while empty, so the column
 * header row still shows. A header named "Actions" is right-aligned.
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [MatIconModule, AppButtonComponent],
  template: `
    <div class="empty-state-wrapper">
      @if (headers.length) {
        <div class="table-responsive">
          <table class="saas-table empty-header-table">
            <thead>
              <tr>
                @for (h of headers; track $index) {
                  <th [class.actions-header]="h === 'Actions'">{{ h }}</th>
                }
              </tr>
            </thead>
          </table>
        </div>
      }

      <div class="empty-results" role="status">
        <span class="empty-results__icon">
          <mat-icon>{{ icon }}</mat-icon>
        </span>
        <p class="empty-results__title">{{ message }}</p>
        @if (hint) {
          <p class="empty-results__hint">{{ hint }}</p>
        }
        @if (clearable) {
          <app-button variant="outline" size="sm" icon="filter_alt_off" (clicked)="clear.emit()">Clear filters</app-button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class AppEmptyStateComponent {
  /** Column headers shown above the message; empty = no header row. */
  @Input() headers: string[] = [];
  @Input() message = 'No Data Found';
  /** Smaller line under the message. */
  @Input() hint = '';
  /** Material icon in the circle. */
  @Input() icon = 'search_off';
  /** Show a "Clear filters" button that emits `clear`. */
  @Input() clearable = false;
  @Output() clear = new EventEmitter<void>();
}
