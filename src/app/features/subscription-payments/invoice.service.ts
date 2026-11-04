import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { InvoiceDialogComponent } from './invoice-dialog.component';
import { PaymentTransaction } from '../../core/models/subscription-payment.models';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { AppFormatService } from '../../core/services/app-format.service';

/** Solid status-pill colours, matching the invoice popup. */
const STATUS_COLORS: Record<string, string> = {
  Paid: '#16a34a',
  Refunded: '#0284c7',
  Pending: '#d97706',
  Failed: '#e11d48',
};

/**
 * View Invoice / Download Receipt actions, shared by the Payments table and the
 * subscription detail panel. The receipt is generated client-side as a
 * self-contained HTML file until the backend serves real PDF receipts; it has a
 * print-ready A4 layout (browser Print → Save as PDF).
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {

  constructor(
    private dialog: MatDialog,
    private settings: SystemSettingsService,
    private fmt: AppFormatService,
  ) {}

  viewInvoice(payment: PaymentTransaction): void {
    this.dialog
      .open(InvoiceDialogComponent, {
        width: '900px',
        maxWidth: '95vw',
        data: payment,
        autoFocus: false,
        panelClass: 'invoice-dialog-panel',
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'download') this.downloadReceipt(payment);
      });
  }

  downloadReceipt(payment: PaymentTransaction): void {
    const blob = new Blob([this.buildReceiptHtml(payment)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Receipt-${payment.invoiceNumber ?? payment.transactionId}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private buildReceiptHtml(p: PaymentTransaction): string {
    const esc = (value: string): string =>
      value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const fmtDate = (iso: string): string => this.fmt.date(iso.slice(0, 10));
    const money = (n: number): string => esc(this.fmt.money(n, '1.2-2'));

    const general = this.settings.settings.general;
    const appName = esc(general.applicationName || 'OneHostel');
    // Two-tone wordmark like the app logo: "One" dark + "Hostel" blue (any other name stays one colour).
    const wordmark = /^onehostel$/i.test(general.applicationName || 'OneHostel')
      ? '<span class="wm-dark">One</span><span class="wm-blue">Hostel</span>'
      : appName;
    const supportEmail = esc(general.supportEmail);
    const supportPhone = esc(`${general.supportPhoneCode} ${general.supportPhone}`.trim());

    const number = esc(p.invoiceNumber ?? p.transactionId);
    const statusColor = STATUS_COLORS[p.paymentStatus] ?? '#64748b';
    const stamp = p.paymentStatus === 'Paid' ? 'PAID' : p.paymentStatus === 'Refunded' ? 'REFUNDED' : '';
    // Tax is read from the payment itself (stored when it was paid), never from current Settings.
    const taxNote =
      p.taxRate === 0 ? 'No GST applied' : p.taxInclusive ? 'Plan price includes GST' : 'GST added on the plan price';
    const generatedOn = this.fmt.date(new Date(), 'datetime');
    const symbol = esc(this.fmt.currencySymbol);

    // Small inline icons (the file must work offline, so no icon font).
    const icon = (path: string): string =>
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    const I = {
      user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z',
      card: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
      id: 'M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm6 10H3v-1c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1zm6-4h-5v-2h5v2zm0-4h-5V7h5v2z',
      cal: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10z',
      check: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
      swap: 'M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
      doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
      box: 'M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44a1 1 0 0 1-1.14 0l-7.9-4.44A1 1 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44a1 1 0 0 1 1.14 0l7.9 4.44c.32.17.53.5.53.88v9z',
      shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
      help: 'M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 0 1 14 0v2h-4v8h4v1h-7v2h6a3 3 0 0 0 3-3V10a9 9 0 0 0-9-9z',
      clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 11H11V7h1.5v4.75l4 2.4-.75 1.23-3.25-2.38z',
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment Receipt ${number} · ${appName}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 36px 16px 56px;
    background: #eef3fb;
    color: #0f172a;
    font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  svg { width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; }

  /* Receipt sheet with a zig-zag torn bottom edge */
  .receipt {
    position: relative;
    max-width: 820px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 30px 60px -28px rgba(15, 23, 42, .35);
  }
  .receipt::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: -12px;
    height: 12px;
    background:
      linear-gradient(-45deg, transparent 8px, #f4f7fc 0) 0 0 / 16px 12px repeat-x,
      linear-gradient(45deg, transparent 8px, #f4f7fc 0) 0 0 / 16px 12px repeat-x;
  }
  .sheet { padding: 40px 44px 28px; }

  /* Header */
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 30px; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .logo { width: 62px; height: 62px; border-radius: 16px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 18px -6px rgba(37, 99, 235, .6); }
  .logo svg { width: 34px; height: 34px; }
  .wm { font-size: 32px; font-weight: 800; letter-spacing: -.02em; line-height: 1.05; }
  .wm-dark { color: #0f172a; } .wm-blue { color: #2563eb; }
  .tagline { margin-top: 6px; font-size: 14.5px; color: #475569; }
  .gstin { margin-top: 4px; font-size: 13.5px; color: #475569; letter-spacing: .02em; }
  .doc { text-align: center; min-width: 280px; }
  .doc-title { font-size: 28px; font-weight: 800; letter-spacing: .02em; color: #0f172a; }
  .doc-rule { display: flex; align-items: center; gap: 10px; margin: 10px 0 12px; color: #2563eb; }
  .doc-rule::before, .doc-rule::after { content: ''; flex: 1; height: 1.5px; background: #2563eb; }
  .doc-rule svg { width: 12px; height: 12px; }
  .doc-number { font-size: 30px; font-weight: 700; color: #1d4ed8; letter-spacing: .02em; }

  /* Billed to | Payment */
  .parties { display: grid; grid-template-columns: 1fr 1px 1fr; gap: 32px; margin-bottom: 26px; }
  .vline { background: repeating-linear-gradient(180deg, #cbd5e1 0 6px, transparent 6px 11px); }
  .sec-title { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #1d4ed8; }
  .chip-icon { width: 34px; height: 34px; border-radius: 50%; background: #eef4ff; color: #2563eb; display: inline-flex; align-items: center; justify-content: center; }
  .party-name { margin: 0 0 12px 46px; font-size: 18px; font-weight: 700; }
  .rows { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 12px 10px; font-size: 14.5px; }
  .rows .k { display: flex; align-items: center; gap: 12px; color: #475569; white-space: nowrap; }
  .rows .k svg { color: #64748b; }
  .rows .colon { color: #94a3b8; }
  .rows .v { font-weight: 500; color: #0f172a; word-break: break-all; }
  .status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: #fff; }
  .status svg { width: 14px; height: 14px; }

  /* Items */
  .items { width: 100%; border-collapse: collapse; font-size: 15px; }
  .items th { padding: 12px 16px; background: #eaf1fe; color: #1d4ed8; font-size: 13.5px; font-weight: 700; letter-spacing: .04em; text-align: left; }
  .items th:first-child { border-radius: 8px 0 0 8px; }
  .items th:last-child { border-radius: 0 8px 8px 0; text-align: right; }
  .items td { padding: 16px; border-bottom: 1px solid #e5eaf1; }
  .items td:last-child { text-align: right; font-weight: 500; font-variant-numeric: tabular-nums; }
  .desc { display: flex; align-items: center; gap: 14px; font-weight: 500; }
  .desc .chip-icon { width: 30px; height: 30px; background: #2563eb; color: #fff; }
  .desc .chip-icon svg { width: 16px; height: 16px; }

  .bottom { position: relative; display: flex; justify-content: flex-end; padding: 14px 0 6px; }
  .stamp { position: absolute; left: 50px; top: 40px; padding: 8px 26px; border: 5px double currentColor; border-radius: 14px; font-family: Georgia, 'Times New Roman', serif; font-size: 54px; font-weight: 700; letter-spacing: .06em; transform: rotate(-12deg); opacity: .55; }
  .totals { width: min(100%, 420px); }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 16px; font-size: 15px; color: #334155; }
  .totals .row span:last-child { color: #0f172a; font-variant-numeric: tabular-nums; }
  .grand { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding: 16px 20px; border-radius: 12px; background: #eaf1fe; }
  .grand span:first-child { font-size: 16px; font-weight: 800; letter-spacing: .04em; color: #1d4ed8; }
  .grand span:last-child { font-size: 30px; font-weight: 800; color: #1d4ed8; font-variant-numeric: tabular-nums; }
  .tax-note { padding: 8px 16px 0; text-align: right; font-size: 12px; color: #64748b; }

  .note { margin-top: 16px; padding: 10px 14px; border-radius: 10px; background: #f0f9ff; border: 1px solid #bae6fd; color: #0369a1; font-size: 13px; }

  /* Footer */
  .foot { display: grid; grid-template-columns: repeat(3, 1fr); background: #f4f7fc; border-top: 1px solid #e5eaf1; }
  .foot > div { display: flex; gap: 12px; padding: 20px 24px; font-size: 13px; line-height: 1.6; color: #475569; }
  .foot > div + div { border-left: 1px solid #dbe3ef; }
  .foot svg { width: 24px; height: 24px; color: #2563eb; }
  .foot strong { display: block; color: #1d4ed8; font-weight: 600; }
  .foot a { color: #334155; text-decoration: none; }

  @media (max-width: 640px) {
    body { padding: 16px 8px 40px; }
    .sheet { padding: 24px 18px; }
    .head { flex-direction: column; }
    .doc { text-align: left; min-width: 0; }
    .parties { grid-template-columns: 1fr; }
    .vline { display: none; }
    .stamp { display: none; }
    .foot { grid-template-columns: 1fr; }
    .foot > div + div { border-left: none; border-top: 1px solid #dbe3ef; }
  }

  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .receipt { box-shadow: none; max-width: none; }
    .receipt::after { display: none; }
  }
</style>
</head>
<body>
  <main class="receipt">
    <div class="sheet">
      <header class="head">
        <div class="brand">
          <span class="logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 10v11h6v-6h6v6h6V10l-9-7zm-1 8H9V9h2v2zm4 0h-2V9h2v2z"/></svg></span>
          <div>
            <div class="wm">${wordmark}</div>
            <div class="tagline">Hostel Management Platform</div>
            ${p.gstin ? `<div class="gstin">GSTIN: ${esc(p.gstin)}</div>` : ''}
          </div>
        </div>
        <div class="doc">
          <div class="doc-title">PAYMENT RECEIPT</div>
          <div class="doc-rule"><svg viewBox="0 0 24 24"><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg></div>
          <div class="doc-number">${number}</div>
        </div>
      </header>

      <section class="parties">
        <div>
          <div class="sec-title"><span class="chip-icon">${icon(I.user)}</span>Billed To</div>
          <div class="party-name">${esc(p.hostelName)}</div>
          <div class="rows">
            <span class="k">${icon(I.id)}Subscription ID</span><span class="colon">:</span><span class="v">${esc(p.subscriptionId)}</span>
            <span class="k">${icon(I.cal)}Payment Date</span><span class="colon">:</span><span class="v">${esc(fmtDate(p.paymentDate))}</span>
            <span class="k">${icon(I.check)}Payment Status</span><span class="colon">:</span><span class="v"><span class="status" style="background:${statusColor}">${icon(I.check)}${esc(p.paymentStatus)}</span></span>
          </div>
        </div>
        <div class="vline" aria-hidden="true"></div>
        <div>
          <div class="sec-title"><span class="chip-icon">${icon(I.card)}</span>Payment</div>
          <div class="rows">
            <span class="k">${icon(I.card)}Method</span><span class="colon">:</span><span class="v">${esc(p.paymentMethod)} • ${esc(p.paymentGateway)}</span>
            <span class="k">${icon(I.swap)}Transaction ID</span><span class="colon">:</span><span class="v">${esc(p.transactionId)}</span>
            <span class="k">${icon(I.doc)}Invoice Number</span><span class="colon">:</span><span class="v">${esc(p.invoiceNumber ?? '—')}</span>
          </div>
        </div>
      </section>

      <table class="items">
        <thead><tr><th>DESCRIPTION</th><th>AMOUNT (${symbol})</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="desc"><span class="chip-icon">${icon(I.box)}</span>${esc(p.planName)} Plan - ${esc(p.billingCycle)} Subscription</span></td>
            <td>${money(p.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="bottom">
        ${stamp ? `<div class="stamp" style="color:${statusColor}" aria-hidden="true">${stamp}</div>` : ''}
        <div class="totals">
          <div class="row"><span>${p.taxRate > 0 ? 'Subtotal (excl. GST)' : 'Subtotal'}</span><span>${money(p.amount)}</span></div>
          ${p.taxRate > 0 ? `<div class="row"><span>GST (${p.taxRate}%)</span><span>${money(p.tax)}</span></div>` : ''}
          ${p.lateFee ? `<div class="row"><span>Late payment fee (${p.daysLate} days late)</span><span>${money(p.lateFee)}</span></div>` : ''}
          <div class="grand"><span>TOTAL AMOUNT</span><span>${money(p.totalAmount)}</span></div>
          <div class="tax-note">${taxNote}</div>
        </div>
      </div>

      ${
        p.paymentStatus === 'Refunded'
          ? '<div class="note">This payment has been refunded to the original payment method.</div>'
          : ''
      }
    </div>

    <footer class="foot">
      <div>${icon(I.shield)}<span>This is a computer-generated receipt and does not require a signature.</span></div>
      <div>${icon(I.help)}<span><strong>Need Help?</strong><a href="mailto:${supportEmail}">${supportEmail}</a>${supportPhone ? `<br />${supportPhone}` : ''}</span></div>
      <div>${icon(I.clock)}<span><strong>Generated on</strong>${esc(generatedOn)}</span></div>
    </footer>
  </main>
</body>
</html>`;
  }
}
