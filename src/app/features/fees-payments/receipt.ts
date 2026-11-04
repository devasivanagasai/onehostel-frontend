import { Charge, Payment } from '../../core/models/fees.models';

export interface ReceiptContext {
  appName: string;
  money: (n: number) => string;
  date: (iso: string) => string;
  balanceAfter: number;
  charge?: Charge;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Self-contained printable HTML receipt. Generated client-side until the backend
 * serves real PDF receipts. Reversed / refunded payments carry a stamp so a
 * re-downloaded receipt can't be mistaken for a valid one.
 */
export function buildReceiptHtml(p: Payment, ctx: ReceiptContext): string {
  const stamp = p.status === 'Successful' ? '' : `<div class="stamp">${esc(p.status.toUpperCase())}</div>`;
  const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(p.receiptId ?? p.id)}</title>
<style>
  body { margin: 0; padding: 32px 16px; background: #f1f5f9; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; }
  .receipt { position: relative; max-width: 560px; margin: 0 auto; padding: 32px; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(15,23,42,.08); overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #0d9488; }
  h1 { margin: 0; font-size: 20px; } .muted { color: #64748b; font-size: 12.5px; }
  .amount { margin: 20px 0; padding: 16px; border-radius: 10px; background: #f0fdfa; text-align: center; }
  .amount strong { display: block; font-size: 28px; color: #0f766e; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; text-align: left; vertical-align: top; }
  th { width: 42%; color: #64748b; font-weight: 500; }
  footer { margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
  .stamp { position: absolute; top: 90px; right: -40px; transform: rotate(18deg); padding: 6px 60px; background: #dc2626; color: #fff; font-weight: 800; letter-spacing: .15em; }
  @media print { body { background: #fff; padding: 0; } .receipt { box-shadow: none; } }
</style></head>
<body><main class="receipt">${stamp}
  <header>
    <div><h1>${esc(ctx.appName)}</h1><div class="muted">Payment receipt</div></div>
    <div style="text-align:right"><strong>${esc(p.receiptId ?? '—')}</strong><div class="muted">${esc(ctx.date(p.paidAt))}</div></div>
  </header>
  <div class="amount"><span class="muted">Amount received</span><strong>${esc(ctx.money(p.amount))}</strong></div>
  <table>
    ${row('Resident', `${esc(p.residentName)} (${esc(p.residentId)})`)}
    ${row('Charge', `${esc(p.chargeId)} · ${esc(p.chargeDescription)}`)}
    ${ctx.charge ? row('Charge due date', esc(ctx.date(ctx.charge.dueDate))) : ''}
    ${row('Balance before payment', esc(ctx.money(p.amountDue)))}
    ${row('Balance after payment', esc(ctx.money(ctx.balanceAfter)))}
    ${row('Payment method', esc(p.method))}
    ${p.transactionRef ? row('Transaction reference', esc(p.transactionRef)) : ''}
    ${row('Payment ID', esc(p.id))}
    ${row('Collected by', esc(p.collectedBy))}
    ${p.reason ? row(p.status === 'Refunded' ? 'Refund reason' : 'Reversal reason', esc(p.reason)) : ''}
  </table>
  <footer>This is a computer-generated receipt and does not require a signature.</footer>
</main></body></html>`;
}

export function downloadReceipt(p: Payment, ctx: ReceiptContext): void {
  const blob = new Blob([buildReceiptHtml(p, ctx)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Receipt-${p.receiptId ?? p.id}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
