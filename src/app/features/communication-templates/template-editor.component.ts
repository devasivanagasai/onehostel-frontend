import { AfterViewInit, Component, DestroyRef, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  COMMUNICATION_CHANNELS,
  CommunicationChannel,
  CommunicationTemplateRow,
  TEMPLATE_TRIGGERS,
  TEMPLATE_VARIABLES,
} from './communication-template.models';
import { CommunicationTemplateService } from './communication-template.service';
import { UnsavedChangesAware } from '../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../shared/services/confirm-dialog.service';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';

const SMS_SEGMENT_LENGTH = 160;
const BODY_MAX_LENGTH = 5000;
/** Variable chip colours, in order. */
const CHIP_TONES = ['blue', 'green', 'purple', 'amber', 'pink'];
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const LIST_URL = '/communication-templates';

export type TemplateEditorMode = 'add' | 'edit' | 'view';

/**
 * Full-page screen for creating, editing and viewing a communication template.
 * The mode comes from the route's `data.mode`; edit/view read the template by `:id`.
 */
@Component({
  selector: 'app-template-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    AppButtonComponent,
  ],
  template: `
    <div class="editor-page">
      <!-- Top bar: back · status toggle (title/subtitle are in the layout header) -->
      <div class="editor-topbar">
        <button type="button" class="back-link" (click)="onCancel()">
          <mat-icon>arrow_back</mat-icon>
          Back to List
        </button>

        <div class="editor-topbar__right" [formGroup]="templateForm">
          <label class="status-toggle" for="template-status">
            <span>Status: <strong>{{ templateForm.get('isActive')?.value ? 'Active' : 'Inactive' }}</strong></span>
            <mat-slide-toggle id="template-status" hideIcon formControlName="isActive" aria-label="Template status"></mat-slide-toggle>
          </label>

          <span class="topbar-divider" aria-hidden="true"></span>

          <app-button variant="secondary" (clicked)="onCancel()">{{ isView ? 'Close' : 'Cancel' }}</app-button>
          @if (isView) {
            <app-button icon="edit" (clicked)="onSwitchToEdit()">Edit Template</app-button>
          } @else {
            <app-button type="submit" form="templateEditorForm" [disabled]="templateForm.invalid">{{ mode === 'edit' ? 'Update' : 'Submit' }}</app-button>
          }
        </div>
      </div>

      <form [formGroup]="templateForm" (ngSubmit)="onSubmit()" id="templateEditorForm" class="editor-layout">
        <!-- Left column: form -->
        <div class="editor-main">
          <!-- Template Details -->
          <section class="editor-card">
            <h2 class="step-title">Template Details</h2>

            <div class="fields-grid">
              <!-- Template ID -->
              <div class="field-group">
                <label class="field-label" for="tpl-id">
                  Template ID
                  <mat-icon class="info-icon" matTooltip="Generated automatically and can't be changed">info_outline</mat-icon>
                </label>
                <div class="readonly-box">
                  <input id="tpl-id" class="readonly-box__input" formControlName="templateId" readonly />
                  <mat-icon class="readonly-box__lock">lock_outline</mat-icon>
                </div>
                <span class="field-hint">Auto-generated</span>
              </div>

              <!-- Template Name -->
              <div class="field-group">
                <label class="field-label" for="tpl-name">Template Name <span class="required-star">*</span></label>
                <mat-form-field appearance="outline" class="full-width">
                  <input id="tpl-name" matInput formControlName="templateName" placeholder="Enter template name" />
                  <mat-error>Template Name is required</mat-error>
                </mat-form-field>
              </div>

              <!-- Communication Channel -->
              <div class="field-group">
                <label class="field-label">Communication Channel <span class="required-star">*</span></label>
                <mat-form-field appearance="outline" class="full-width">
                  <mat-icon matPrefix class="field-prefix" fontSet="material-icons-outlined">{{ channelIcon }}</mat-icon>
                  <mat-select formControlName="channel" placeholder="Select channel" aria-label="Communication channel">
                    @for (ch of channels; track ch.value) {
                      <mat-option [value]="ch.value">{{ ch.value }}</mat-option>
                    }
                  </mat-select>
                  <mat-error>Channel is required</mat-error>
                </mat-form-field>
              </div>

              <!-- Event / Trigger -->
              <div class="field-group">
                <label class="field-label">Event / Trigger <span class="required-star">*</span></label>
                <mat-form-field appearance="outline" class="full-width">
                  <mat-select formControlName="trigger" placeholder="Select event or trigger" aria-label="Event or trigger">
                    @for (t of triggers; track t) {
                      <mat-option [value]="t">{{ t }}</mat-option>
                    }
                  </mat-select>
                  <mat-error>Event / Trigger is required</mat-error>
                </mat-form-field>
              </div>

              <!-- Subject (Email) / Title (Push); hidden for SMS -->
              @if (hasSubject) {
                <div class="field-group field-group--wide">
                  <label class="field-label" for="tpl-subject">
                    {{ channel === 'Push Notification' ? 'Title' : 'Subject' }} <span class="required-star">*</span>
                  </label>
                  <mat-form-field appearance="outline" class="full-width">
                    <input
                      id="tpl-subject"
                      #subjectInput
                      matInput
                      formControlName="subject"
                      [placeholder]="channel === 'Push Notification' ? 'Enter notification title' : 'Enter email subject'"
                      (focus)="activeField = 'subject'"
                    />
                    <mat-error>{{ channel === 'Push Notification' ? 'Title' : 'Subject' }} is required</mat-error>
                  </mat-form-field>
                </div>
              }
            </div>
          </section>

          <!-- Message Content -->
          <section class="editor-card">
            <h2 class="step-title">Message Content</h2>

            @if (!isView) {
              <p class="section-hint">Click a variable to insert it at the cursor</p>
              <div class="variable-chips">
                @for (v of variables; track v.key; let i = $index) {
                  <button
                    type="button"
                    class="variable-chip variable-chip--{{ chipTone(i) }}"
                    [matTooltip]="v.label"
                    (mousedown)="$event.preventDefault()"
                    (click)="insertVariable(v.key)"
                  >
                    {{ '{{' + v.key + '}}' }}
                  </button>
                }
              </div>
            }

            <div class="field-group">
              <label class="field-label" for="tpl-body">Message Body <span class="required-star">*</span></label>
              <div class="body-box" [class.body-box--invalid]="templateForm.get('body')?.invalid && templateForm.get('body')?.touched">
                <textarea
                  id="tpl-body"
                  #bodyInput
                  (input)="autoGrow()"
                  class="body-box__input"
                  formControlName="body"
                  rows="5"
                  [attr.maxlength]="bodyMax"
                  placeholder="Type your message here... Use the variables above to personalize your message."
                  (focus)="activeField = 'body'"
                ></textarea>
                <div class="body-box__footer">
                  <mat-icon class="body-box__icon">text_fields</mat-icon>
                  <span class="char-count" [class.char-count--over]="channel === 'SMS' && bodyLength > smsSegmentLength">
                    @if (channel === 'SMS') {
                      {{ bodyLength }} / {{ smsSegmentLength }}
                      @if (smsSegments > 1) {
                        ({{ smsSegments }} SMS)
                      }
                    } @else {
                      {{ bodyLength }} / {{ bodyMax }}
                    }
                  </span>
                </div>
              </div>
              @if (templateForm.get('body')?.invalid && templateForm.get('body')?.touched) {
                <span class="field-error">Message Body is required</span>
              }
            </div>

            @if (unknownVariables.length > 0) {
              <div class="unknown-vars">
                <mat-icon>warning_amber</mat-icon>
                <span>Unknown variable{{ unknownVariables.length > 1 ? 's' : '' }}: {{ unknownVariables.join(', ') }}</span>
              </div>
            }
          </section>
        </div>

        <!-- Right column: live preview -->
        <aside class="editor-side">
          <section class="editor-card editor-card--preview">
            <h2 class="preview-title">
              <span class="preview-title__icon"><mat-icon>visibility</mat-icon></span>
              Live Preview — {{ channel || 'Channel' }}
            </h2>

            <div class="preview-card" [ngClass]="'preview-card--' + channelClass">
              @if (hasSubject) {
                <div class="preview-card__subject">
                  <strong>{{ channel === 'Push Notification' ? 'Title' : 'Subject' }}:</strong>
                  @for (part of previewParts(templateForm.get('subject')?.value); track $index) {
                    <span [class.preview-var]="part.isVar">{{ part.text }}</span>
                  } @empty {
                    <span class="preview-placeholder">{{ channel === 'Push Notification' ? 'Notification title' : 'Email subject' }}</span>
                  }
                </div>
              }
              <div class="preview-card__body">
                @for (part of previewParts(templateForm.get('body')?.value); track $index) {
                  <span [class.preview-var]="part.isVar">{{ part.text }}</span>
                } @empty {
                  <span class="preview-placeholder">Your message will appear here as you type.</span>
                }
              </div>
            </div>

            <div class="sample-values">
              <h3 class="sample-values__title">Sample Values</h3>
              <table class="sample-table">
                <tbody>
                  @for (v of variables; track v.key) {
                    <tr>
                      <td class="sample-table__key">{{ '{{' + v.key + '}}' }}</td>
                      <td class="sample-table__value" [class.sample-table__value--link]="v.key === 'login_link'">{{ v.sample }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </aside>
      </form>
    </div>
  `,
  styles: [`
    .editor-page {
      padding: 4px 0 0;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    /* ---- Top bar ---- */
    /* Back to List on the left; status, Cancel and Submit/Update on the right (same as the Onboard Hostel wizard). */
    .editor-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    /* Same "Back to List" link as the Onboard Hostel wizard */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0;
      background: transparent;
      border: none;
      color: #64748b;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        color: #0f172a;
      }
    }

    .editor-topbar__right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-toggle {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      color: #334155;
      cursor: pointer;

      strong {
        font-weight: 600;
        color: #0f172a;
      }
    }

    /* Blue switch, as in the reference */
    .status-toggle ::ng-deep .mat-mdc-slide-toggle {
      --mdc-switch-selected-track-color: #2563eb;
      --mdc-switch-selected-focus-track-color: #2563eb;
      --mdc-switch-selected-hover-track-color: #1d4ed8;
      --mdc-switch-selected-pressed-track-color: #1d4ed8;
      --mdc-switch-selected-handle-color: #ffffff;
      --mdc-switch-selected-focus-handle-color: #ffffff;
      --mdc-switch-selected-hover-handle-color: #ffffff;
      --mdc-switch-selected-pressed-handle-color: #ffffff;

      .mdc-switch.mdc-switch--selected:enabled .mdc-switch__track::after {
        background: #2563eb !important;
      }

      .mdc-switch.mdc-switch--selected:enabled .mdc-switch__handle::after {
        background: #ffffff !important;
      }
    }

    /* ---- Layout ---- */
    .editor-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 440px;
      gap: 20px;
      align-items: start;
    }

    .editor-main {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    @media (max-width: 1200px) {
      .editor-layout {
        grid-template-columns: 1fr;
      }

      .editor-card--preview {
        position: static !important;
      }
    }

    .editor-card {
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(15, 34, 74, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04);
      padding: 20px 22px 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .step-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 4px;
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }

    .section-hint {
      margin: -4px 0 0;
      font-size: 13px;
      color: #64748b;
    }

    /* ---- Fields ---- */
    .fields-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px 18px;
    }

    .field-group--wide {
      grid-column: span 2;
    }

    @media (max-width: 900px) {
      .fields-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 600px) {
      .fields-grid {
        grid-template-columns: 1fr;
      }

      .field-group--wide {
        grid-column: auto;
      }

      .editor-card {
        padding: 18px 16px;
      }
    }

    .field-group {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .field-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
    }

    .info-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: #94a3b8;
      cursor: help;
    }

    .required-star {
      color: #ef4444;
    }

    .field-hint {
      margin-top: 6px;
      font-size: 12px;
      color: #94a3b8;
    }

    .field-error {
      margin-top: 6px;
      font-size: 12px;
      color: #dc2626;
    }

    /* Read-only Template ID: grey box with a lock */
    .readonly-box {
      display: flex;
      align-items: center;
      height: 42px;
      padding: 0 12px;
      border-radius: 8px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
    }

    .readonly-box__input {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      outline: none;
      font: inherit;
      font-size: 14px;
      color: #64748b;
      cursor: not-allowed;
    }

    .readonly-box__lock {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #94a3b8;
    }

    /* Inline styles are plain CSS: ::ng-deep must be written flat, not nested, or Angular drops it. */
    .full-width {
      width: 100%;
    }

    .full-width ::ng-deep .mat-mdc-text-field-wrapper {
      background-color: #ffffff !important;
      border-radius: 8px !important;
      padding: 0 12px !important;
      height: 42px !important;
    }

    .full-width ::ng-deep .mat-mdc-form-field-flex {
      height: 42px !important;
      align-items: center !important;
    }

    .full-width ::ng-deep .mat-mdc-form-field-infix {
      padding: 6px 0 !important;
      min-height: 0 !important;
      border-top: none !important;
      display: flex;
      align-items: center;
      font-size: 14px;
    }

    .full-width ::ng-deep .mat-mdc-form-field-icon-prefix {
      padding: 0 8px 0 0 !important;
    }

    .full-width ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      margin-top: 2px;
    }

    .full-width ::ng-deep .mdc-notched-outline__leading,
    .full-width ::ng-deep .mdc-notched-outline__notch,
    .full-width ::ng-deep .mdc-notched-outline__trailing {
      border-color: #dbe2ea !important;
      border-width: 1px !important;
    }

    .full-width ::ng-deep .mat-mdc-select-trigger {
      display: flex;
      align-items: center;
      height: 100%;
    }

    .full-width ::ng-deep .mat-mdc-select-value,
    .full-width ::ng-deep input.mat-mdc-input-element {
      font-size: 14px;
      color: #0f172a;
    }

    .field-prefix {
      font-size: 19px;
      width: 19px;
      height: 19px;
      color: #475569;
    }

    /* Disabled (view mode) fields read as plain values, not greyed-out inputs */
    :host ::ng-deep .mat-mdc-form-field.mat-form-field-disabled .mat-mdc-text-field-wrapper {
      background-color: #f8fafc !important;
    }

    :host ::ng-deep .mat-mdc-form-field.mat-form-field-disabled input.mat-mdc-input-element,
    :host ::ng-deep .mat-mdc-form-field.mat-form-field-disabled .mat-mdc-select-value {
      color: #0f172a !important;
    }

    /* ---- Variables ---- */
    .variable-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .variable-chip {
      padding: 7px 12px;
      border: 1px solid transparent;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: filter 0.15s ease, border-color 0.15s ease;

      &:hover {
        filter: brightness(0.96);
        border-color: currentColor;
      }

      &:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
    }

    .variable-chip--blue { background: #e8f0ff; color: #1d4ed8; }
    .variable-chip--green { background: #e3f7ec; color: #15803d; }
    .variable-chip--purple { background: #efeafe; color: #6d28d9; }
    .variable-chip--amber { background: #fff4e0; color: #b45309; }
    .variable-chip--pink { background: #fde8ee; color: #be123c; }

    /* ---- Message body ---- */
    .body-box {
      border: 1px solid #dbe2ea;
      border-radius: 8px;
      background: #ffffff;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;

      &:focus-within {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
    }

    .body-box--invalid {
      border-color: #dc2626;
    }

    .body-box__input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px 4px;
      border: none;
      outline: none;
      /* Grows with its content (autoGrow); no manual resize handle. */
      resize: none;
      overflow: hidden;
      min-height: 130px;
      background: transparent;
      font: inherit;
      font-size: 14px;
      line-height: 1.55;
      color: #0f172a;

      &::placeholder {
        color: #94a3b8;
      }

      &:disabled {
        color: #0f172a;
        background: #f8fafc;
      }
    }

    .body-box__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px 8px;
    }

    .body-box__icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #64748b;
    }

    .char-count {
      font-size: 12px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
    }

    .char-count--over {
      color: #d97706;
      font-weight: 600;
    }

    .unknown-vars {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      color: #b45309;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 8px 12px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    /* ---- Live preview ---- */
    .editor-card--preview {
      position: sticky;
      top: 16px;
      background: #f8fafc;
    }

    .preview-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }

    .preview-title__icon {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #e8f0ff;
      color: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 19px;
        width: 19px;
        height: 19px;
      }
    }

    .preview-card {
      background: #ffffff;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(15, 34, 74, 0.06), 0 0 0 1px #eef2f7;
      font-size: 13px;
      color: #334155;
    }

    .preview-card__subject {
      padding: 14px 18px 12px;
      border-bottom: 1px solid #eef2f7;
      font-size: 13px;
      color: #334155;
      word-break: break-word;

      strong {
        margin-right: 4px;
        color: #0f172a;
      }
    }

    .preview-card__body {
      padding: 16px 18px 18px;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 120px;
    }

    .preview-var {
      font-weight: 600;
      color: #2563eb;
    }

    .preview-placeholder {
      color: #94a3b8;
      font-style: italic;
    }

    /* SMS: chat bubble */
    .preview-card--sms .preview-card__body {
      margin: 14px;
      padding: 12px 14px;
      border-radius: 16px 16px 16px 4px;
      background: #eef2f7;
      min-height: 0;
    }

    .sample-values__title {
      margin: 4px 0 8px;
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
    }

    .sample-table {
      width: 100%;
      border-collapse: collapse;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 0 0 1px #e2e8f0;
      font-size: 12.5px;

      td {
        padding: 8px 10px;
        border-bottom: 1px solid #eef2f7;
        word-break: break-all;
      }

      tr:last-child td {
        border-bottom: none;
      }
    }

    .sample-table__key {
      width: 48%;
      color: #475569;
      border-right: 1px solid #eef2f7;
    }

    .sample-table__value {
      font-weight: 600;
      color: #0f172a;
    }

    .sample-table__value--link {
      color: #2563eb;
    }

    /* ---- Actions (top bar) ---- */
    .topbar-divider {
      width: 1px;
      height: 24px;
      background: #e2e8f0;
    }
  `],
})
export class TemplateEditorComponent implements UnsavedChangesAware, AfterViewInit {
  @ViewChild('subjectInput') subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyInput') bodyInput?: ElementRef<HTMLTextAreaElement>;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly templateService = inject(CommunicationTemplateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly channels = COMMUNICATION_CHANNELS;
  readonly triggers = TEMPLATE_TRIGGERS;
  readonly variables = TEMPLATE_VARIABLES;
  readonly smsSegmentLength = SMS_SEGMENT_LENGTH;
  readonly bodyMax = BODY_MAX_LENGTH;

  readonly mode: TemplateEditorMode = this.route.snapshot.data['mode'] ?? 'add';
  private readonly template?: CommunicationTemplateRow;

  templateForm!: FormGroup;
  /** Which content field receives a clicked variable chip. */
  activeField: 'subject' | 'body' = 'body';
  /** Set once saved so the leave-guard doesn't prompt on the redirect back to the list. */
  private saved = false;

  constructor() {
    if (this.mode !== 'add') {
      const id = this.route.snapshot.paramMap.get('id') ?? '';
      this.template = this.templateService.getById(id);
      if (!this.template) {
        this.saved = true;
        this.snackBar.open(`Template ${id} was not found`, 'x', { duration: 4000, panelClass: 'app-snackbar--error' });
        this.router.navigateByUrl(LIST_URL);
      }
    }
    this.initForm();
  }

  get isView(): boolean {
    return this.mode === 'view';
  }

  get channel(): CommunicationChannel | '' {
    return this.templateForm.get('channel')?.value ?? '';
  }

  /** SMS has no subject line; Push uses the same field as its title. */
  get hasSubject(): boolean {
    return this.channel === 'Email' || this.channel === 'Push Notification';
  }

  get channelIcon(): string {
    return COMMUNICATION_CHANNELS.find((c) => c.value === this.channel)?.icon ?? 'chat';
  }

  get channelClass(): string {
    if (this.channel === 'SMS') return 'sms';
    if (this.channel === 'Push Notification') return 'push';
    return 'email';
  }

  get bodyLength(): number {
    return (this.templateForm.get('body')?.value ?? '').length;
  }

  get smsSegments(): number {
    return Math.max(1, Math.ceil(this.bodyLength / SMS_SEGMENT_LENGTH));
  }

  get unknownVariables(): string[] {
    const known = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
    const text = `${this.hasSubject ? this.templateForm.get('subject')?.value ?? '' : ''} ${
      this.templateForm.get('body')?.value ?? ''
    }`;
    const unknown = new Set<string>();
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      if (!known.has(match[1])) unknown.add(`{{${match[1]}}}`);
    }
    return [...unknown];
  }

  private get hasUnsavedChanges(): boolean {
    return !this.saved && !this.isView && this.templateForm.dirty;
  }

  private initForm(): void {
    const existing = this.template;

    this.templateForm = this.fb.group({
      templateId: [existing?.templateId ?? this.templateService.getNextTemplateId()],
      templateName: [existing?.templateName ?? '', [Validators.required]],
      channel: [existing?.channel ?? 'Email', [Validators.required]],
      trigger: [existing?.trigger ?? '', [Validators.required]],
      subject: [existing?.subject ?? ''],
      body: [existing?.body ?? '', [Validators.required, Validators.maxLength(BODY_MAX_LENGTH)]],
      isActive: [existing ? existing.status === 'Active' : true],
    });

    this.updateSubjectValidator();
    this.templateForm
      .get('channel')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateSubjectValidator());

    if (this.isView) this.templateForm.disable({ emitEvent: false });
  }

  private updateSubjectValidator(): void {
    const subject = this.templateForm.get('subject');
    subject?.setValidators(this.hasSubject ? [Validators.required] : []);
    subject?.updateValueAndValidity({ emitEvent: false });
    if (!this.hasSubject) this.activeField = 'body';
  }

  /** The code is no longer entered on screen: "Password Reset" → "PASSWORD_RESET". */
  private toTemplateCode(name: string): string {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  insertVariable(key: string): void {
    const target = this.activeField === 'subject' && this.hasSubject ? 'subject' : 'body';
    const el = target === 'subject' ? this.subjectInput?.nativeElement : this.bodyInput?.nativeElement;
    const control = this.templateForm.get(target);
    if (!control) return;

    const token = `{{${key}}}`;
    const value: string = control.value ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    control.setValue(value.slice(0, start) + token + value.slice(end));
    control.markAsDirty();
    if (target === 'body') setTimeout(() => this.autoGrow(), 0);

    if (el) {
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    }
  }

  /** Sizes the Message Body to fit its text, so it expands as you type. */
  autoGrow(): void {
    const el = this.bodyInput?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  ngAfterViewInit(): void {
    // Existing templates open with the box already sized to their message.
    setTimeout(() => this.autoGrow(), 0);
  }

  chipTone(index: number): string {
    return CHIP_TONES[index % CHIP_TONES.length];
  }

  /** Preview text split into plain parts and substituted sample values (which are highlighted). */
  previewParts(text: string | null | undefined): { text: string; isVar: boolean }[] {
    if (!text) return [];
    const samples = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
    const parts: { text: string; isVar: boolean }[] = [];
    let last = 0;
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      const at = match.index ?? 0;
      if (at > last) parts.push({ text: text.slice(last, at), isVar: false });
      const sample = samples.get(match[1]);
      parts.push({ text: sample ?? match[0], isVar: sample !== undefined });
      last = at + match[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), isVar: false });
    return parts;
  }

  renderPreview(text: string | null | undefined): string {
    if (!text) return '';
    const samples = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
    return text.replace(VARIABLE_PATTERN, (whole, key: string) => samples.get(key) ?? whole);
  }

  /** Route guard hook: asks before discarding unsaved edits. */
  confirmLeave(): Observable<boolean> {
    if (!this.hasUnsavedChanges) return of(true);
    return this.confirm.confirm({
      title: 'Leave without saving?',
      message: 'You have unsaved changes to this template. They will be lost.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: true,
    });
  }

  /** Browser refresh / tab close. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges) event.preventDefault();
  }

  onSwitchToEdit(): void {
    if (this.template) this.router.navigate([LIST_URL, this.template.templateId, 'edit']);
  }

  onCancel(): void {
    this.router.navigateByUrl(LIST_URL);
  }

  onSubmit(): void {
    if (this.isView) return;
    if (this.templateForm.invalid) {
      this.templateForm.markAllAsTouched();
      return;
    }

    const formVal = this.templateForm.getRawValue();
    const result: CommunicationTemplateRow = {
      templateId: formVal.templateId,
      templateName: formVal.templateName.trim(),
      // Existing templates keep their code so anything keyed on it stays stable.
      templateCode: this.template?.templateCode ?? this.toTemplateCode(formVal.templateName),
      channel: formVal.channel,
      trigger: formVal.trigger,
      subject: this.hasSubject ? formVal.subject.trim() : '',
      body: formVal.body,
      status: formVal.isActive ? 'Active' : 'Inactive',
      lastModified: new Date().toISOString().split('T')[0],
    };

    const isNew = this.templateService.save(result);
    this.saved = true;
    this.snackBar.open(`Template ${isNew ? 'created' : 'updated'} successfully`, 'x', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['app-snackbar--success', 'green-snackbar'],
    });
    this.router.navigateByUrl(LIST_URL);
  }
}
