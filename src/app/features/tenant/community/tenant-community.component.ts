import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantCommunityService } from '../../../core/services/tenant-community.service';
import { CommunityItemView, ItemKind, ReportInput } from '../../../core/models/tenant-community.models';
import { errMsg, fmtDateTime, nowLocalMinute, toneOf } from '../guardians/tn-ui';

type Filter = 'All' | 'Lost' | 'Found' | 'Mine';

@Component({
  selector: 'app-tenant-community',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  styleUrl: './tenant-community.component.scss',
  template: `
    <div class="tn-page">
      <div class="tn-banner" role="note">
        <mat-icon aria-hidden="true">privacy_tip</mat-icon>
        <div>Other tenants' items are shown as <strong>"Reported by a tenant"</strong>: no names or contact details. Please do not put phone numbers or e-mail addresses in a report. The hostel office passes messages on.</div>
      </div>

      @if (message) { <div class="tn-banner tn-banner--ok" role="status"><mat-icon aria-hidden="true">check_circle</mat-icon><div>{{ message }}</div></div> }
      @if (actionError) { <div class="tn-banner tn-banner--error" role="alert"><mat-icon aria-hidden="true">error</mat-icon><div>{{ actionError }}</div></div> }

      <section class="tn-card" aria-label="Report an item">
        @if (!formOpen) {
          <div class="tn-row tn-row--between">
            <div><h2>Lost something, or found something?</h2><div class="tn-sub">Tell the hostel office so it can be matched and returned.</div></div>
            <div class="tn-row">
              <button type="button" class="tn-btn" (click)="openForm('Lost')"><mat-icon aria-hidden="true">search</mat-icon>Report lost item</button>
              <button type="button" class="tn-btn tn-btn--ghost" (click)="openForm('Found')"><mat-icon aria-hidden="true">inventory_2</mat-icon>Report found item</button>
            </div>
          </div>
        } @else {
          <h2>{{ editingId ? 'Edit' : 'Report' }} {{ form.kind === 'Lost' ? 'a lost item' : 'a found item' }}</h2>
          <form (ngSubmit)="save()" class="tn-form" novalidate>
            <div class="tn-field">
              <label for="lf-name">Item name {{ form.kind === 'Found' ? '(optional)' : '' }}</label>
              <input id="lf-name" name="itemName" [(ngModel)]="form.itemName" maxlength="60" [attr.aria-invalid]="!!errors['itemName']" />
              @if (errors['itemName']) { <span class="tn-err" role="alert">{{ errors['itemName'] }}</span> }
            </div>
            <div class="tn-field">
              <label for="lf-when">{{ form.kind === 'Found' ? 'When you found it' : 'Approximately when you lost it' }}</label>
              <input id="lf-when" type="datetime-local" name="occurredAt" [(ngModel)]="form.occurredAt" [max]="maxNow" [attr.aria-invalid]="!!errors['occurredAt']" />
              @if (errors['occurredAt']) { <span class="tn-err" role="alert">{{ errors['occurredAt'] }}</span> }
            </div>
            <div class="tn-field tn-wide">
              <label for="lf-desc">Description (at least 10 characters)</label>
              <textarea id="lf-desc" name="description" [(ngModel)]="form.description" maxlength="500" rows="3" [attr.aria-invalid]="!!errors['description']"></textarea>
              @if (errors['description']) { <span class="tn-err" role="alert">{{ errors['description'] }}</span> }
            </div>
            <div class="tn-field">
              <label for="lf-loc">{{ form.kind === 'Found' ? 'Where you found it' : 'Where you lost it' }}</label>
              <input id="lf-loc" name="location" [(ngModel)]="form.location" maxlength="100" [attr.aria-invalid]="!!errors['location']" />
              @if (errors['location']) { <span class="tn-err" role="alert">{{ errors['location'] }}</span> }
            </div>
            @if (form.kind === 'Found') {
              <div class="tn-field">
                <label for="lf-hand">Handed over at</label>
                <input id="lf-hand" name="handoverLocation" [(ngModel)]="form.handoverLocation" maxlength="100" [attr.aria-invalid]="!!errors['handoverLocation']" />
                @if (errors['handoverLocation']) { <span class="tn-err" role="alert">{{ errors['handoverLocation'] }}</span> }
              </div>
            }
            <div class="tn-field tn-wide">
              <label for="lf-photo">Photo (optional, JPG or PNG up to 3 MB; only the file name is kept)</label>
              <input id="lf-photo" type="file" accept=".jpg,.jpeg,.png" (change)="pick($event)" [attr.aria-invalid]="!!errors['photo']" />
              @if (errors['photo']) { <span class="tn-err" role="alert">{{ errors['photo'] }}</span> }
            </div>
            <div class="tn-row tn-wide">
              <button type="submit" class="tn-btn">{{ editingId ? 'Save changes' : 'Submit report' }}</button>
              <button type="button" class="tn-btn tn-btn--ghost" (click)="closeForm()">Cancel</button>
            </div>
          </form>
        }
      </section>

      <div class="tn-chip-row" role="group" aria-label="Filter items">
        @for (f of filters; track f) { <button type="button" class="tn-chip" [attr.aria-pressed]="filter === f" (click)="filter = f">{{ f === 'Mine' ? 'My reports' : f }}</button> }
      </div>

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading items"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else if (!shown.length) {
        <div class="tn-card tn-state" role="status"><mat-icon aria-hidden="true">travel_explore</mat-icon><p><strong>Nothing to show</strong></p><p class="tn-sub">No items match this filter.</p></div>
      } @else {
        <div class="tn-grid">
          @for (i of shown; track i.id) {
            <article class="tn-card" [attr.aria-label]="i.kind + ' item ' + i.id">
              <div class="tn-row tn-row--between">
                <h3><span class="tn-pill tn-pill--{{ i.kind === 'Lost' ? 'warning' : 'info' }}">{{ i.kind }}</span> {{ i.itemName }}</h3>
                <span class="tn-pill tn-pill--{{ tone(i.status) }}">{{ i.status }}</span>
              </div>
              <p>{{ i.description }}</p>
              <dl class="tn-kv">
                <div><dt>{{ i.kind === 'Found' ? 'Found at' : 'Lost at' }}</dt><dd>{{ i.location }}</dd></div>
                <div><dt>When</dt><dd>{{ dateTime(i.occurredAt) }}</dd></div>
                @if (i.handoverLocation) { <div><dt>Handed over at</dt><dd>{{ i.handoverLocation }}</dd></div> }
                @if (i.photoName) { <div><dt>Photo</dt><dd>{{ i.photoName }}</dd></div> }
                <div><dt>Reported by</dt><dd>{{ i.reportedBy }}</dd></div>
                <div><dt>Reference</dt><dd>{{ i.id }}</dd></div>
              </dl>
              @if (i.moderationNote) { <div class="tn-banner" style="margin-top:8px"><mat-icon aria-hidden="true">forum</mat-icon><div><strong>Hostel office:</strong> {{ i.moderationNote }}</div></div> }
              @if (i.mine && i.status !== 'Reported') { <p class="tn-sub" style="margin-top:6px">This report is {{ i.status === 'Under Review' ? 'under review' : i.status.toLowerCase() }} and can no longer be edited.</p> }

              @if (i.myClaim; as c) {
                <div class="tn-banner tn-banner--{{ c.status === 'Approved' ? 'ok' : c.status === 'Rejected' ? 'error' : 'warn' }}" style="margin-top:8px" role="status">
                  <mat-icon aria-hidden="true">assignment_turned_in</mat-icon>
                  <div>Your claim is <strong>{{ c.status }}</strong>.@if (c.decisionNote) { {{ c.decisionNote }} }</div>
                </div>
              }

              <div class="tn-row" style="margin-top:10px">
                @if (i.canEdit) { <button type="button" class="tn-btn tn-btn--ghost" (click)="edit(i)">Edit</button> }
                @if (i.canWithdraw) { <button type="button" class="tn-btn tn-btn--danger" (click)="withdraw(i)">Withdraw</button> }
                @if (i.canClaim && claimingId !== i.id) { <button type="button" class="tn-btn" (click)="startClaim(i.id)">This is mine</button> }
              </div>

              @if (claimingId === i.id) {
                <form (ngSubmit)="submitClaim(i)" class="tn-form" style="margin-top:10px" novalidate>
                  <div class="tn-field tn-wide">
                    <label [for]="'claim-' + i.id">Why is this item yours? (at least {{ limits.claimMin }} characters)</label>
                    <textarea [id]="'claim-' + i.id" name="claim" [(ngModel)]="claimText" [maxlength]="limits.claimMax" rows="3" [attr.aria-invalid]="!!claimError"></textarea>
                    @if (claimError) { <span class="tn-err" role="alert">{{ claimError }}</span> }
                  </div>
                  <div class="tn-row tn-wide"><button type="submit" class="tn-btn">Send claim</button><button type="button" class="tn-btn tn-btn--ghost" (click)="claimingId = ''">Cancel</button></div>
                </form>
              }
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class TenantCommunityComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantCommunityService);
  readonly limits = this.service.limits;
  readonly tone = toneOf;
  readonly dateTime = fmtDateTime;
  readonly filters: Filter[] = ['All', 'Lost', 'Found', 'Mine'];

  items: CommunityItemView[] = [];
  filter: Filter = 'All';
  loading = true;
  loadError = '';
  message = '';
  actionError = '';
  formOpen = false;
  editingId = '';
  form = this.blank('Lost');
  errors: Record<string, string> = {};
  maxNow = nowLocalMinute();
  claimingId = '';
  claimText = '';
  claimError = '';
  private sub?: Subscription;

  get shown(): CommunityItemView[] {
    return this.items.filter((i) => (this.filter === 'All' ? true : this.filter === 'Mine' ? i.mine : i.kind === this.filter));
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.sub?.unsubscribe();
    setTimeout(() => {
      try {
        this.sub = this.service.items$.subscribe((i) => (this.items = i));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }

  openForm(kind: ItemKind): void {
    this.clear();
    this.editingId = '';
    this.form = this.blank(kind);
    this.errors = {};
    this.maxNow = nowLocalMinute();
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.editingId = '';
    this.errors = {};
  }

  edit(i: CommunityItemView): void {
    this.clear();
    this.editingId = i.id;
    this.form = { kind: i.kind, itemName: i.itemName, description: i.description, location: i.location, handoverLocation: i.handoverLocation ?? '', occurredAt: i.occurredAt.slice(0, 16), photo: undefined };
    this.errors = {};
    this.maxNow = nowLocalMinute();
    this.formOpen = true;
  }

  pick(event: Event): void {
    const f = (event.target as HTMLInputElement).files?.[0];
    this.form = { ...this.form, photo: f ? { name: f.name, mime: f.type, size: f.size } : null };
  }

  save(): void {
    this.clear();
    this.errors = this.service.validate(this.form);
    if (Object.keys(this.errors).length) return;
    try {
      if (this.editingId) {
        this.service.update(this.editingId, this.form);
        this.message = 'Your report was updated.';
      } else {
        const v = this.service.report(this.form);
        this.message = `Your report ${v.id} was submitted.`;
      }
      this.closeForm();
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  withdraw(i: CommunityItemView): void {
    this.clear();
    try {
      this.service.withdraw(i.id);
      this.message = `Report ${i.id} was withdrawn.`;
    } catch (e) {
      this.actionError = errMsg(e);
    }
  }

  startClaim(id: string): void {
    this.clear();
    this.claimingId = id;
    this.claimText = '';
    this.claimError = '';
  }

  submitClaim(i: CommunityItemView): void {
    this.claimError = '';
    try {
      this.service.claim(i.id, this.claimText);
      this.claimingId = '';
      this.message = `Your claim on ${i.id} was sent to the hostel office.`;
    } catch (e) {
      this.claimError = errMsg(e);
    }
  }

  private blank(kind: ItemKind): ReportInput & { handoverLocation: string } {
    return { kind, itemName: '', description: '', location: '', handoverLocation: '', occurredAt: '', photo: undefined };
  }

  private clear(): void {
    this.message = '';
    this.actionError = '';
  }
}
