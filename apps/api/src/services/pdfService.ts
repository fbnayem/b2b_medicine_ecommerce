import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * The documents the business hands to a customer.
 *
 * What this replaces was 38 lines that stamped text at fixed offsets, and it
 * was wrong in three ways that all reached the customer:
 *
 *   1. **It truncated in silence.** The line budget was `(842 - 50) / 16 = 49`,
 *      and the invoice builder spent about 21 of those on the header and the
 *      totals. An order past roughly 28 items lost the rest — no second page,
 *      no warning, no error. The customer signed for goods the invoice did not
 *      list, which is the worst defect in this file's history precisely because
 *      nothing about the output looked broken.
 *   2. **It could not print `৳`.** Every character outside `\x20-\x7e` became a
 *      `?`, so the currency symbol of the country this system runs in, and every
 *      Bangla name, rendered as a question mark.
 *   3. It had no columns, so an invoice line was slash-separated prose.
 *
 * A real layout engine fixes all three: text is measured and wrapped, pages are
 * added when the content needs them, and a Unicode font is embedded so the
 * glyphs are the ones that were asked for.
 *
 * **A note on Bangla and copy-paste.** Bengali reorders when it is set: the
 * vowel sign `ে` is stored after its consonant and drawn before it, so
 * `ট্যাবলেট` lays out as `ট্যাবেলট`. That reordering is the renderer doing its
 * job and the page is correct. What it costs is that selecting the text back
 * out of the PDF yields visual order rather than logical order. Correcting that
 * needs `/ActualText` spans, which need tagged-PDF mode; it is recorded here
 * rather than half-done, because the page being right is the part a customer
 * sees and the part the old file got wrong.
 */

export type PdfPaper = 'A4' | 'THERMAL';

/**
 * One embedded font for everything.
 *
 * Noto Sans Bengali covers Latin, Bengali, Bengali digits and `৳` in a single
 * file. The hinted static builds of the same family do **not** — they carry no
 * Latin at all, so `Napa 500` would have rendered as four empty boxes. That was
 * checked against the font itself rather than assumed from its name.
 */
const FONT_PATH = resolve(__dirname, '../../assets/fonts/NotoSansBengali-VF.ttf');
const FONT = 'body';

let fontFile: Buffer | undefined;
function fontBuffer(): Buffer {
  if (!fontFile) fontFile = readFileSync(FONT_PATH);
  return fontFile;
}

interface Geometry {
  size: [number, number];
  margin: number;
  body: number;
  small: number;
  heading: number;
  leading: number;
}

/** A4 for the office printer; an 80mm roll for the counter printer. */
const GEOMETRY: Record<PdfPaper, Geometry> = {
  A4: { size: [595.28, 841.89], margin: 42, body: 9.5, small: 8, heading: 15, leading: 3 },
  THERMAL: { size: [226, 841.89], margin: 10, body: 7.5, small: 6.5, heading: 10, leading: 2 },
};

function newDocument(paper: PdfPaper) {
  const geometry = GEOMETRY[paper];
  const doc = new PDFDocument({
    size: geometry.size,
    margin: geometry.margin,
    // `Page n of m` cannot be stamped until the page count is known, so pages
    // are buffered and the footer is written across all of them at the end.
    bufferPages: true,
    info: { Producer: 'MedSupply B2B', Creator: 'MedSupply B2B' },
  });
  doc.registerFont(FONT, fontBuffer());
  doc.font(FONT).fontSize(geometry.body);
  return { doc, geometry };
}

function contentWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Room held back at the foot of the page for the stamped footer. */
function bottomLimit(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.bottom - 22;
}

/** Adds a page when `needed` points would overflow, and reports whether it did. */
function ensureRoom(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed <= bottomLimit(doc)) return false;
  doc.addPage();
  return true;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Stamps `Page n of m` on every page.
 *
 * This is why the document buffers its pages. Someone handed page 3 of an
 * invoice needs to know whether a page 4 exists — which is exactly what the old
 * silent truncation denied them.
 */
function stampFooter(doc: PDFKit.PDFDocument, geometry: Geometry, note?: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const y = doc.page.height - doc.page.margins.bottom - 14;
    doc.fontSize(geometry.small).fillColor('#5d6b62');
    if (note) {
      doc.text(note, doc.page.margins.left, y, {
        width: contentWidth(doc) / 2,
        lineBreak: false,
      });
    }
    doc.text(`Page ${index + 1} of ${range.count}`, doc.page.margins.left, y, {
      width: contentWidth(doc),
      align: 'right',
      lineBreak: false,
    });
    doc.fillColor('#000000');
  }
}

/**
 * A line-oriented document: the customer statement, the payment receipt and the
 * credit note, all of which genuinely are a sequence of lines rather than a
 * table.
 *
 * The signature is unchanged from what it replaces apart from being async,
 * because collecting a stream cannot be synchronous. Every caller was already
 * inside an async controller.
 */
export async function createSimplePdf(lines: string[], paper: PdfPaper = 'A4'): Promise<Buffer> {
  const { doc, geometry } = newDocument(paper);
  const width = contentWidth(doc);

  for (const line of lines) {
    const text = line ?? '';
    const height = doc.heightOfString(text || ' ', { width });
    ensureRoom(doc, height);
    doc.text(text, doc.page.margins.left, doc.y, { width });
    doc.y += geometry.leading;
  }

  stampFooter(doc, geometry);
  return collect(doc);
}

export interface PdfTableColumn {
  header: string;
  /** Relative share of the content width; shares are normalised. */
  width: number;
  align?: 'left' | 'right';
}

export interface PdfDocumentSpec {
  /** Rendered at the top of the first page. */
  brand: string;
  brandLines?: string[];
  title: string;
  /** Label/value pairs shown as a two-column block beneath the title. */
  facts?: Array<[string, string]>;
  table?: { columns: PdfTableColumn[]; rows: string[][] };
  /** Right-aligned label/value pairs after the table; `strong` is the payable. */
  totals?: Array<{ label: string; value: string; strong?: boolean }>;
  footer?: string[];
  /** Stamped bottom-left of every page, beside the page number. */
  pageNote?: string;
}

/**
 * A structured document — currently the invoice, which is the one artefact in
 * this system that a customer physically holds and signs.
 */
export async function createDocumentPdf(
  spec: PdfDocumentSpec,
  paper: PdfPaper = 'A4',
): Promise<Buffer> {
  const { doc, geometry } = newDocument(paper);
  const width = contentWidth(doc);
  const left = doc.page.margins.left;

  doc.fontSize(geometry.heading).text(spec.brand, left, doc.y, { width });
  doc.fontSize(geometry.small).fillColor('#5d6b62');
  for (const line of spec.brandLines ?? []) if (line.trim()) doc.text(line, left, doc.y, { width });
  doc.fillColor('#000000');

  doc.moveDown(0.6);
  doc.fontSize(geometry.body + 2).text(spec.title, left, doc.y, { width });
  doc.moveDown(0.4);

  if (spec.facts?.length) drawFacts(doc, geometry, spec.facts, paper);
  if (spec.table) drawTable(doc, geometry, spec.table, paper);
  if (spec.totals?.length) drawTotals(doc, geometry, spec.totals);

  if (spec.footer?.length) {
    doc.moveDown(0.8);
    doc.fontSize(geometry.small).fillColor('#5d6b62');
    for (const line of spec.footer) {
      if (!line.trim()) continue;
      ensureRoom(doc, doc.heightOfString(line, { width }));
      doc.text(line, left, doc.y, { width });
    }
    doc.fillColor('#000000');
  }

  stampFooter(doc, geometry, spec.pageNote);
  return collect(doc);
}

function drawFacts(
  doc: PDFKit.PDFDocument,
  geometry: Geometry,
  facts: Array<[string, string]>,
  paper: PdfPaper,
) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  // On an 80mm roll there is no room for two columns of anything.
  const columns = paper === 'THERMAL' ? 1 : 2;
  const columnWidth = width / columns;
  const labelWidth = paper === 'THERMAL' ? columnWidth * 0.45 : columnWidth * 0.34;

  doc.fontSize(geometry.small);
  for (let index = 0; index < facts.length; index += 1) {
    const [label, value] = facts[index]!;
    const column = index % columns;
    const x = left + column * columnWidth;
    if (column === 0) {
      ensureRoom(
        doc,
        Math.max(
          doc.heightOfString(label, { width: labelWidth }),
          doc.heightOfString(value || '—', { width: columnWidth - labelWidth - 6 }),
        ),
      );
    }
    const y = doc.y;
    doc.fillColor('#5d6b62').text(label, x, y, { width: labelWidth, lineBreak: false });
    doc
      .fillColor('#000000')
      .text(value || '—', x + labelWidth, y, { width: columnWidth - labelWidth - 6 });
    // Advance only once the row is complete, so both columns share a baseline.
    doc.y = column === columns - 1 || index === facts.length - 1 ? y + 12 : y;
  }
  doc.fillColor('#000000').moveDown(0.5);
}

function drawTable(
  doc: PDFKit.PDFDocument,
  geometry: Geometry,
  table: { columns: PdfTableColumn[]; rows: string[][] },
  paper: PdfPaper,
) {
  // 80mm is too narrow for a seven-column table, so each row is stacked
  // instead. Squeezing columns onto a roll produces something illegible, and an
  // illegible delivery slip is the same as no delivery slip.
  if (paper === 'THERMAL') return drawStackedRows(doc, geometry, table);

  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const total = table.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const widths = table.columns.map((column) => (column.width / total) * width);

  const header = () => {
    const y = doc.y;
    doc.fontSize(geometry.small).fillColor('#5d6b62');
    let x = left;
    table.columns.forEach((column, index) => {
      doc.text(column.header, x, y, {
        width: widths[index]! - 4,
        align: column.align ?? 'left',
        lineBreak: false,
      });
      x += widths[index]!;
    });
    doc.fillColor('#000000');
    doc.y = y + 12;
    doc
      .moveTo(left, doc.y - 3)
      .lineTo(left + width, doc.y - 3)
      .lineWidth(0.5)
      .strokeColor('#c9d2cc')
      .stroke();
  };

  ensureRoom(doc, 40);
  header();

  doc.fontSize(geometry.body);
  for (const row of table.rows) {
    const rowHeight = Math.max(
      ...row.map((cell, index) => doc.heightOfString(cell ?? '', { width: widths[index]! - 4 })),
      11,
    );
    // Re-draw the column headers whenever the table crosses onto a new page, so
    // page 2 of an invoice is readable on its own.
    if (ensureRoom(doc, rowHeight + 2)) header();
    const y = doc.y;
    let x = left;
    row.forEach((cell, index) => {
      doc.text(cell ?? '', x, y, {
        width: widths[index]! - 4,
        align: table.columns[index]?.align ?? 'left',
      });
      x += widths[index]!;
    });
    doc.y = y + rowHeight + 2;
  }

  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(0.5)
    .strokeColor('#c9d2cc')
    .stroke();
  doc.moveDown(0.4);
}

function drawStackedRows(
  doc: PDFKit.PDFDocument,
  geometry: Geometry,
  table: { columns: PdfTableColumn[]; rows: string[][] },
) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  doc.fontSize(geometry.small);
  for (const row of table.rows) {
    ensureRoom(doc, 12 * row.length);
    table.columns.forEach((column, index) => {
      const value = row[index] ?? '';
      if (!value) return;
      const y = doc.y;
      doc.fillColor('#5d6b62').text(column.header, left, y, { width: width * 0.42 });
      doc.fillColor('#000000').text(value, left + width * 0.42, y, { width: width * 0.58 });
      doc.y = Math.max(doc.y, y + 10);
    });
    doc.moveDown(0.3);
  }
  doc.fillColor('#000000');
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  geometry: Geometry,
  totals: Array<{ label: string; value: string; strong?: boolean }>,
) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const block = Math.min(width, 260);
  const x = left + width - block;

  for (const total of totals) {
    ensureRoom(doc, 14);
    const y = doc.y;
    doc.fontSize(total.strong ? geometry.body + 1.5 : geometry.small);
    doc
      .fillColor(total.strong ? '#000000' : '#5d6b62')
      .text(total.label, x, y, { width: block * 0.55, lineBreak: false });
    doc.fillColor('#000000').text(total.value, x + block * 0.55, y, {
      width: block * 0.45,
      align: 'right',
      lineBreak: false,
    });
    doc.y = y + (total.strong ? 17 : 13);
  }
  doc.fontSize(geometry.body);
}
