import { ReportExportColumn } from './hostel-reports.models';

/**
 * Excel export as UTF-8 CSV (with BOM so Excel reads ₹ correctly). Unlike the admin
 * ReportExportService CSV, this one starts with a header block — report, hostel,
 * applied filters, summary, generated time — so the file stands on its own.
 * Money columns are written as plain numbers so Excel can sum them.
 */
export function downloadReportCsv(
  fileTitle: string,
  meta: [string, string][],
  columns: ReportExportColumn[],
  rows: unknown[],
  totals: (string | number)[],
): void {
  const cell = (value: string | number | undefined): string => {
    const text = typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    ...meta.map(([label, value]) => `${cell(label)},${cell(value)}`),
    '',
    columns.map((c) => cell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => cell(c.value(row))).join(',')),
    totals.map(cell).join(','),
  ];

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
