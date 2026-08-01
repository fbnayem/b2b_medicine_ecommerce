export type CsvValue = string | number | boolean | Date | null | undefined;

/**
 * A leading =, +, - or @ makes a spreadsheet treat the cell as a formula, so a
 * value copied out of the database could execute on the reader's machine. The
 * value is preserved but neutralised with a leading apostrophe.
 */
function neutralise(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function serialise(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return neutralise(value);
}

function quote(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/**
 * Renders rows as RFC 4180 CSV with a UTF-8 byte order mark, without which
 * Excel misreads the ৳ symbol and Bangla shop names.
 */
export function toCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]): string {
  const lines = [columns.map((column) => quote(neutralise(column.header))).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => quote(serialise(column.value(row)))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Integer minor units rendered as a plain decimal a spreadsheet can total. */
export function csvMinor(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isSafeInteger(value)) return '';
  const negative = value < 0;
  const absolute = Math.abs(value);
  return `${negative ? '-' : ''}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function csvFilename(name: string, from?: string, to?: string) {
  const suffix = from && to ? `-${from}-to-${to}` : from ? `-${from}` : '';
  return `${name}${suffix}.csv`.replaceAll(/[^a-zA-Z0-9.\-_]/g, '-');
}
