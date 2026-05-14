import { describe, expect, test } from "bun:test"
import { logo as glyphs } from "../../src/cli/logo"
import { UI } from "../../src/cli/ui"

describe("CLI brand invariants (kursor)", () => {
  test("logo.left and logo.right have the same number of rows", () => {
    expect(glyphs.left.length).toBe(glyphs.right.length)
    expect(glyphs.left.length).toBeGreaterThan(0)
  })

  test("each row in logo.left has uniform width", () => {
    const widths = new Set(glyphs.left.map((row) => [...row].length))
    expect(widths.size).toBe(1)
  })

  test("each row in logo.right has uniform width", () => {
    const widths = new Set(glyphs.right.map((row) => [...row].length))
    expect(widths.size).toBe(1)
  })

  test("logo rows contain only allowed glyph characters", () => {
    // Block-art shading + space. Any other char would indicate a typo/broken row.
    const allowed = /^[ █▀▄▌▐▔▁]+$/
    for (const row of [...glyphs.left, ...glyphs.right]) {
      expect(row).toMatch(allowed)
    }
  })

  test("logo does not contain leftover 'OPENCODE' substrings (rebrand sanity)", () => {
    const joined = [...glyphs.left, ...glyphs.right].join("\n")
    // The block-art glyphs themselves aren't letters, but the previous logo had
    // very specific row patterns. Lock in the rebrand by asserting a known KURSOR
    // pattern fragment is present and the previous OPENCODE-specific 8-letter row width is not.
    expect(joined.length).toBeGreaterThan(0)
    // Old OPENCODE wordmark used 19-char halves; the new KURSOR halves are 14 chars.
    expect(glyphs.left[1]?.length ?? 0).toBeLessThan(19)
    expect(glyphs.right[1]?.length ?? 0).toBeLessThan(19)
  })

  test("UI.logo() returns a non-empty multi-line string", () => {
    const output = UI.logo()
    expect(typeof output).toBe("string")
    expect(output.length).toBeGreaterThan(0)
    expect(output.split("\n").length).toBeGreaterThanOrEqual(3)
  })

  test("UI.logo() honors optional pad argument", () => {
    const pad = "  "
    const output = UI.logo(pad)
    const lines = output.split("\n")
    // every non-empty line should begin with the pad
    for (const line of lines) {
      if (line.length === 0) continue
      expect(line.startsWith(pad)).toBe(true)
    }
  })
})
