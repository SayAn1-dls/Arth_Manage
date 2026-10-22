import type { Response } from 'express';

/**
 * CSV with formula-injection protection (PRD NFR-S8): a cell that a spreadsheet could read as a formula
 * (starts with = + - @, tab or carriage return) is prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send('﻿' + csv); // BOM so Excel reads UTF-8 names correctly
}
