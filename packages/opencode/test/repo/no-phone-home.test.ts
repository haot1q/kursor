import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// Privacy invariant: production source code must not bake in runtime calls
// to opencode.ai assets / APIs that would (a) signal "another kursor user
// just launched" to a third-party service or (b) upload session content.
//
// What we lock down here, and why each one matters:
//
//   * https://opencode.ai/changelog.json — fetched on every launch by the
//     release-notes dialog. Every fetch reveals an IP + User-Agent +
//     kursor version to a service we don't operate.
//   * https://opencode.ai/favicon* and friends — referenced by Notification
//     options. Every desktop notification triggered a remote fetch.
//   * https://api.opencode.ai/share, /shares, /s/ — the legacy share
//     endpoint. We already pin share-next.ts disabled = true, but this
//     test also forbids the URL string from appearing in code paths that
//     could be reached.
//
// What we explicitly allow, with rationale:
//
//   * Doc/help links the user clicks intentionally (e.g.
//     `shell.openExternal("https://opencode.ai/docs")`) — these are user-
//     initiated navigations, not automatic network egress. They are still
//     a branding/UX concern (separate commit) but not a privacy leak.
//   * Theme/config JSON $schema URLs ("$schema":
//     "https://opencode.ai/theme.json") — these are static metadata
//     strings that editors might fetch for autocompletion, but the kursor
//     runtime never resolves them.
//   * String references in tests, prompts, specs, docs, fixtures — they
//     don't drive runtime behavior.
//
// To stay precise, this test scans only the production source roots
// (`packages/*/src/**`) and applies a narrow regex that matches the
// specific endpoints we are blocking, not every literal "opencode.ai"
// substring.

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`)
  return result.stdout.trim()
}

function trackedSrcFiles(root: string): string[] {
  // No pathspec — git ls-files default pathspec does not let `*` cross
  // path separators, so `packages/*/src` would match nothing. Filter in
  // JS to keep the rule precise and easy to audit.
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`)
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((rel) => {
      // Production source roots only: packages/<pkg>/src/**.
      const m = rel.match(/^packages\/[^/]+\/src\//)
      if (!m) return false
      const ext = path.extname(rel).toLowerCase()
      if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return false
      // Tests/stories/fixtures co-located in `src` are not production
      // runtime paths.
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false
      if (rel.endsWith(".stories.ts") || rel.endsWith(".stories.tsx")) return false
      if (rel.includes("/__fixtures__/") || rel.includes("/__mocks__/")) return false
      return true
    })
}

// Each entry is a {pattern, label, why}. The pattern must match a real
// runtime call site (URL inside fetch/Notification/HTTP client), not a
// comment or a doc string. We anchor against `"` or `'` quotes plus the
// host so plain documentation prose ("see opencode.ai for…") doesn't
// trigger.
type Rule = { pattern: RegExp; label: string }
const RULES: Rule[] = [
  {
    pattern: /["'`]https?:\/\/opencode\.ai\/changelog\.json["'`]/,
    label: "opencode.ai/changelog.json (release-notes auto fetch)",
  },
  {
    pattern: /["'`]https?:\/\/opencode\.ai\/favicon[\w.-]*["'`]/,
    label: "opencode.ai/favicon-* (notification icon auto fetch)",
  },
  {
    pattern: /["'`]https?:\/\/(?:api\.)?opencode\.ai\/(?:s|share|shares)\/?["'`]/,
    label: "opencode.ai share API (session upload)",
  },
]

type Violation = {
  file: string
  line: number
  rule: string
  excerpt: string
}

function scanFile(absPath: string, rel: string): Violation[] {
  let content: string
  try {
    content = fs.readFileSync(absPath, "utf8")
  } catch {
    return []
  }
  const violations: Violation[] = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: rule.label,
          excerpt: line.trim().slice(0, 200),
        })
      }
    }
  }
  return violations
}

describe("repo privacy: no automatic phone-home to opencode.ai", () => {
  const root = repoRoot()
  const files = trackedSrcFiles(root)

  test("git ls-files returned a non-trivial source tree", () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test("no production source file embeds a forbidden opencode.ai endpoint", () => {
    const violations: Violation[] = []
    for (const rel of files) {
      const abs = path.join(root, rel)
      violations.push(...scanFile(abs, rel))
    }

    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 10)
        .map((v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.excerpt}`)
        .join("\n")
      const more = violations.length > 10 ? `\n  ... and ${violations.length - 10} more` : ""
      throw new Error(
        `Found ${violations.length} runtime opencode.ai endpoint reference(s) in production source:\n${formatted}${more}\n\n` +
          `Replace with a local fallback, a kursor-controlled endpoint, or remove the call site entirely.`,
      )
    }
    expect(violations).toEqual([])
  })
})
