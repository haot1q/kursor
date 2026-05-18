import { test, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  parseShareUrl,
  shouldAttachShareAuthHeaders,
  transformShareData,
  type ShareData,
} from "../../src/cli/cmd/import"

// parseShareUrl tests
test("parses valid share URLs", () => {
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://custom.example.com/share/abc123")).toBe("abc123")
  expect(parseShareUrl("http://localhost:3000/share/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://opncd.ai/s/Jsj3hNIW")).toBeNull() // legacy format
  expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/id/extra")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
  ]

  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})

// Source-level privacy invariant for the import CLI.
//
// Background: before this commit, `opencode import <url>` issued a real
// `fetch()` against the share API origin to download another user's
// shared session. That call bypassed the `disabled` short-circuits inside
// share-next.ts (which only guard create / sync / remove) and would have
// leaked the user's IP + User-Agent + the share secret to a third-party
// service. kursor refuses URL-based import entirely; only file-based
// import (the local disk path) is allowed.
//
// We assert the invariant at the source level rather than by
// orchestrating the full CLI inside the test runner, because the body of
// `runImport` is bound up in Effect generators / Database / Schema layers
// that are hostile to lightweight isolation. Source-level pinning is
// deliberately strict: any future PR that re-adds a `fetch(` call inside
// the URL branch must also update this test, which forces the privacy
// review to happen.
function importSource(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`)
  return fs.readFileSync(
    path.join(result.stdout.trim(), "packages/opencode/src/cli/cmd/import.ts"),
    "utf8",
  )
}

// Strip both line and block comments from a TS/TSX source so a literal
// like `fetch()` inside a privacy comment doesn't fool the source-level
// regex. We do this with a small state machine rather than a regex to
// stay correct on edge cases (strings containing "//", etc.).
function stripComments(source: string): string {
  let out = ""
  let i = 0
  type Mode = "code" | "line" | "block" | "single" | "double" | "tpl"
  let mode: Mode = "code"
  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (mode === "code") {
      if (c === "/" && n === "/") {
        mode = "line"
        i += 2
        continue
      }
      if (c === "/" && n === "*") {
        mode = "block"
        i += 2
        continue
      }
      if (c === "'") mode = "single"
      else if (c === '"') mode = "double"
      else if (c === "`") mode = "tpl"
      out += c
      i++
      continue
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code"
        out += c
      }
      i++
      continue
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code"
        i += 2
        continue
      }
      i++
      continue
    }
    // String literal modes — keep contents verbatim (the regex below
    // wants to match `fetch(` even inside string literals).
    out += c
    if (mode === "single" && c === "'" && source[i - 1] !== "\\") mode = "code"
    else if (mode === "double" && c === '"' && source[i - 1] !== "\\") mode = "code"
    else if (mode === "tpl" && c === "`" && source[i - 1] !== "\\") mode = "code"
    i++
  }
  return out
}

test("kursor privacy: import.ts URL branch hard-refuses and contains no fetch() call site", () => {
  const source = importSource()

  // The URL branch must exist (it's where we reject) and must contain the
  // refusal message. If a refactor removes the early return, this regex
  // fails and the diff is blocked.
  expect(source).toMatch(/URL-based import is disabled in kursor for privacy/)

  // Belt-and-braces: NO `fetch(` call site anywhere in the file once
  // comments are stripped. The upstream URL branch called fetch()
  // directly to download share data, bypassing the HttpClient service
  // layer (and therefore the `disabled` guards inside share-next.ts).
  // Any reintroduction of a `fetch(` call site here is assumed to re-
  // open the egress and fails this test. We strip comments before the
  // regex so that a privacy comment that contains the word "fetch(" does
  // not produce a false positive.
  const stripped = stripComments(source)
  expect(stripped).not.toMatch(/\bfetch\(/)
})

test("kursor privacy: import.ts does not import ShareNext (no share-API access path)", () => {
  const source = importSource()

  // ShareNext.Service was the gateway used by the old URL branch to read
  // `request()` (URL + headers) before issuing the fetch. With the URL
  // branch gone, importing ShareNext at all would be a smell: any access
  // to share-next here would either be dead code (lint risk) or a path to
  // re-enable the egress. Pin it out.
  expect(source).not.toMatch(/from\s+["'`]@\/share\/share-next["'`]/)
  expect(source).not.toMatch(/ShareNext\.Service/)
})
