import { Component, Input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HOSTEL_FACILITIES, HostelSubscription, facilityBlockedReason } from './hostel-settings.models';

/** Facilities: checkbox grid with icons; facilities outside the plan are disabled. */
@Component({
  selector: 'app-hs-facilities-section',
  standalone: true,
  imports: [MatIconModule],
  template: `
    @if (!canEdit) {
      <p class="fa-note"><mat-icon fontSet="material-icons-outlined">lock</mat-icon>Facilities are managed by SuperAdmin for your hostel.</p>
    }
    <div class="fa-grid" role="group" aria-label="Hostel facilities">
      @for (f of facilities; track f.name) {
        @let blocked = blockedReason(f.name);
        <label class="fa-item" [class.is-selected]="selected(f.name)" [class.is-disabled]="blocked || !canEdit">
          <input type="checkbox" [checked]="selected(f.name)" [disabled]="!!blocked || !canEdit" (change)="toggle(f.name)" />
          <span class="fa-box" aria-hidden="true"><mat-icon>check</mat-icon></span>
          <mat-icon class="fa-icon" fontSet="material-icons-outlined">{{ f.icon }}</mat-icon>
          <span class="fa-text">
            {{ f.name }}
            @if (blocked) { <small>{{ blocked }}</small> }
          </span>
        </label>
      }
    </div>
    <p class="fa-foot">{{ control.value.length }} selected · Facilities marked “Not in your plan” need a plan upgrade (see Subscription).</p>
  `,
  styleUrl: './facilities-section.component.scss',
})
export class FacilitiesSectionComponent {
  @Input({ required: true }) control!: FormControl<string[]>;
  @Input({ required: true }) subscription!: HostelSubscription;
  @Input() canEdit = true;

  readonly facilities = HOSTEL_FACILITIES;

  blockedReason(name: string): string | null {
    return facilityBlockedReason(name, this.subscription);
  }

  selected(name: string): boolean {
    return this.control.value.includes(name);
  }

  toggle(name: string): void {
    const v = this.control.value;
    // Keep the list in display order so the saved value is stable.
    const next = this.selected(name) ? v.filter((x) => x !== name) : [...v, name];
    this.control.setValue(this.facilities.map((f) => f.name).filter((f) => next.includes(f)));
    this.control.markAsDirty();
  }
}
