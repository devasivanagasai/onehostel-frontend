import { Component, ElementRef, Input, QueryList, ViewChildren, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * A one-time code as separate boxes, one digit each, usable as a form control (its value is the
 * digits typed so far, e.g. "1234"). Typing moves to the next box, Backspace to the previous one,
 * and pasting or SMS autofill ("one-time-code") fills every box at once.
 *
 *   <app-otp-input formControlName="otp" [invalid]="otp.invalid && otp.touched" ariaLabel="Sign-in code" />
 */
@Component({
  selector: 'app-otp-input',
  standalone: true,
  template: `
    <div class="otp" role="group" [attr.aria-label]="ariaLabel">
      @for (digit of digits(); track $index; let i = $index) {
        <input
          #box
          class="otp__box"
          [class.otp__box--filled]="digit"
          [class.otp__box--invalid]="invalid"
          type="text"
          inputmode="numeric"
          [attr.autocomplete]="i === 0 ? 'one-time-code' : 'off'"
          [attr.maxlength]="i === 0 ? length : 1"
          [attr.aria-label]="'Digit ' + (i + 1) + ' of ' + length"
          [value]="digit"
          [disabled]="disabled()"
          (input)="onInput(i, box)"
          (keydown)="onKeydown(i, $event)"
          (paste)="onPaste(i, $event)"
          (focus)="box.select()"
          (blur)="onTouched()"
        />
      }
    </div>
  `,
  styleUrl: './app-otp-input.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AppOtpInputComponent), multi: true }],
})
export class AppOtpInputComponent implements ControlValueAccessor {
  @Input() length = 6;
  @Input() ariaLabel = 'One-time code';
  /** Draws the boxes in the error colour. */
  @Input() invalid = false;

  @ViewChildren('box') private boxes!: QueryList<ElementRef<HTMLInputElement>>;

  readonly digits = signal<string[]>(Array(6).fill(''));
  readonly disabled = signal(false);

  private onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    const chars = (value ?? '').replace(/\D/g, '').slice(0, this.length).split('');
    this.digits.set(Array.from({ length: this.length }, (_, i) => chars[i] ?? ''));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  /** Puts the cursor in the first empty box. */
  focus(): void {
    const first = this.digits().findIndex((d) => !d);
    this.focusBox(first === -1 ? this.length - 1 : first);
  }

  onInput(index: number, box: HTMLInputElement): void {
    const typed = box.value.replace(/\D/g, '');
    if (typed.length > 1) {
      // SMS autofill or a fast typist: spread the digits from this box on.
      this.fillFrom(index, typed);
      return;
    }
    this.setDigit(index, typed);
    box.value = typed;
    if (typed && index < this.length - 1) this.focusBox(index + 1);
  }

  onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      event.preventDefault();
      this.setDigit(index - 1, '');
      this.focusBox(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusBox(index - 1);
    } else if (event.key === 'ArrowRight' && index < this.length - 1) {
      event.preventDefault();
      this.focusBox(index + 1);
    }
  }

  onPaste(index: number, event: ClipboardEvent): void {
    const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
    event.preventDefault();
    if (pasted) this.fillFrom(pasted.length >= this.length ? 0 : index, pasted);
  }

  private fillFrom(start: number, value: string): void {
    const next = [...this.digits()];
    for (let i = 0; i < value.length && start + i < this.length; i++) next[start + i] = value[i];
    this.update(next);
    this.focusBox(Math.min(start + value.length, this.length - 1));
  }

  private setDigit(index: number, digit: string): void {
    const next = [...this.digits()];
    next[index] = digit;
    this.update(next);
  }

  private update(next: string[]): void {
    this.digits.set(next);
    this.onChange(next.join(''));
  }

  private focusBox(index: number): void {
    setTimeout(() => this.boxes.get(index)?.nativeElement.focus());
  }
}
