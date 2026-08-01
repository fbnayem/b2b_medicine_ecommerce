const MONEY_PATTERN = /^(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:,\d{3})+))(?:\.(\d{1,2}))?$/;

export function parseMoneyToMinor(raw: string): number | null {
  const displayValue = raw.trim();
  const match = MONEY_PATTERN.exec(displayValue);
  if (!match) return null;

  const value = displayValue.replaceAll(',', '');
  const [majorText, fractionText = ''] = value.split('.');
  const minorText = `${majorText}${fractionText.padEnd(2, '0')}`;
  try {
    const minor = BigInt(minorText);
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(minor);
  } catch {
    return null;
  }
}

export function formatMoneyMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '৳—';
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}৳${grouped}.${fraction}`;
}

export function formatPercentFromBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) return '—';
  return `${(basisPoints / 100).toFixed(2)}%`;
}
