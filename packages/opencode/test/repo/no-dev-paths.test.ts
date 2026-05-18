import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// Repo-wide privacy invariant: a tracked file in this repository must never
// contain a literal absolute path under /home/<user>/ or /Users/<user>/ where
// <user> looks like a real account name. The previous upstream had
// "/home/thdxr/dev/projects/anomalyco/opencode/..." and
// "/home/thdxr/.local/share/opencode/opencode.db" baked into source — those
// strings are visible to anyone who clones the repo and constitute a static
// leak of the (dev) author's host environment. This test locks the cleanup
// in place so future edits can't reintroduce them.
//
// Placeholders used in documentation/examples (e.g. /Users/name/My Documents)
// are explicitly allowed via PLACEHOLDER_USERNAMES below.

const PLACEHOLDER_USERNAMES = new Set([
  "name",
  "user",
  "username",
  "Username",
  "USER",
  "me",
  "you",
  "your",
  "example",
  "demo",
  "test",
  "tester",
  "developer",
  "dev",
  "admin",
  "root",
])

// Files and directories that legitimately reference absolute paths and should
// not be considered violations. Keep this list as small as possible.
const ALLOWED_PATH_PREFIXES = [
  // Generated artifact: build output / lockfiles are gitignored but if a user
  // ever runs tests locally with a dirty tree, exclude these to keep the
  // invariant deterministic.
  "node_modules/",
  // `bun.lock` records dep resolver paths but only for npm/jsr registries; it
  // is a generated lockfile, never authored, and never contains usernames.
  "bun.lock",
  "bun.lockb",
  // This very test file mentions example usernames in comments. Skip it so
  // the regex below doesn't false-positive on our own documentation.
  "packages/opencode/test/repo/no-dev-paths.test.ts",
  // patch-package output. The `diff --git a/<abs-path> b/<abs-path>` header
  // is emitted by the tool from the package author's machine; regenerating
  // the patches is the right fix, but we don't want CI to block on whatever
  // path was on the patch author's box. Tracked here so the carve-out is
  // explicit and reviewable.
  "patches/",
]

const PATTERN = /\/(home|Users)\/([A-Za-z0-9_.-]+)\//g

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`)
  return result.stdout.trim()
}

function trackedFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`)
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((rel) => !ALLOWED_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix) || rel === prefix))
}

function isLikelyText(absPath: string): boolean {
  // Skip binaries we can detect by extension. Source-tree binaries are rare
  // in this repo, but be defensive — we don't want to false-positive on
  // random bytes that happen to look like /home/x/ in a binary blob.
  const binaryExt = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".icns",
    ".wasm",
    ".ttf",
    ".woff",
    ".woff2",
    ".otf",
    ".eot",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".tgz",
    ".node",
    ".dylib",
    ".so",
    ".dll",
    ".exe",
    ".mp3",
    ".mp4",
    ".webm",
    ".wav",
  ])
  return !binaryExt.has(path.extname(absPath).toLowerCase())
}

type Violation = {
  file: string
  line: number
  username: string
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
    PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = PATTERN.exec(line)) !== null) {
      const username = match[2]
      if (PLACEHOLDER_USERNAMES.has(username)) continue
      violations.push({
        file: rel,
        line: i + 1,
        username,
        excerpt: line.trim().slice(0, 160),
      })
    }
  }
  return violations
}

describe("repo privacy invariants", () => {
  const root = repoRoot()
  const files = trackedFiles(root)

  test("git ls-files returned a non-trivial file list", () => {
    // Sanity: if this drops to 0 we'd silently "pass" the next test.
    expect(files.length).toBeGreaterThan(100)
  })

  test("no tracked file contains an absolute dev-machine path like /home/<user>/ or /Users/<user>/", () => {
    const violations: Violation[] = []
    for (const rel of files) {
      const abs = path.join(root, rel)
      if (!isLikelyText(abs)) continue
      violations.push(...scanFile(abs, rel))
    }

    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 10)
        .map((v) => `  ${v.file}:${v.line}  (user=${v.username})  ${v.excerpt}`)
        .join("\n")
      const more = violations.length > 10 ? `\n  ... and ${violations.length - 10} more` : ""
      throw new Error(
        `Found ${violations.length} dev-machine absolute path(s) in tracked source:\n${formatted}${more}\n\n` +
          `Replace them with a portable path (e.g. path.join(os.homedir(), "...") or import.meta.dir).\n` +
          `If a path is intentional documentation, use a placeholder username from PLACEHOLDER_USERNAMES.`,
      )
    }
    expect(violations).toEqual([])
  })

  test("placeholder allowlist itself is conservative (no real-looking surnames)", () => {
    // Catch a future contributor adding e.g. "skywalker" or "thdxr" to the
    // allowlist as a shortcut to bypass the privacy check.
    const suspicious = ["skywalker", "thdxr", "haot1q", "anomalyco"]
    for (const word of suspicious) {
      expect(PLACEHOLDER_USERNAMES.has(word)).toBe(false)
    }
  })
})
