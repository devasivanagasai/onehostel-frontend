import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppButtonComponent } from '../../shared/components/button/app-button.component';
import {
  COMMUNICATION_CHANNELS,
  CommunicationChannel,
  CommunicationTemplateRow,
  TEMPLATE_TRIGGERS,
  TEMPLATE_VARIABLES,
} from './communication-template.models';

const SMS_SEGMENT_LENGTH = 160;
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

@Component({
  selector: 'app-template-side-panel',
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
    <!-- Overlay Backdrop -->
    <div class="panel-backdrop" *ngIf="isOpen" (click)="onCancel()"></div>

    <!-- Side Panel Drawer -->
    <div class="side-panel-drawer" [class.side-panel-drawer--open]="isOpen">

      <!-- Panel Header -->
      <div class="panel-header">
        <h2 class="panel-title">{{ panelTitle }}</h2>
        <app-button variant="icon" icon="close" ariaLabel="Close panel" (clicked)="onCancel()"></app-button>
      </div>

      <!-- Panel Body -->
      <div class="panel-body" #panelBody>
        <form [formGroup]="templateForm" (ngSubmit)="onSubmit()" id="sideTemplateForm">

          <div class="fields-grid">
            <!-- Template ID -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Template ID</span>
                <span class="auto-badge"><mat-icon class="badge-icon">auto_awesome</mat-icon> Auto-generated</span>
              </label>
              <mat-form-field appearance="outline" class="full-width readonly-field">
                <input matInput formControlName="templateId" readonly />
                <mat-icon matSuffix class="suffix-lock">lock</mat-icon>
              </mat-form-field>
            </div>

            <!-- Status -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Status</span>
              </label>
              <div class="status-toggle-box">
                <mat-slide-toggle formControlName="isActive" color="primary"></mat-slide-toggle>
                <span class="status-toggle-text" [class.status-toggle-text--on]="templateForm.get('isActive')?.value">
                  {{ templateForm.get('isActive')?.value ? 'Active' : 'Inactive' }}
                </span>
              </div>
            </div>

            <!-- Template Name -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Template Name <span class="required-star">*</span></span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="templateName" placeholder="Enter Template Name" (input)="onNameInput()" />
                <mat-error *ngIf="templateForm.get('templateName')?.hasError('required')">
                  Template Name is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Template Code -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Template Code <span class="required-star">*</span></span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input matInput formControlName="templateCode" placeholder="e.g. ADMIN_ACCOUNT_CREATED" (input)="onCodeInput()" />
                <mat-error *ngIf="templateForm.get('templateCode')?.hasError('required')">
                  Template Code is required
                </mat-error>
                <mat-error *ngIf="templateForm.get('templateCode')?.hasError('pattern')">
                  Use capital letters, numbers and underscores only
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Communication Channel -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Communication Channel <span class="required-star">*</span></span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <mat-select formControlName="channel" placeholder="-Select-">
                  <mat-option *ngFor="let ch of channels" [value]="ch.value">{{ ch.value }}</mat-option>
                </mat-select>
                <mat-error *ngIf="templateForm.get('channel')?.hasError('required')">
                  Channel is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Event / Trigger -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Event / Trigger <span class="required-star">*</span></span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <mat-select formControlName="trigger" placeholder="-Select-">
                  <mat-option *ngFor="let t of triggers" [value]="t">{{ t }}</mat-option>
                </mat-select>
                <mat-error *ngIf="templateForm.get('trigger')?.hasError('required')">
                  Event / Trigger is required
                </mat-error>
              </mat-form-field>
            </div>
          </div>

          <!-- Message Content Section -->
          <div class="content-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">Message Content</h3>
                <p class="section-subtitle" *ngIf="!isView">Click a variable to insert it at the cursor</p>
              </div>
            </div>

            <div class="variable-chips" *ngIf="!isView">
              <button
                *ngFor="let v of variables"
                type="button"
                class="variable-chip"
                [matTooltip]="v.label"
                (mousedown)="$event.preventDefault()"
                (click)="insertVariable(v.key)"
              >
                {{ '{{' + v.key + '}}' }}
              </button>
            </div>

            <!-- Subject (Email) / Title (Push) -->
            <div class="field-group" *ngIf="hasSubject">
              <label class="field-label">
                <span class="label-text">
                  {{ channel === 'Push Notification' ? 'Title' : 'Subject' }} <span class="required-star">*</span>
                </span>
              </label>
              <mat-form-field appearance="outline" class="full-width">
                <input
                  #subjectInput
                  matInput
                  formControlName="subject"
                  [placeholder]="channel === 'Push Notification' ? 'Enter Notification Title' : 'Enter Email Subject'"
                  (focus)="activeField = 'subject'"
                />
                <mat-error *ngIf="templateForm.get('subject')?.hasError('required')">
                  {{ channel === 'Push Notification' ? 'Title' : 'Subject' }} is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Message Body -->
            <div class="field-group">
              <label class="field-label">
                <span class="label-text">Message Body <span class="required-star">*</span></span>
                <span class="char-count" *ngIf="channel === 'SMS'" [class.char-count--over]="bodyLength > smsSegmentLength">
                  {{ bodyLength }} / {{ smsSegmentLength }}
                  <ng-container *ngIf="smsSegments > 1">({{ smsSegments }} SMS)</ng-container>
                </span>
              </label>
              <mat-form-field appearance="outline" class="full-width textarea-field">
                <textarea
                  #bodyInput
                  matInput
                  formControlName="body"
                  [rows]="channel === 'Email' ? 9 : 5"
                  placeholder="Enter Message Body"
                  (focus)="activeField = 'body'"
                ></textarea>
                <mat-error *ngIf="templateForm.get('body')?.hasError('required')">
                  Message Body is required
                </mat-error>
              </mat-form-field>
            </div>

            <div class="unknown-vars" *ngIf="unknownVariables.length > 0">
              <mat-icon>warning_amber</mat-icon>
              <span>Unknown variable{{ unknownVariables.length > 1 ? 's' : '' }}: {{ unknownVariables.join(', ') }}</span>
            </div>
          </div>

          <!-- Preview -->
          <div class="preview-section">
            <div class="section-header">
              <div>
                <h3 class="section-title">Preview</h3>
                <p class="section-subtitle">Rendered with sample values</p>
              </div>
            </div>

            <div class="preview-card" [ngClass]="'preview-card--' + channelClass">
              <div class="preview-card__meta">
                <mat-icon>{{ channelIcon }}</mat-icon>
                <span>{{ channel || 'Channel' }}</span>
              </div>
              <div class="preview-card__subject" *ngIf="hasSubject">
                {{ renderPreview(templateForm.get('subject')?.value) || (channel === 'Push Notification' ? 'Title' : 'Subject') }}
              </div>
              <div class="preview-card__body">{{ renderPreview(templateForm.get('body')?.value) || 'Message body will appear here.' }}</div>
            </div>
          </div>

        </form>
      </div>

      <!-- Panel Footer -->
      <div class="panel-footer">
        <app-button variant="secondary" (clicked)="onCancel()">{{ isView ? 'Close' : 'Cancel' }}</app-button>
        <app-button *ngIf="isView" icon="edit" (clicked)="switchToEdit.emit()">Edit</app-button>
        <app-button *ngIf="!isView" type="submit" form="sideTemplateForm" [disabled]="templateForm.invalid">
          {{ mode === 'edit' ? 'Update' : 'Submit' }}
        </app-button>
      </div>

    </div>
  `,
  styles: [`
    .panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.12);
      z-index: 1050;
      animation: fadeIn 0.2s ease-out forwards;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .side-panel-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 640px;
      max-width: 100vw;
      height: 100vh;
      background: #ffffff;
      z-index: 1060;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .side-panel-drawer--open {
      transform: translateX(0);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #e2e8f0;
      background: #ffffff;
      flex-shrink: 0;
    }

    .panel-title {
      margin: 0;
      font-size: 17.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.2;
    }

    .panel-body {
      flex: 1;
      padding: 22px;
      overflow-y: auto;
    }

    .fields-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 16px;
      margin-bottom: 20px;
    }

    @media (max-width: 600px) {
      .fields-grid {
        grid-template-columns: 1fr;
      }
    }

    .field-group {
      display: flex;
      flex-direction: column;
    }

    .field-label {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .label-text {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .required-star {
      color: #ef4444;
      font-weight: 700;
      margin-left: 2px;
    }

    .auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-weight: 600;
      color: #0284c7;
      background: #e0f2fe;
      padding: 2px 8px;
      border-radius: 12px;

      .badge-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
      }
    }

    .full-width {
      width: 100%;

      ::ng-deep {
        .mat-mdc-text-field-wrapper {
          background-color: #ffffff !important;
          border-radius: 8px !important;
          padding: 0 14px !important;
          height: 44px !important;
        }

        .mat-mdc-form-field-flex {
          height: 44px !important;
          align-items: center !important;
        }

        .mat-mdc-form-field-infix {
          padding: 6px 0 !important;
          min-height: 0 !important;
          border-top: none !important;
          display: flex;
          align-items: center;
          font-size: 14px;
        }

        .mat-mdc-form-field-subscript-wrapper {
          margin-top: 2px;
        }

        .mdc-notched-outline__leading,
        .mdc-notched-outline__notch,
        .mdc-notched-outline__trailing {
          border-color: #cbd5e1 !important;
          border-width: 1px !important;
        }

        .mat-mdc-select-trigger {
          display: flex;
          align-items: center;
          height: 100%;
        }

        .mat-mdc-select-value {
          font-size: 14px;
          color: #0f172a;
        }

        input.mat-mdc-input-element,
        textarea.mat-mdc-input-element {
          font-size: 14px;
          color: #0f172a;
        }
      }
    }

    .textarea-field {
      ::ng-deep {
        .mat-mdc-text-field-wrapper,
        .mat-mdc-form-field-flex {
          height: auto !important;
        }

        .mat-mdc-form-field-infix {
          padding: 10px 0 !important;
        }

        textarea.mat-mdc-input-element {
          resize: vertical;
          line-height: 1.5;
          font-family: inherit;
        }
      }
    }

    .readonly-field {
      ::ng-deep .mat-mdc-text-field-wrapper {
        background-color: #f8fafc !important;
        cursor: not-allowed;
      }
      input {
        color: #475569 !important;
        font-weight: 600;
      }
      .suffix-lock {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #94a3b8;
      }
    }

    /* Disabled (view mode) fields read as plain values, not greyed-out inputs */
    :host ::ng-deep .mat-mdc-form-field.mat-form-field-disabled {
      .mat-mdc-text-field-wrapper {
        background-color: #f8fafc !important;
      }
      input.mat-mdc-input-element,
      textarea.mat-mdc-input-element,
      .mat-mdc-select-value {
        color: #0f172a !important;
      }
    }

    .status-toggle-box {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 44px;
      padding: 0 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
    }

    .status-toggle-text {
      font-size: 13.5px;
      font-weight: 600;
      color: #e11d48;
    }

    .status-toggle-text--on {
      color: #0d9488;
    }

    /* Message content */
    .content-section,
    .preview-section {
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
    }

    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }

    .section-subtitle {
      font-size: 12.5px;
      color: #64748b;
      margin: 2px 0 0 0;
    }

    .variable-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .variable-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: #0057e7;
      background: #eff6ff;
      border: 1px dashed #93c5fd;
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: #dbeafe;
        border-style: solid;
      }
    }

    .char-count {
      font-size: 11.5px;
      font-weight: 600;
      color: #64748b;
    }

    .char-count--over {
      color: #d97706;
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

    /* Preview */
    .preview-card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #f8fafc;
      padding: 14px 16px;
    }

    .preview-card--sms,
    .preview-card--push {
      max-width: 360px;
    }

    .preview-card--sms .preview-card__body {
      background: #e2e8f0;
      border-radius: 14px 14px 14px 4px;
      padding: 10px 12px;
    }

    .preview-card--push {
      background: #ffffff;
      box-shadow: 0 6px 18px rgba(15, 34, 74, 0.08);
    }

    .preview-card__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 10px;

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
      }
    }

    .preview-card__subject {
      font-size: 14.5px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
    }

    .preview-card__body {
      font-size: 13.5px;
      color: #334155;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    ::ng-deep {
      .mat-mdc-slide-toggle {
        --mdc-switch-selected-track-color: #10b981 !important;
        --mdc-switch-selected-focus-track-color: #10b981 !important;
        --mdc-switch-selected-hover-track-color: #059669 !important;
        --mdc-switch-selected-pressed-track-color: #059669 !important;
        --mdc-switch-selected-handle-color: #ffffff !important;
        --mdc-switch-selected-focus-handle-color: #ffffff !important;
        --mdc-switch-selected-hover-handle-color: #ffffff !important;
        --mdc-switch-selected-pressed-handle-color: #ffffff !important;
        --mdc-switch-selected-icon-color: #10b981 !important;
      }
    }

    /* Footer Actions */
    .panel-footer {
      padding: 16px 24px;
      border-top: 1px solid #e2e8f0;
      background: #f8fafc;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      flex-shrink: 0;
    }
  `],
})
export class TemplateSidePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() mode: 'add' | 'edit' | 'view' = 'add';
  @Input() template?: CommunicationTemplateRow;
  @Input() nextId?: string;

  @Output() closePanel = new EventEmitter<void>();
  @Output() switchToEdit = new EventEmitter<void>();
  @Output() saveTemplate = new EventEmitter<CommunicationTemplateRow>();

  @ViewChild('panelBody') panelBody?: ElementRef<HTMLElement>;
  @ViewChild('subjectInput') subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyInput') bodyInput?: ElementRef<HTMLTextAreaElement>;

  readonly channels = COMMUNICATION_CHANNELS;
  readonly triggers = TEMPLATE_TRIGGERS;
  readonly variables = TEMPLATE_VARIABLES;
  readonly smsSegmentLength = SMS_SEGMENT_LENGTH;

  templateForm!: FormGroup;
  /** Which content field receives a clicked variable chip. */
  activeField: 'subject' | 'body' = 'body';
  /** Stops auto-deriving the code from the name once the user types their own. */
  private codeEditedManually = false;

  constructor(private fb: FormBuilder) {
    this.initForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.initForm();
    if (changes['isOpen'] && this.isOpen) {
      setTimeout(() => {
        if (this.panelBody) this.panelBody.nativeElement.scrollTop = 0;
      }, 0);
    }
  }

  get isView(): boolean {
    return this.mode === 'view';
  }

  get panelTitle(): string {
    if (this.mode === 'view') return 'View Template';
    if (this.mode === 'edit') return 'Edit Template';
    return 'Add New Template';
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

  private initForm(): void {
    const existing = this.mode !== 'add' && this.template ? this.template : undefined;
    this.codeEditedManually = !!existing;
    this.activeField = 'body';

    this.templateForm = this.fb.group({
      templateId: [existing?.templateId ?? this.nextId ?? 'TMP001'],
      templateName: [existing?.templateName ?? '', [Validators.required]],
      templateCode: [existing?.templateCode ?? '', [Validators.required, Validators.pattern(/^[A-Z0-9_]+$/)]],
      channel: [existing?.channel ?? 'Email', [Validators.required]],
      trigger: [existing?.trigger ?? '', [Validators.required]],
      subject: [existing?.subject ?? ''],
      body: [existing?.body ?? '', [Validators.required]],
      isActive: [existing ? existing.status === 'Active' : true],
    });

    this.updateSubjectValidator();
    this.templateForm.get('channel')?.valueChanges.subscribe(() => this.updateSubjectValidator());

    if (this.isView) this.templateForm.disable({ emitEvent: false });
  }

  private updateSubjectValidator(): void {
    const subject = this.templateForm.get('subject');
    subject?.setValidators(this.hasSubject ? [Validators.required] : []);
    subject?.updateValueAndValidity({ emitEvent: false });
    if (!this.hasSubject) this.activeField = 'body';
  }

  onNameInput(): void {
    if (this.codeEditedManually) return;
    const name: string = this.templateForm.get('templateName')?.value ?? '';
    const code = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    this.templateForm.get('templateCode')?.setValue(code);
  }

  onCodeInput(): void {
    this.codeEditedManually = true;
    const control = this.templateForm.get('templateCode');
    const value: string = control?.value ?? '';
    if (value !== value.toUpperCase()) control?.setValue(value.toUpperCase());
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

    if (el) {
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    }
  }

  renderPreview(text: string | null | undefined): string {
    if (!text) return '';
    const samples = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
    return text.replace(VARIABLE_PATTERN, (whole, key: string) => samples.get(key) ?? whole);
  }

  onCancel(): void {
    this.closePanel.emit();
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
      templateCode: formVal.templateCode.trim(),
      channel: formVal.channel,
      trigger: formVal.trigger,
      subject: this.hasSubject ? formVal.subject.trim() : '',
      body: formVal.body,
      status: formVal.isActive ? 'Active' : 'Inactive',
      lastModified: new Date().toISOString().split('T')[0],
    };

    this.saveTemplate.emit(result);
  }
}
