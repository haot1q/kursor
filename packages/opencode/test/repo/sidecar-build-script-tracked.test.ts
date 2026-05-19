import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// Regression guard against a real bug we shipped once already.
//
// Background: packages/opencode/.gitignore intentionally ignores
// `script/build-*.ts` so contributors can scratch out per-task build
// scripts without polluting the repo. The same pattern, however,
// silently swallowed `script/build-node.ts` — which is NOT a scratch
// script but the **load-bearing** entry point that compiles the
// Electron sidecar bundle. Both `packages/desktop/scripts/predev.ts`
// (dev) and `packages/desktop/scripts/prebuild.ts` (release) shell out
// to `bun script/build-node.ts`, and `electron.vite.config.ts`
// resolves `virtual:opencode-server` to `../opencode/dist/node/node.js`
// — the file build-node.ts produces.
//
// Result on a fresh clone (e.g. a remote machine pulling from GitHub):
//   $ bun dev:desktop
//   $ bun ./scripts/predev.ts
//   $ cd ../opencode && bun script/build-node.ts
//   error: Module not found "script/build-node.ts"
//
// The fix is twofold:
//   1. Add `!script/build-node.ts` to packages/opencode/.gitignore so
//      git tracks this one file while still ignoring future
//      build-foo.ts scratch siblings.
//   2. Actually commit the file (force the first add, after which
//      the negation handles subsequent edits).
//
// This test locks both halves in place: the file must exist on disk,
// must be tracked by git (so it propagates on `git pull`), and the
// two consumer scripts must still reference it (so the contract
// doesn't drift on the producer side).

const repoRoot = path.resolve(import.meta.dir, "../../../../")
const buildScript = "packages/opencode/script/build-node.ts"
const buildScriptAbs = path.join(repoRoot, buildScript)
const gitignore = path.join(repoRoot, "packages/opencode/.gitignore")
const predev = path.join(repoRoot, "packages/desktop/scripts/predev.ts")
const prebuild = path.join(repoRoot, "packages/desktop/scripts/prebuild.ts")

describe("sidecar build-node script is shipped to clones", () => {
  test("packages/opencode/script/build-node.ts exists on disk", () => {
    expect(fs.existsSync(buildScriptAbs)).toBe(true)
  })

  test("packages/opencode/script/build-node.ts is tracked by git (will be pulled by clones)", () => {
    // `git ls-files --error-unmatch <path>` exits 0 iff path is in the
    // index. We use it because a developer who only adds the file with
    // `git add -f` then forgets to commit would still see a green
    // `existsSync()` above — but a fresh clone would NOT receive it.
    const result = spawnSync("git", ["ls-files", "--error-unmatch", buildScript], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    expect(result.status, `git ls-files stderr: ${result.stderr}`).toBe(0)
  })

  test("gitignore exempts the script via explicit negation", () => {
    // The base pattern `script/build-*.ts` is intentional (contributors
    // routinely scratch out build-foo.ts variants we don't want to
    // track). The exemption MUST stay so git doesn't silently drop a
    // future edit to build-node.ts from a `git add .` run.
    const text = fs.readFileSync(gitignore, "utf8")
    expect(text).toContain("script/build-*.ts")
    expect(text).toContain("!script/build-node.ts")
  })

  test("predev.ts still invokes the script (dev path contract)", () => {
    const text = fs.readFileSync(predev, "utf8")
    expect(text).toContain("bun script/build-node.ts")
  })

  test("prebuild.ts still invokes the script (release path contract)", () => {
    const text = fs.readFileSync(prebuild, "utf8")
    expect(text).toContain("bun script/build-node.ts")
  })

  test("build-node.ts has the externals that desktop dev actually needs", () => {
    // Soft contract: `@lydell/node-pty` MUST stay external — bundling
    // it would inline native bindings that Electron can't load. The
    // packaged Electron app then crashes on terminal spawn with a
    // cryptic NODE_MODULE_VERSION mismatch. Keep this guard alive so
    // someone "simplifying" the externals list trips a test, not a
    // post-release bug.
    const text = fs.readFileSync(buildScriptAbs, "utf8")
    expect(text).toMatch(/external\s*:\s*\[[^\]]*@lydell\/node-pty/)
  })
})
