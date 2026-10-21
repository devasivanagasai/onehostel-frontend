import { ValidationErrors } from '@angular/forms';

/**
 * Central map from a validator's error key to a human-readable message.
 * Add one entry per validator (built-in or from CustomValidators) so every
 * form in the app shows the same wording for the same mistake.
 */
const MESSAGES: Record<string, (error: unknown, fieldLabel: string) => string> = {
  required: (_e, label) => `${label} is required.`,
  email: (_e, label) => `Enter a valid email address.`,
  minlength: (e, label) => {
    const err = e as { requiredLength: number };
    return `${label} must be at least ${err.requiredLength} characters.`;
  },
  maxlength: (e, label) => {
    const err = e as { requiredLength: number };
    return `${label} must be no more than ${err.requiredLength} characters.`;
  },
  min: (e, label) => {
    const err = e as { min: number };
    return `${label} must be at least ${err.min}.`;
  },
  max: (e, label) => {
    const err = e as { max: number };
    return `${label} must be no more than ${err.max}.`;
  },
  pattern: (_e, label) => `${label} format is invalid.`,
  whitespace: (_e, label) => `${label} cannot be blank.`,
  phoneNumber: (_e, label) => `Enter a valid phone number.`,
  fieldMismatch: (_e, label) => `${label} does not match.`,
  /** Set by a form from the backend's reply; the value is the backend's message. */
  server: (e) => String(e),
  minAge: (e, label) => {
    const err = e as { requiredAge: number };
    return `${label} must be at least ${err.requiredAge} years.`;
  },
};

/** Returns the first applicable error message for a control's errors object, or null. */
export function getFirstErrorMessage(errors: ValidationErrors | null, fieldLabel: string): string | null {
  if (!errors) return null;
  const key = Object.keys(errors)[0];
  const resolver = MESSAGES[key];
  return resolver ? resolver(errors[key], fieldLabel) : `${fieldLabel} is invalid.`;
}
