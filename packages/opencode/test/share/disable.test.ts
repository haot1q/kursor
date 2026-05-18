import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

// Privacy invariants for the share feature.
//
// kursor has decided that session content must never leave the user's
// machine via the legacy "share" mechanism. The enforcement is layered:
//
//   1. packages/opencode/src/share/share-next.ts defines a module-level
//      constant `disabled` that gates every network entry point (init,
//      sync, flush, create, remove, state bootstrap). The original code
//      derived `disabled` from the OPENCODE_DISABLE_SHARE env var so an
//      operator could opt out of sharing. kursor pins that constant to
//      `true` so flipping a process environment cannot re-enable a
//      network egress kursor has decided to forbid.
//
//   2. packages/opencode/src/config/config.ts forces the resolved
//      `config.share` value to "disabled" after the user/global/managed
//      merge. Every UI/CLI guard that reads `config.share` ("manual" |
//      "auto" | "disabled") then takes its disabled branch — share
//      buttons are hidden, the auto-share startup path in
//      packages/opencode/src/share/session.ts no-ops, etc.
//
// This test asserts both layers at the source level. A regression in
// either file (e.g. a careless `const disabled = process.env...`
// re-introduction, or removing the `result.share = "disabled"` line)
// trips the corresponding assertion and the diff is rejected.

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr}`)
  return result.stdout.trim()
}

describe("share is unconditionally disabled in kursor", () => {
  const root = repoRoot()

  test("share-next.ts pins the module-level `disabled` constant to true", () => {
    const source = fs.readFileSync(
      path.join(root, "packages/opencode/src/share/share-next.ts"),
      "utf8",
    )

    // The literal pinning. Any future PR that re-derives `disabled` from
    // a runtime expression (process.env, config lookup, etc.) will fail
    // this regex.
    expect(source).toMatch(/^const\s+disabled\s*=\s*true\s*$/m)

    // Belt-and-braces: no env-var-driven disable expression anywhere in
    // the file. If you legitimately need to reintroduce a runtime
    // override, you must also update the privacy comment and this test.
    expect(source).not.toMatch(/disabled\s*=.*process\.env\[?["']OPENCODE_DISABLE_SHARE["']/)
  })

  test("config loader forces resolved share value to 'disabled'", () => {
    const source = fs.readFileSync(
      path.join(root, "packages/opencode/src/config/config.ts"),
      "utf8",
    )

    // The literal override. Located after the legacy `autoshare → share`
    // migration so it wins regardless of upstream defaults.
    expect(source).toMatch(/result\.share\s*=\s*["']disabled["']/)
  })

  test("SessionShare wrapper throws on disabled config BEFORE calling ShareNext", () => {
    // packages/opencode/src/share/session.ts wraps ShareNext with a
    // config-aware share() that performs an explicit `conf.share ===
    // "disabled"` check and throws BEFORE delegating to
    // shareNext.create(). That guard is what the HTTP API handler relies
    // on: handlers/session.ts maps the thrown error to an InternalServer
    // response so the network egress is short-circuited at the public
    // boundary, not just at the inner ShareNext layer.
    //
    // If a refactor moves the call to shareNext.create() above the guard
    // (or drops the throw), the disabled config would no longer block the
    // HTTP entry point — only the inner `disabled = true` pin would. That
    // would still hold (defense in depth), but the layered guarantee that
    // we document for security review would be silently weakened. Pin
    // the structural ordering at the source level.
    const source = fs.readFileSync(
      path.join(root, "packages/opencode/src/share/session.ts"),
      "utf8",
    )

    // The guard literal still exists.
    expect(source).toMatch(/conf\.share\s*===\s*["']disabled["']\s*\)\s*throw/)

    // Ordering invariant: the throw on disabled config must precede the
    // first call to shareNext.create / shareNext.remove in the file. We
    // verify by locating the indices of both patterns and asserting the
    // throw comes first. Splice out comments first so a "// shareNext.create"
    // reference cannot fool the check.
    const stripped = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    const guardIdx = stripped.search(/conf\.share\s*===\s*["']disabled["']\s*\)\s*throw/)
    const callIdx = stripped.search(/shareNext\.create\s*\(/)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(callIdx)
  })
})
