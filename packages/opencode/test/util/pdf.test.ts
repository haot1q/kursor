import { describe, expect, test } from "bun:test"
import { extractPdfText, MAX_PDF_BYTES } from "../../src/util/pdf"
import { buildEmptyPagePdf, buildMinimalPdf, buildMultiPagePdf } from "../lib/pdf"

describe("extractPdfText", () => {
  test("extracts the visible text from a single-page PDF", async () => {
    const result = await extractPdfText(buildMinimalPdf("Hello PDF World"))
    expect(result.pageCount).toBe(1)
    expect(result.text).toContain("Hello PDF World")
    expect(result.text).toContain("--- page 1 ---")
    expect(result.encrypted).toBeUndefined()
  })

  test("preserves page boundaries with --- page N --- markers", async () => {
    const result = await extractPdfText(buildMultiPagePdf(["alpha first", "beta second", "gamma third"]))
    expect(result.pageCount).toBe(3)
    expect(result.text).toContain("--- page 1 ---")
    expect(result.text).toContain("--- page 2 ---")
    expect(result.text).toContain("--- page 3 ---")
    expect(result.text).toContain("alpha first")
    expect(result.text).toContain("beta second")
    expect(result.text).toContain("gamma third")
    // Pages should appear in order.
    expect(result.text.indexOf("alpha first")).toBeLessThan(result.text.indexOf("beta second"))
    expect(result.text.indexOf("beta second")).toBeLessThan(result.text.indexOf("gamma third"))
  })

  test("returns empty text but valid page count for a content-less page (scanned PDF)", async () => {
    const result = await extractPdfText(buildEmptyPagePdf())
    expect(result.pageCount).toBe(1)
    // No content stream → no extractable glyphs, just the page marker.
    expect(result.text).toBe("--- page 1 ---\n")
    expect(result.encrypted).toBeUndefined()
  })

  test("rejects a PDF that exceeds the byte cap before touching pdfjs", async () => {
    // Big enough buffer to trip the size guard. We don't care about contents
    // — the size check fires before parsing.
    const oversize = new Uint8Array(MAX_PDF_BYTES + 1)
    oversize[0] = 0x25 // '%' so isPdfAttachment-style sniffing wouldn't complain
    await expect(extractPdfText(oversize)).rejects.toThrow(/PDF too large/)
  })

  test("throws a clear error on garbage bytes", async () => {
    const garbage = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("not a real pdf body")])
    await expect(extractPdfText(garbage)).rejects.toThrow(/Failed to parse PDF/)
  })

  test("accepts a Node Buffer as input (compat with fs.readFile)", async () => {
    // fs.readFile returns a Buffer; unpdf's instanceof Uint8Array check
    // rejects it. extractPdfText is supposed to rewrap internally.
    const buf: Buffer = buildMinimalPdf("Buffer input works")
    expect(buf).toBeInstanceOf(Buffer)
    const result = await extractPdfText(buf)
    expect(result.text).toContain("Buffer input works")
  })
})
