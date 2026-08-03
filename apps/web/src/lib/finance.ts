import { formatDate, formatDateTime, formatMoneyMinor, parseMoney } from '@medsupply/utilities';

/**
 * Web-facing names for the shared formatters, plus the few helpers that are
 * genuinely web-only.
 *
 * The formatting itself lives in `@medsupply/utilities` so that this app and
 * the Expo app cannot drift again — they had already produced different strings
 * for the same field. These are thin aliases rather than a rename across ~140
 * call sites; the rename can happen when those files are touched for other
 * reasons.
 */

export function formatMinor(value: number): string {
  return formatMoneyMinor(value);
}

/**
 * Throws rather than returning null, because every caller here is a form
 * submit handler that already catches and shows the message. The two failures
 * are worded differently on purpose: three decimal places is a typo, whereas an
 * unsafe amount means the figure itself is wrong.
 */
export function parseMajorToMinor(input: string): number {
  const result = parseMoney(input);
  if (result.ok) return result.minor;
  throw new Error(
    result.reason === 'too-large'
      ? 'The amount is too large.'
      : 'Enter a positive amount with no more than two decimal places.',
  );
}

export function formatFinanceDate(value?: string | Date): string {
  return formatDate(value);
}

export function formatFinanceDateTime(value?: string | Date): string {
  return formatDateTime(value);
}

export function createActionKey(prefix: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function entityId(value: string | { _id: string } | undefined): string | undefined {
  return typeof value === 'string' ? value : value?._id;
}

export function entityReference(
  value: string | { reference?: string; name?: string } | undefined,
  fallback = '—',
): string {
  if (!value || typeof value === 'string') return fallback;
  return value.reference ?? value.name ?? fallback;
}
