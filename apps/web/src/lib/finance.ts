const majorAmountPattern = /^(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:,\d{3})+))(?:\.(\d{1,2}))?$/;

/** Convert a user-entered BDT major-unit value to integer poisha without floats. */
export function parseMajorToMinor(input: string): number {
  const entered = input.trim();
  const match = majorAmountPattern.exec(entered);
  if (!match) {
    throw new Error('Enter a positive amount with no more than two decimal places.');
  }

  const normalized = entered.replaceAll(',', '');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The amount is too large.');
  }
  return Number(value);
}

export function formatMinor(value: number): string {
  if (!Number.isSafeInteger(value)) return 'Invalid amount';
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100).toLocaleString('en-BD');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}৳${whole}.${fraction}`;
}

const dhakaDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dhaka',
});

const dhakaDateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Dhaka',
});

export function formatFinanceDate(value?: string | Date): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dhakaDate.format(parsed);
}

export function formatFinanceDateTime(value?: string | Date): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dhakaDateTime.format(parsed);
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
