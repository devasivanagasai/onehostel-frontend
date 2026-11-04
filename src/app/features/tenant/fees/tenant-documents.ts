import { Payment, Charge } from '../../../core/models/fees.models';
import { TenantInvoice } from '../../../core/models/tenant-payment.models';
import { ReceiptContext, buildReceiptHtml } from '../../fees-payments/receipt';

export interface TenantDocContext {
  hostelName: string;
  residentName: string;
  residentId: string;
  money: (n: number) => string;
  date: (iso: string) => string;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Print-ready invoice HTML for the Tenant's own invoice. Generated client-side until the backend serves PDFs. */
export function buildInvoiceHtml(inv: TenantInvoice, ctx: TenantDocContext): string {
  const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(inv.id)}</title>
<style>
  body { margin: 0; padding: 32px 16px; background: #f1f5f9; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; }
  .doc { max-width: 600px; margin: 0 auto; padding: 32px; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
  header { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #0d9488; }
  h1 { margin: 0; font-size: 20px; } .muted { color: #64748b; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; } th, td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; text-align: left; vertical-align: top; }
  th { width: 45%; color: #64748b; font-weight: 500; } .total th, .total td { font-weight: 700; color: #0f172a; }
  footer { margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
  @media print { body { background: #fff; padding: 0; } .doc { box-shadow: none; } }
</style></head>
<body><main class="doc">
  <header>
    <div><h1>${esc(ctx.hostelName)}</h1><div class="muted">Fee invoice</div></div>
    <div style="text-align:right"><strong>${esc(inv.id)}</strong><div class="muted">Issued ${esc(ctx.date(inv.issueDate))}</div></div>
  </header>
  <table>
    ${row('Billed to', `${ctx.residentName} (${ctx.residentId})`)}
    ${row('Fee type', inv.feeType)}
    ${row('Description', inv.description)}
    ${row('Billing period', inv.period)}
    ${row('Due date', ctx.date(inv.dueDate))}
    ${row('Base amount', ctx.money(inv.baseAmount))}
    ${inv.taxAmount ? row('Tax', ctx.money(inv.taxAmount)) : ''}
    ${inv.lateFeeAmount ? row('Late fee', ctx.money(inv.lateFeeAmount)) : ''}
    <tr class="total"><th>Total</th><td>${esc(ctx.money(inv.total))}</td></tr>
    ${row('Amount paid', ctx.money(inv.paid))}
    ${row('Outstanding', ctx.money(inv.outstanding))}
    ${row('Status', inv.status)}
  </table>
  <footer>This is a computer-generated invoice for hostel charges.</footer>
</main></body></html>`;
}

function download(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens the browser print dialog (Save as PDF) for an HTML document, through a hidden iframe. */
export function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 100);
}

export function downloadInvoice(inv: TenantInvoice, ctx: TenantDocContext): void {
  download(buildInvoiceHtml(inv, ctx), `Invoice-${inv.id}.html`);
}

export function printInvoice(inv: TenantInvoice, ctx: TenantDocContext): void {
  printHtml(buildInvoiceHtml(inv, ctx));
}

export interface TenantReceiptSource {
  payment: Payment;
  charge: Charge;
  balanceAfter: number;
}

const receiptCtx = (src: TenantReceiptSource, ctx: TenantDocContext): ReceiptContext => ({
  appName: ctx.hostelName,
  money: ctx.money,
  date: ctx.date,
  balanceAfter: src.balanceAfter,
  charge: src.charge,
});

export function downloadTenantReceipt(src: TenantReceiptSource, ctx: TenantDocContext): void {
  download(buildReceiptHtml(src.payment, receiptCtx(src, ctx)), `Receipt-${src.payment.receiptId ?? src.payment.id}.html`);
}

export function printTenantReceipt(src: TenantReceiptSource, ctx: TenantDocContext): void {
  printHtml(buildReceiptHtml(src.payment, receiptCtx(src, ctx)));
}
