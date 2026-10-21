import { Component, EventEmitter, HostBinding, Input, Output } from '@angular/core';
import { AppEmptyStateComponent } from '../empty-state/app-empty-state.component';
import { AppPaginationComponent } from '../pagination/app-pagination.component';

/**
 * The standard list card used by every table screen: white card, optional toolbar
 * (filters / tabs) inside it, the screen's own <table mat-table class="saas-table">,
 * then either the empty state or the pagination footer.
 * Table look comes from src/styles/_table.scss.
 *
 *   <app-table-card
 *     [empty]="filteredRows.length === 0"
 *     emptyIcon="apartment"
 *     [emptyMessage]="isFiltering ? 'No hostels match your search' : 'No hostels yet'"
 *     [emptyHint]="…" [clearable]="isFiltering" (clear)="clearFilters()"
 *     [page]="safePage" [totalPages]="totalPages" [pageSize]="pageSize"
 *     (pageChange)="currentPage = $event" (pageSizeChange)="onPageSize($event)"
 *   >
 *     <div tableToolbar>…filters…</div>
 *     <table mat-table [dataSource]="pagedRows" class="saas-table">…</table>
 *   </app-table-card>
 *
 * The table header stays visible when there are no rows, so columns don't jump.
 * Set [paginate]="false" for short summary tables (Reports).
 */
@Component({
  selector: 'app-table-card',
  standalone: true,
  imports: [AppEmptyStateComponent, AppPaginationComponent],
  template: `
    <ng-content select="[tableToolbar]"></ng-content>
    <div class="table-responsive">
      <ng-content></ng-content>
    </div>
    @if (empty) {
      <app-empty-state
        [icon]="emptyIcon"
        [message]="emptyMessage"
        [hint]="emptyHint"
        [clearable]="clearable"
        (clear)="clear.emit()"
      ></app-empty-state>
    } @else if (paginate) {
      <app-pagination
        [page]="page"
        [totalPages]="totalPages"
        [pageSize]="pageSize"
        [pageSizeOptions]="pageSizeOptions"
        (pageChange)="pageChange.emit($event)"
        (pageSizeChange)="pageSizeChange.emit($event)"
      >
        <ng-content select="[tableFooterStart]"></ng-content>
      </app-pagination>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AppTableCardComponent {
  /** Global card look (styles/_table.scss) lives on the host so screens can add their own class to it. */
  @HostBinding('class.saas-card') readonly card = true;

  /** No rows to show: renders the empty state instead of the pagination. */
  @Input() empty = false;
  @Input() emptyIcon = 'search_off';
  @Input() emptyMessage = 'No records found';
  @Input() emptyHint = '';
  /** Show "Clear filters" in the empty state. */
  @Input() clearable = false;
  @Output() clear = new EventEmitter<void>();

  /** Show the pagination footer (when there are rows). */
  @Input() paginate = true;
  /** 0-based. */
  @Input() page = 0;
  @Input() totalPages = 1;
  /** When set, the rows-per-page selector is shown. */
  @Input() pageSize?: number;
  @Input() pageSizeOptions: number[] = [10, 25, 50];
  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();
}
