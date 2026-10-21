import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PLAN_DETAILS, PlanName } from '../../plan-details';
import { AppDatePipe } from '../../../../../shared/pipes/app-date.pipe';

/** "9876543210" → "98765 43210" (other lengths are shown as typed). */
function groupDigits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value ?? '';
}

@Component({
  selector: 'app-step-confirmation',
  standalone: true,
  imports: [AppDatePipe, MatIconModule],
  template: `
    @if (value) {
      <div class="confirm-grid">
        <!-- Hostel -->
        <section class="confirm-card">
          <header class="confirm-card__header">
            <span class="confirm-card__icon"><mat-icon>apartment</mat-icon></span>
            <h3 class="confirm-card__title">Hostel Details</h3>
          </header>
          <dl class="confirm-list">
            <div><dt>Hostel Name</dt><dd>{{ value.hostelInfo.hostelName || '—' }}</dd></div>
            <div><dt>Type</dt><dd>{{ value.hostelInfo.hostelType || '—' }}</dd></div>
            <div><dt>Category</dt><dd>{{ value.hostelInfo.hostelCategory || '—' }}</dd></div>
            <div><dt>Gender</dt><dd>{{ value.hostelInfo.gender || '—' }}</dd></div>
            <div><dt>Contact</dt><dd>{{ contact || '—' }}</dd></div>
            <div><dt>Email</dt><dd>{{ value.hostelInfo.email || '—' }}</dd></div>
            <div><dt>Address</dt><dd>{{ address || '—' }}</dd></div>
            <div><dt>Capacity</dt><dd>{{ capacity }}</dd></div>
          </dl>
        </section>

        <!-- Admin -->
        <section class="confirm-card">
          <header class="confirm-card__header">
            <span class="confirm-card__icon"><mat-icon>person</mat-icon></span>
            <h3 class="confirm-card__title">Hostel Owner Details</h3>
          </header>
          <dl class="confirm-list">
            <div><dt>Name</dt><dd>{{ adminName || '—' }}</dd></div>
            <div><dt>Username</dt><dd>{{ value.admin.username || '—' }}</dd></div>
            <div><dt>Email</dt><dd>{{ value.admin.email || '—' }}</dd></div>
            <div><dt>Mobile</dt><dd>{{ adminMobile || '—' }}</dd></div>
            <div><dt>Role</dt><dd>Hostel Owner</dd></div>
            <div><dt>Send credentials via</dt><dd>{{ sendMethodsLabel }}</dd></div>
          </dl>
        </section>

        <!-- Subscription -->
        <section class="confirm-card">
          <header class="confirm-card__header">
            <span class="confirm-card__icon"><mat-icon>workspace_premium</mat-icon></span>
            <h3 class="confirm-card__title">Subscription Details</h3>
          </header>
          <dl class="confirm-list">
            <div><dt>Plan</dt><dd>{{ value.subscription.plan || '—' }}</dd></div>
            <div><dt>Billing Cycle</dt><dd>{{ value.subscription.billingCycle || '—' }}</dd></div>
            <div><dt>Start Date</dt><dd>{{ value.subscription.startDate ? (value.subscription.startDate | appDate) : '—' }}</dd></div>
            <div><dt>End Date</dt><dd>{{ value.subscription.endDate ? (value.subscription.endDate | appDate) : '—' }}</dd></div>
            <div><dt>Tenant Limit</dt><dd>{{ planDetail.residentLimit }}</dd></div>
          </dl>
        </section>

        <!-- Features -->
        <section class="confirm-card">
          <header class="confirm-card__header">
            <span class="confirm-card__icon"><mat-icon>verified</mat-icon></span>
            <h3 class="confirm-card__title">Enabled Features</h3>
          </header>
          <ul class="confirm-features">
            @for (feature of planDetail.features; track feature) {
              <li><mat-icon>check_circle</mat-icon>{{ feature }}</li>
            }
          </ul>
        </section>
      </div>
    }
  `,
  styles: [
    `
      .confirm-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        padding-bottom: 16px;

        @media (max-width: 900px) {
          grid-template-columns: 1fr;
        }
      }

      .confirm-card {
        padding: 20px 22px;
        border-radius: 14px;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px #eef2f7;
      }

      .confirm-card__header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .confirm-card__icon {
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        border-radius: 9px;
        background: #e0ebff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .confirm-card__title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
      }

      /* Label column + value column */
      .confirm-list {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;

        > div {
          display: grid;
          grid-template-columns: 45% minmax(0, 1fr);
          gap: 12px;
          font-size: 13.5px;
          line-height: 1.5;
        }

        dt {
          font-weight: 600;
          color: #1e293b;
        }

        dd {
          margin: 0;
          color: #334155;
          overflow-wrap: anywhere;
        }
      }

      .confirm-features {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;

        li {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: #f0fdf4;
          font-size: 13.5px;
          font-weight: 500;
          color: #1e293b;
        }

        mat-icon {
          flex-shrink: 0;
          font-size: 22px;
          width: 22px;
          height: 22px;
          color: #16a34a;
        }

        @media (max-width: 500px) {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class StepConfirmationComponent {
  @Input() value: any;

  get planDetail() {
    const plan = (this.value?.subscription?.plan as PlanName) ?? 'Standard';
    return PLAN_DETAILS[plan] ?? PLAN_DETAILS.Standard;
  }

  /** e.g. "+91 98765 43210" */
  get contact(): string {
    const info = this.value?.hostelInfo;
    if (!info?.contactNumber) return '';
    return [info.contactCountryCode, groupDigits(info.contactNumber)].filter(Boolean).join(' ');
  }

  /** e.g. "123, Green Park Road, Bengaluru, Karnataka 560001, India" */
  get address(): string {
    const a = this.value?.address;
    if (!a) return '';
    const statePin = [a.state, a.pincode].filter(Boolean).join(' ');
    return [a.addressLine1, a.addressLine2, a.city, statePin, a.country].filter(Boolean).join(', ');
  }

  get capacity(): string {
    const c = this.value?.capacity;
    if (!c) return '—';
    return `${c.totalBeds} Beds · ${c.rooms} Rooms · ${c.floors} Floors · ${c.buildings} Buildings`;
  }

  get adminName(): string {
    const a = this.value?.admin;
    return [a?.firstName, a?.lastName].filter(Boolean).join(' ');
  }

  /** Admin mobile shown with the hostel's country code. */
  get adminMobile(): string {
    const mobile = this.value?.admin?.mobileNumber;
    if (!mobile) return '';
    return [this.value?.hostelInfo?.contactCountryCode, groupDigits(mobile)].filter(Boolean).join(' ');
  }

  get sendMethodsLabel(): string {
    const methods: string[] = [];
    if (this.value?.admin?.sendEmail) methods.push('Email');
    if (this.value?.admin?.sendSms) methods.push('SMS');
    return methods.length > 0 ? methods.join(' + ') : 'Not sent';
  }
}
