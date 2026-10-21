import { Component, Input } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import { HOUSE_RULE_MAX_LENGTH, MAX_HOUSE_RULES } from './hostel-settings.models';

/** One line of the house rules list. */
export function houseRuleControl(text = ''): FormControl<string> {
  return new FormControl(text, {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(HOUSE_RULE_MAX_LENGTH)],
  });
}

/** Rules & Policies: timings, visitor policy and the house rules list. */
@Component({
  selector: 'app-hs-rules-section',
  standalone: true,
  imports: [ReactiveFormsModule, MatIconModule, MatSlideToggleModule, AppButtonComponent],
  templateUrl: './rules-section.component.html',
  styleUrl: './rules-section.component.scss',
})
export class RulesSectionComponent {
  @Input({ required: true }) group!: FormGroup;
  @Input({ required: true }) rules!: FormArray<FormControl<string>>;

  readonly maxRules = MAX_HOUSE_RULES;
  readonly maxLength = HOUSE_RULE_MAX_LENGTH;

  get visitorsAllowed(): boolean {
    return !!this.group.get('visitorsAllowed')!.value;
  }

  show(name: string, error?: string): boolean {
    const c = this.group.get(name);
    if (!c || !(c.touched || c.dirty)) return false;
    return error ? c.hasError(error) : c.invalid;
  }

  /** Cross-field errors on the group, shown once either field was touched. */
  groupError(error: string, ...fields: string[]): boolean {
    return this.group.hasError(error) && fields.some((f) => this.group.get(f)?.touched || this.group.get(f)?.dirty);
  }

  ruleInvalid(c: FormControl<string>): boolean {
    return c.invalid && (c.touched || c.dirty);
  }

  addRule(): void {
    if (this.rules.length >= this.maxRules) return;
    this.rules.push(houseRuleControl());
    this.rules.markAsDirty();
    // Focus the new line once it is rendered.
    setTimeout(() => document.getElementById(`hs-rule-${this.rules.length - 1}`)?.focus());
  }

  removeRule(i: number): void {
    this.rules.removeAt(i);
    this.rules.markAsDirty();
  }

  moveRule(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.rules.length) return;
    const c = this.rules.at(i);
    this.rules.removeAt(i, { emitEvent: false });
    this.rules.insert(j, c);
    this.rules.markAsDirty();
  }
}
