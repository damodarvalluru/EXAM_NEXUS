/**
 * Minimal dependency-free PDF writer for certificate documents. It emits a
 * single A4 page with Helvetica text. No third-party service is involved, so
 * the generated document never leaves the platform without an explicit export.
 * Helvetica/WinAnsi cannot render non-Latin scripts; unsupported code points
 * are replaced with '?' and this limitation is documented in the API guide.
 * Deployments needing Unicode certificates should supply an embedded Unicode
 * font through a PDF library rather than this dependency-free writer.
 */
function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function buildCertificatePdf(lines: readonly string[]): Buffer {
  const commands = [
    'BT',
    '/F1 22 Tf',
    '72 760 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? `(${pdfText(line)}) Tj` : `0 -32 Td (${pdfText(line)}) Tj`,
    ]),
    'ET',
  ].join('\n');
  const content = Buffer.from(commands, 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
