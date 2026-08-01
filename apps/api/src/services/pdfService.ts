export type PdfPaper = 'A4' | 'THERMAL';

const escapePdf = (value: string) => value.replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?');

export function createSimplePdf(lines: string[], paper: PdfPaper = 'A4') {
  const thermal = paper === 'THERMAL';
  const width = thermal ? 226 : 595;
  const height = 842;
  const left = thermal ? 14 : 50;
  const fontSize = thermal ? 8 : 10;
  const lineHeight = thermal ? 12 : 16;
  const content = lines
    .slice(0, Math.floor((height - 50) / lineHeight))
    .map(
      (line, index) =>
        `BT /F1 ${fontSize} Tf ${left} ${height - 35 - index * lineHeight} Td (${escapePdf(line)}) Tj ET`,
    )
    .join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj`,
    `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((value) => `${String(value).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
