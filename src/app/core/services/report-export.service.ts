import { Injectable, inject } from '@angular/core';
import { AppFormatService } from './app-format.service';
import { ExportTable } from '../models/report.models';

/**
 * Export Excel / Export PDF for the Reports page, with no third-party libraries:
 * - Excel: UTF-8 CSV (with BOM so Excel reads ₹ and accents correctly).
 * - PDF: prints a formatted copy of the table from a hidden iframe, so the
 *   browser's print dialog offers "Save as PDF".
 * Swap either method for exceljs / jspdf later without touching callers.
 */
@Injectable({ providedIn: 'root' })
export class ReportExportService {
  /** Date format and time zone from Settings → General. */
  private readonly fmt = inject(AppFormatService);

  exportExcel(table: ExportTable): void {
    const escapeCsv = (value: string | number): string => {
      const text = String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [
      table.columns.map((c) => escapeCsv(c.header)).join(','),
      ...table.rows.map((row) => table.columns.map((c) => escapeCsv(c.value(row))).join(',')),
    ];
    if (table.totals) lines.push(table.totals.map(escapeCsv).join(','));

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    this.download(blob, `${this.fileName(table.title)}.csv`);
  }

  exportPdf(table: ExportTable): void {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(this.buildPrintHtml(table));
    doc.close();

    // Give the iframe a tick to lay out before printing; remove it after the dialog closes.
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 100);
  }

  private buildPrintHtml(table: ExportTable): string {
    const esc = (value: string | number): string =>
      String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const cls = (i: number) => (table.columns[i].numeric ? ' class="num"' : '');
    const generated = this.fmt.date(new Date(), 'datetime');

    const head = table.columns.map((c, i) => `<th${cls(i)}>${esc(c.header)}</th>`).join('');
    const body = table.rows
      .map((row) => `<tr>${table.columns.map((c, i) => `<td${cls(i)}>${esc(c.value(row))}</td>`).join('')}</tr>`)
      .join('');
    const foot = table.totals
      ? `<tfoot><tr>${table.totals.map((t, i) => `<td${cls(i)}>${esc(t)}</td>`).join('')}</tr></tfoot>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(table.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; }
  .brand { font-size: 18px; font-weight: 800; color: #0057e7; }
  h1 { font-size: 17px; margin: 6px 0 2px; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #e6f7f0; text-align: left; padding: 7px 8px; font-weight: 700; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  .num { text-align: right; }
  tfoot td { font-weight: 700; border-top: 2px solid #cbd5e1; border-bottom: none; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="brand">OneHostel</div>
  <h1>${esc(table.title)}</h1>
  <div class="meta">${esc(table.filterSummary)} · ${table.rows.length} record(s) · Generated ${esc(generated)}</div>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${table.columns.length}">No records</td></tr>`}</tbody>
    ${foot}
  </table>
</body>
</html>`;
  }

  private fileName(title: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${date}`;
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
