/**
 * Reading a scan into a picking line.
 *
 * Out of the component and pure, because this is the part that can be wrong in
 * a way nobody notices: a scan that matches the wrong line puts the customer's
 * name on somebody else's batch, and a batch number is the one identifier that
 * follows a medicine all the way to a recall.
 */

export interface ScannableLine {
  id: string;
  /** The number printed on the carton — never a database id. */
  batchNumber: string;
  brandName: string;
  allocated: number;
}

export interface ParsedScan {
  code: string;
  quantity: number;
}

/**
 * What the scanner (or the keyboard) actually sent.
 *
 * A bare code is one unit, which is the common case: one scan, one carton.
 * `CODE x 12` and `CODE*12` record a whole outer at once, because a picker
 * lifting a case of twelve should not scan it twelve times — and typing the
 * multiplier is faster than correcting the count afterwards.
 */
export function parseScan(raw: string): ParsedScan | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const multiplied = /^(.*?)\s*[x*]\s*(\d+)$/i.exec(trimmed);
  if (multiplied) {
    const quantity = Number(multiplied[2]);
    // `ABC x 0` is a typo, not an instruction to record nothing.
    if (!quantity) return null;
    return { code: multiplied[1]!.trim(), quantity };
  }
  return { code: trimmed, quantity: 1 };
}

/**
 * The line a code names.
 *
 * The batch number wins outright and is compared exactly (case and spacing
 * folded), because that is what is printed on the carton and what the scanner
 * reads. A brand-name match is a **prefix** convenience for typing, and is
 * deliberately refused when it is ambiguous: two lines of the same brand in
 * different batches is the ordinary case in this warehouse, and silently
 * picking the first would attach the wrong batch to the invoice.
 */
export function matchScan(
  lines: readonly ScannableLine[],
  code: string,
): { line: ScannableLine } | { error: 'NOT_FOUND' | 'AMBIGUOUS' } {
  const normalise = (value: string) => value.replace(/\s+/g, '').toUpperCase();
  const wanted = normalise(code);
  if (!wanted) return { error: 'NOT_FOUND' };

  const byBatch = lines.filter((line) => normalise(line.batchNumber) === wanted);
  if (byBatch.length === 1) return { line: byBatch[0]! };
  if (byBatch.length > 1) return { error: 'AMBIGUOUS' };

  const byBrand = lines.filter((line) => normalise(line.brandName).startsWith(wanted));
  if (byBrand.length === 1) return { line: byBrand[0]! };
  if (byBrand.length > 1) return { error: 'AMBIGUOUS' };

  return { error: 'NOT_FOUND' };
}

/**
 * Adding a scan to what has been counted, without going past the allocation.
 *
 * Capped rather than refused: a picker who scans a thirteenth unit of a
 * twelve-unit line has picked twelve and made a scanning mistake, and stopping
 * the count dead in the middle of an aisle is worse than holding it at what was
 * allocated. The cap is reported so it can be said out loud.
 */
export function applyScan(
  counted: number,
  quantity: number,
  allocated: number,
): { counted: number; capped: boolean } {
  const next = counted + quantity;
  return next > allocated ? { counted: allocated, capped: true } : { counted: next, capped: false };
}
