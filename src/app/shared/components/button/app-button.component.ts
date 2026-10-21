import { Component, EventEmitter, HostBinding, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThemePalette } from '@angular/material/core';

/**
 * primary        solid brand blue — the one main action on a screen or dialog (Save, Add Resident)
 * secondary      white, neutral outline — Cancel, Back, other neutral actions
 * outline        white, blue text — table row actions (View, Edit, Collect)
 * success        solid green — positive state change (Activate, Unlock, Export Excel)
 * accent         solid teal — positive confirmations styled to match teal screens (Log complaint, Add note)
 * danger         solid red — destructive confirmation (Delete, Deactivate)
 * warning        solid amber — cautionary confirmation (Mark maintenance)
 * danger-outline white, red text — destructive secondary action (Reverse, Refund, Check out)
 * text           no border — low-emphasis link-style action
 * icon           icon only, no border — close (×) buttons
 * icon-outline   icon only, bordered square — compact row actions (download, remind)
 * icon-danger    icon only, bordered square in red — destructive compact row action (cancel, delete)
 * stroked        legacy alias of `secondary`
 */
export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'accent'
  | 'danger'
  | 'warning'
  | 'danger-outline'
  | 'text'
  | 'icon'
  | 'icon-outline'
  | 'icon-danger'
  | 'stroked';

export type AppButtonSize = 'sm' | 'md' | 'lg';

/**
 * The single button for the whole app. Sizes come from the --btn-* tokens in styles.scss,
 * so every screen's buttons line up. Use (clicked) — it is not emitted while disabled or loading.
 *
 *   <app-button icon="add" (clicked)="openAdd()">Add Resident</app-button>
 *   <app-button variant="secondary" (clicked)="cancel()">Cancel</app-button>
 *   <app-button type="submit" [loading]="saving">Save</app-button>
 *   <app-button variant="outline" size="sm" icon="visibility" (clicked)="view(row)">View</app-button>
 *   <app-button variant="icon" icon="close" ariaLabel="Close" (clicked)="close()"></app-button>
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './app-button.component.html',
  styleUrl: './app-button.component.scss',
})
export class AppButtonComponent {
  @Input() variant: AppButtonVariant = 'primary';
  @Input() size: AppButtonSize = 'md';
  /** Kept for backwards compatibility: 'warn' renders the danger style. */
  @Input() color: ThemePalette;
  @Input() icon?: string;
  @Input() iconPosition: 'left' | 'right' = 'left';
  /** Outlined Material icon set for the icon. */
  @Input() iconOutlined = false;
  @Input() disabled = false;
  @Input() loading = false;
  /** Stretch to the full width of the container. */
  @Input() block = false;
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  /** Id of the <form> this button submits when it sits outside it (HTML `form` attribute). */
  @Input() form?: string;
  @Input() ariaLabel?: string;

  @Output() clicked = new EventEmitter<MouseEvent>();

  @HostBinding('class.app-button--block') get isBlock(): boolean {
    return this.block;
  }

  get resolvedVariant(): Exclude<AppButtonVariant, 'stroked'> {
    if (this.variant === 'stroked') return 'secondary';
    if (this.color === 'warn' && this.variant === 'primary') return 'danger';
    return this.variant;
  }

  get iconOnly(): boolean {
    const v = this.resolvedVariant;
    return v === 'icon' || v === 'icon-outline' || v === 'icon-danger';
  }

  onClick(event: MouseEvent): void {
    if (this.disabled || this.loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.clicked.emit(event);
  }
}
