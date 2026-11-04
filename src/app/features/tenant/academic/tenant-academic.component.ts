import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { TenantAcademicService, TenantAcademicView } from '../../../core/services/tenant-academic.service';
import { errMsg, fmtDate } from '../guardians/tn-ui';

@Component({
  selector: 'app-tenant-academic',
  standalone: true,
  imports: [MatIconModule],
  styleUrl: './tenant-academic.component.scss',
  template: `
    <div class="tn-page">
      <div class="tn-banner tn-banner--warn" role="note">
        <mat-icon aria-hidden="true">gavel</mat-icon>
        <div>{{ service.disclaimer }} You cannot edit it here. Ask your hostel office if something is wrong.</div>
      </div>

      @if (loading) {
        <div class="tn-card" aria-busy="true" aria-label="Loading academic information"><div class="tn-skeleton"></div><div class="tn-skeleton"></div><div class="tn-skeleton"></div></div>
      } @else if (loadError) {
        <div class="tn-card tn-state tn-state--error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon><p>{{ loadError }}</p>
          <button type="button" class="tn-btn" (click)="load()">Retry</button>
        </div>
      } @else if (!view?.info) {
        <div class="tn-card tn-state" role="status">
          <mat-icon aria-hidden="true">school</mat-icon>
          <p><strong>No academic details have been supplied yet</strong></p>
          <p class="tn-sub">Your hostel office has not shared your student details. Contact them to have these added.</p>
        </div>
      } @else {
        @if (view?.yearNote) {
          <div class="tn-banner tn-banner--warn" role="status"><mat-icon aria-hidden="true">warning</mat-icon><div>{{ view?.yearNote }}</div></div>
        }
        @if (view?.info; as i) {
          <section class="tn-card" aria-label="Academic details">
            <h2>{{ i.institution }}</h2>
            <p class="tn-sub">Last updated {{ date(i.updatedAt) }} by {{ i.suppliedBy }}</p>
            <dl class="tn-kv">
              <div><dt>Student ID / Roll no.</dt><dd>{{ i.rollNumber }}</dd></div>
              <div><dt>Course</dt><dd>{{ i.course }}</dd></div>
              <div><dt>Department</dt><dd>{{ i.department }}</dd></div>
              <div><dt>Year</dt><dd>{{ i.year }}</dd></div>
              <div><dt>Semester</dt><dd>{{ i.semester }}</dd></div>
              <div><dt>Class / Section</dt><dd>{{ i.classSection }}</dd></div>
              <div><dt>Academic year</dt><dd>{{ i.academicYear }}</dd></div>
              <div><dt>Assigned to active hostel year</dt><dd>@if (!view?.activeYearName) { No active academic year } @else if (view?.assignedToActiveYear) { Yes ({{ view?.activeYearName }}) } @else { Not yet }</dd></div>
            </dl>
          </section>

          <section class="tn-card" aria-label="Hostel eligibility">
            <h2>Hostel eligibility</h2>
            <p>{{ i.hostelEligibility }}</p>
          </section>

          <section class="tn-card" aria-label="Shared academic documents">
            <h2>Documents shared by your hostel office</h2>
            @if (!i.documents.length) {
              <p class="tn-sub" role="status">No academic documents have been shared.</p>
            } @else {
              <ul class="tn-list">
                @for (d of i.documents; track d.id) {
                  <li class="tn-row tn-row--between">
                    <span><mat-icon aria-hidden="true" style="vertical-align:middle">description</mat-icon> {{ d.name }}<br /><span class="tn-sub">{{ d.kind }} · shared {{ date(d.sharedAt) }}</span></span>
                  </li>
                }
              </ul>
              <p class="tn-sub">Open these from Documents if your hostel office has published a copy there.</p>
            }
          </section>
        }
      }
    </div>
  `,
})
export class TenantAcademicComponent implements OnInit, OnDestroy {
  readonly service = inject(TenantAcademicService);
  readonly date = fmtDate;
  view: TenantAcademicView | null = null;
  loading = true;
  loadError = '';
  private sub?: Subscription;

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
        this.sub = this.service.mine$.subscribe((v) => (this.view = v));
      } catch (e) {
        this.loadError = errMsg(e);
      }
      this.loading = false;
    }, 150);
  }
}
