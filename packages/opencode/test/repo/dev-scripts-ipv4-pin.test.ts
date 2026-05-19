import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Regression guard for the IPv4-pin fix.
//
// Context: macOS resolves `localhost` to ::1 (IPv6) by default in many Bun
// builds, but the sidecar HTTP server in `bun run dev:web:server` binds to
// 127.0.0.1 (IPv4). Browsers (Chrome/Safari) then send the dev-time
// `/fs/home` and `/fs/shortcuts` requests to ::1, get ECONNREFUSED, and the
// directory picker tears down with "TypeError: Failed to fetch".
//
// The fix is twofold and BOTH halves must be present:
//   1. `dev:web:server` keeps its explicit `--hostname 127.0.0.1` so the
//      server binds where the frontend expects it.
//   2. `dev:web:front` exports `VITE_OPENCODE_SERVER_HOST=127.0.0.1` so the
//      Vite dev build resolves the loopback URL via the IPv4 literal,
//      sidestepping the host resolver entirely.
//
// If either half drifts back to "localhost" the dialog breaks on macOS with
// no obvious error in the console. This test locks both halves of the
// contract in place.

const repoRoot = path.resolve(import.meta.dir, "../../../../")
const pkgPath = path.join(repoRoot, "package.json")

interface PackageJson {
  scripts?: Record<string, string>
}

function readScripts(): Record<string, string> {
  const raw = fs.readFileSync(pkgPath, "utf8")
  const pkg = JSON.parse(raw) as PackageJson
  return pkg.scripts ?? {}
}

describe("dev:web scripts pin to IPv4 loopback", () => {
  test("repo root package.json is present", () => {
    expect(fs.existsSync(pkgPath)).toBe(true)
  })

  test("dev:web:server binds to 127.0.0.1 explicitly (not 'localhost', not 0.0.0.0)", () => {
    const scripts = readScripts()
    const cmd = scripts["dev:web:server"]
    expect(cmd, "dev:web:server script must exist").toBeString()
    expect(cmd).toContain("--hostname 127.0.0.1")
    // Catch the easy regression: someone "simplifies" to --hostname localhost
    // (which on macOS will then ALSO bind to ::1 if the resolver returns ::1
    // first — but in practice we want the IPv4 literal to be explicit).
    expect(cmd).not.toMatch(/--hostname\s+localhost\b/)
  })

  test("dev:web:front exports VITE_OPENCODE_SERVER_HOST=127.0.0.1", () => {
    const scripts = readScripts()
    const cmd = scripts["dev:web:front"]
    expect(cmd, "dev:web:front script must exist").toBeString()
    expect(cmd).toContain("VITE_OPENCODE_SERVER_HOST=127.0.0.1")
    // The env var must precede the `bun` invocation (POSIX env-prefix
    // semantics) — guard against accidental reordering.
    const envIdx = cmd.indexOf("VITE_OPENCODE_SERVER_HOST=127.0.0.1")
    const bunIdx = cmd.indexOf("bun")
    expect(envIdx).toBeLessThan(bunIdx)
  })

  test("dev:web concurrently launcher still invokes both halves", () => {
    const scripts = readScripts()
    const cmd = scripts["dev:web"]
    expect(cmd, "dev:web composite script must exist").toBeString()
    expect(cmd).toContain("bun run dev:web:server")
    expect(cmd).toContain("bun run dev:web:front")
  })
})
