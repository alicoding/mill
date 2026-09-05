// A minimal, valid single-page PDF with a correct xref (never pdf.js's
// lenient recovery path) -- the TS twin of internal/webviewbridgesmoke's
// smokePdfBytes. Promoted out of atlas-seeded-board-objects.spec.ts
// once a second spec needed a pdf of its own (testing.md's promotion
// rule). `link` adds one URI link annotation, for the specs that drive
// the viewer's external-link door.
export function pdfBytes(opts: { link?: string } = {}): string {
  const content = 'BT /F1 24 Tf 72 690 Td (Link here) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${opts.link ? ' /Annots [6 0 R]' : ''} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...(opts.link ? [`<< /Type /Annot /Subtype /Link /Rect [60 660 320 730] /Border [0 0 0] /A << /S /URI /URI (${opts.link}) >> >>`] : []),
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return out
}
