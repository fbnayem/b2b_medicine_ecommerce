import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createDocumentPdf, createSimplePdf } from './pdfService';

/**
 * The guards for the two defects the old PDF builder shipped.
 *
 * Both were invisible: a truncated invoice looks like a short invoice, and a
 * `?` where `৳` should be looks like a font problem rather than a document that
 * cannot represent the currency of the country it is issued in. Neither had a
 * test, which is why both survived to the audit.
 *
 * These assertions read the document itself rather than trusting the builder.
 * PDF content streams are Flate-compressed, so they are inflated first; no
 * parser dependency is needed because both properties are visible in the raw
 * objects — the page count in the object graph, and the character coverage in
 * the `ToUnicode` CMap, which maps each embedded glyph back to the codepoint it
 * came from.
 */

/** Every Flate-compressed stream in the document, inflated and concatenated. */
function inflatedStreams(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let out = '';
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      out += inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
    } catch {
      // Not every stream is Flate-compressed; the font file is not.
    }
  }
  return out;
}

/** `/Type /Pages` is the tree node, not a page, hence the negative lookahead. */
function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** Text-showing operations — one per laid-out run. */
function showOperations(streams: string): number {
  return (streams.match(/\]\s*TJ|\)\s*Tj/g) ?? []).length;
}

test('a long document keeps every line instead of silently truncating', async () => {
  /*
   * The implementation this replaces sliced to `(842 - 50) / 16 = 49` lines and
   * dropped the rest without a page break, an error or any other signal. At 200
   * lines it emitted 49; anything at or above 200 here means the content is
   * being paginated rather than discarded.
   */
  const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
  const pdf = await createSimplePdf(lines, 'A4');
  const shown = showOperations(inflatedStreams(pdf));

  assert.ok(pageCount(pdf) > 1, `expected more than one page, got ${pageCount(pdf)}`);
  assert.ok(shown >= lines.length, `expected at least ${lines.length} runs, got ${shown}`);
});

test('an invoice longer than one page paginates rather than losing items', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => [
    `Medicine ${index + 1}`,
    `B-${index + 1}`,
    '02 Aug 2027',
    '10',
    '৳10.80',
    '৳0.00',
    '৳108.00',
  ]);
  const pdf = await createDocumentPdf({
    brand: 'MedSupply B2B',
    title: 'Invoice INV-2026-000001',
    table: {
      columns: [
        { header: 'Medicine', width: 30 },
        { header: 'Batch', width: 14 },
        { header: 'Expiry', width: 13 },
        { header: 'Qty', width: 8, align: 'right' },
        { header: 'Unit', width: 12, align: 'right' },
        { header: 'Discount', width: 11, align: 'right' },
        { header: 'Total', width: 12, align: 'right' },
      ],
      rows,
    },
    totals: [{ label: 'Grand total', value: '৳6,480.00', strong: true }],
  });

  const pages = pageCount(pdf);
  assert.ok(pages > 1, `expected a multi-page invoice, got ${pages}`);
  // Seven cells a row, and the column headers are repeated on every page.
  const shown = showOperations(inflatedStreams(pdf));
  assert.ok(shown >= rows.length * 7, `expected at least ${rows.length * 7} cells, got ${shown}`);
});

test('the taka sign and Bangla reach the document instead of becoming question marks', async () => {
  const pdf = await createSimplePdf(['৳12,500.00', 'নাপা ৫০০ ট্যাবলেট'], 'A4');
  const streams = inflatedStreams(pdf);

  const mapped = (codepoint: number) =>
    new RegExp(`<${codepoint.toString(16).padStart(4, '0')}>`, 'i').test(streams);

  assert.ok(mapped(0x09f3), 'the taka sign ৳ did not reach the document');
  assert.ok(mapped(0x09a8), 'Bengali ন did not reach the document');
  assert.ok(mapped(0x09eb), 'the Bengali digit ৫ did not reach the document');
  assert.ok(mapped(0x0031), 'the Western digit 1 did not reach the document');
  /*
   * A codepoint that was never written must be absent, or the assertions above
   * would pass against any document at all. `ঌ` is not in the sample text.
   */
  assert.ok(!mapped(0x098c), 'the coverage check does not discriminate');
});

test('both paper sizes produce a valid document at the expected width', async () => {
  const lines = ['MedSupply B2B', 'Invoice INV-2026-000001'];
  const a4 = await createSimplePdf(lines, 'A4');
  const thermal = await createSimplePdf(lines, 'THERMAL');

  assert.equal(a4.subarray(0, 5).toString(), '%PDF-');
  assert.match(a4.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(thermal.toString('latin1'), /\/MediaBox \[0 0 226 841\.89\]/);
  assert.match(a4.toString('latin1'), /%%EOF\s*$/);
  // Embedded as a CID-keyed TrueType subset, which is what carries Bengali.
  assert.match(a4.toString('latin1'), /\/Subtype\s*\/CIDFontType2/);
});
