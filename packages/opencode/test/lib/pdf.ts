// Hand-rolled minimal PDF builders for tests. PDF xref tables require
// byte-accurate offsets, so we assemble objects sequentially and record
// offsets as we append. All output is encoded as latin1 so the binary
// marker bytes survive intact.

const HEADER = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"

const assemble = (objects: string[]): Buffer => {
  const parts: string[] = [HEADER]
  const offsets: number[] = []
  let length = Buffer.byteLength(HEADER, "latin1")
  for (const obj of objects) {
    offsets.push(length)
    parts.push(obj)
    length += Buffer.byteLength(obj, "latin1")
  }
  const xrefStart = length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += off.toString().padStart(10, "0") + " 00000 n \n"
  }
  parts.push(xref)
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  return Buffer.from(parts.join(""), "latin1")
}

const escapePdfString = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")

const contentStream = (text: string): string => {
  const escaped = escapePdfString(text)
  return `BT /F1 24 Tf 50 700 Td (${escaped}) Tj ET`
}

// Single-page PDF showing the given text.
export const buildMinimalPdf = (text: string): Buffer => {
  const stream = contentStream(text)
  return assemble([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ])
}

// Multi-page PDF: one page per element of `texts`. Object layout:
//   1  catalog
//   2  pages (kids list)
//   3  font
//   4..(4+N-1)        page objects
//   (4+N)..(4+2N-1)   content streams
export const buildMultiPagePdf = (texts: string[]): Buffer => {
  const n = texts.length
  if (n === 0) throw new Error("buildMultiPagePdf needs at least one page")

  const pageStart = 4
  const contentStart = pageStart + n
  const kids = Array.from({ length: n }, (_, i) => `${pageStart + i} 0 R`).join(" ")

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`,
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ]
  for (let i = 0; i < n; i++) {
    const pageId = pageStart + i
    const contentId = contentStart + i
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentId} 0 R >>\nendobj\n`,
    )
  }
  for (let i = 0; i < n; i++) {
    const contentId = contentStart + i
    const stream = contentStream(texts[i])
    objects.push(
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    )
  }
  return assemble(objects)
}

// PDF with a page but no content stream — pdfjs sees a valid page with zero
// extractable text. Models the "scanned image PDF" case.
export const buildEmptyPagePdf = (): Buffer =>
  assemble([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ])
