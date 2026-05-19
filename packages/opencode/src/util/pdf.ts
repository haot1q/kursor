// Local PDF text extraction so the `read` tool can serve PDFs to every model,
// not just the handful with native PDF input modality. Uses `unpdf` (a
// serverless-friendly wrapper around pdfjs-dist) which has no native bindings
// and works in Bun.

import { extractText, getDocumentProxy } from "unpdf"

// Hard cap to avoid pulling huge PDFs into memory; the read tool will surface a
// clear error above this size rather than OOMing the agent process.
export const MAX_PDF_BYTES = 50 * 1024 * 1024

export type PdfExtractResult = {
  text: string
  pageCount: number
  encrypted?: boolean
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB > 50 MB limit)`)
  }

  // unpdf does a strict `instanceof Uint8Array` check that rejects Node
  // Buffers (which are subclasses). Rewrap so the prototype is plain
  // Uint8Array. The underlying ArrayBuffer is shared — no copy.
  const view =
    bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let pdf
  try {
    pdf = await getDocumentProxy(view)
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    if (/password/i.test(msg) || /encrypt/i.test(msg)) {
      return { text: "", pageCount: 0, encrypted: true }
    }
    throw new Error(`Failed to parse PDF: ${msg}`)
  }

  const { text, totalPages } = await extractText(pdf, { mergePages: false })

  // `text` is string[] keyed by page number when mergePages: false.
  // Render with page markers so the model can navigate by page.
  const pages = Array.isArray(text) ? text : [text]
  const rendered = pages
    .map((page, i) => {
      const trimmed = (page ?? "").trim()
      return `--- page ${i + 1} ---\n${trimmed}`
    })
    .join("\n\n")

  return { text: rendered, pageCount: totalPages }
}
