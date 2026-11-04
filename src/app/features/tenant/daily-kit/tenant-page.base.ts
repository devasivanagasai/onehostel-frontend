import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, merge } from 'rxjs';
import { AppFormatService } from '../../../core/services/app-format.service';

export const errorMessage = (e: unknown, fallback = 'Something went wrong. Please try again.'): string =>
  e instanceof Error && e.message ? e.message : fallback;

/** Hostel-local date-time as yyyy-mm-ddTHH:mm (never UTC), for datetime-local inputs. */
export const localMinute = (d: Date = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const toneOf = (map: Record<string, string>, key: string): string => map[key] ?? 'neutral';
export { toneOf };

/**
 * Common plumbing for the Tenant pages: a simulated load with loading / error + retry state,
 * live refresh when the underlying services change, and success / error feedback.
 */
export abstract class TenantPageBase {
  readonly fmt = inject(AppFormatService);
  protected readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | undefined;

  loading = true;
  error = '';
  /** Inline error from the last action (shown near the form). */
  actionError = '';
  /** Inline success message from the last action. */
  success = '';
  busy = false;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  /** Recomputes everything the template shows from the services. Throw to show the error state. */
  protected abstract refresh(): void;

  /** Shows the loading state briefly, then loads; used on first open and for Try again. */
  protected start(): void {
    this.loading = true;
    this.error = '';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.run();
      this.loading = false;
    }, 250);
  }

  reload(): void {
    this.start();
  }

  protected run(): void {
    try {
      this.refresh();
      this.error = '';
    } catch (e) {
      this.error = errorMessage(e, 'We could not load this page.');
    }
  }

  /** Refresh whenever any of the streams emit (after the first load). */
  protected watch(...streams: Observable<unknown>[]): void {
    merge(...streams)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.loading && !this.error) this.run();
      });
  }

  protected done(message: string): void {
    this.actionError = '';
    this.success = message;
    this.snackBar.open(message, 'Close', { duration: 4000 });
  }

  protected failed(e: unknown): void {
    this.success = '';
    this.actionError = errorMessage(e);
  }

  clearFeedback(): void {
    this.success = '';
    this.actionError = '';
  }

  /** 'yyyy-mm-ddTHH:mm[:ss]' as the app's date-time format. */
  dt(iso?: string): string {
    return iso ? this.fmt.date(iso.length === 16 ? `${iso}:00` : iso, 'datetime') : '';
  }

  d(iso?: string): string {
    return iso ? this.fmt.date(iso.slice(0, 10), 'date') : '';
  }

  /** "HH:mm" -> "7:30 AM". */
  clock(hhmm?: string): string {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  money(v: number): string {
    return this.fmt.money(v, 0);
  }
}
