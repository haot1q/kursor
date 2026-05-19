#!/usr/bin/env bun
/**
 * Installs Windows-only native modules into `packages/desktop/node_modules`
 * so that electron-builder can produce a working .exe from macOS / Linux.
 *
 * Bun (correctly) skips `optionalDependencies` whose `os` / `cpu` does not
 * match the host. For cross-platform installer builds we fetch the tarballs
 * directly from the npm registry and extract them into the local
 * `node_modules` tree under their canonical paths.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DESKTOP_DIR = new URL("..", import.meta.url).pathname

interface WinPkg {
  /** e.g. `@lydell/node-pty-win32-x64` */
  name: string
  version: string
  /** Tarball file name on registry (without the `.tgz` extension). */
  tarballName: string
}

const WIN_PACKAGES: readonly WinPkg[] = [
  { name: "@lydell/node-pty-win32-x64", version: "1.2.0-beta.10", tarballName: "node-pty-win32-x64" },
  { name: "@lydell/node-pty-win32-arm64", version: "1.2.0-beta.10", tarballName: "node-pty-win32-arm64" },
  { name: "@parcel/watcher-win32-x64", version: "2.5.1", tarballName: "watcher-win32-x64" },
  { name: "@parcel/watcher-win32-arm64", version: "2.5.1", tarballName: "watcher-win32-arm64" },
  { name: "@msgpackr-extract/msgpackr-extract-win32-x64", version: "3.0.3", tarballName: "msgpackr-extract-win32-x64" },
]

function run(cmd: string, args: readonly string[], cwd?: string) {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`)
}

async function installPackage(pkg: WinPkg, workDir: string) {
  const dest = join(DESKTOP_DIR, "node_modules", pkg.name)
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest.split("/").slice(0, -1).join("/"), { recursive: true })

  const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.tarballName}-${pkg.version}.tgz`
  const tgz = join(workDir, `${pkg.tarballName}-${pkg.version}.tgz`)
  const extractDir = join(workDir, pkg.tarballName)
  mkdirSync(extractDir, { recursive: true })

  process.stdout.write(`  - fetching ${pkg.name}@${pkg.version}... `)
  run("curl", ["-sSfL", "-o", tgz, url])
  run("tar", ["xzf", tgz, "-C", extractDir])
  run("cp", ["-R", join(extractDir, "package"), dest])
  process.stdout.write("ok\n")
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "kursor-win-natives-"))
  try {
    console.log(`Installing ${WIN_PACKAGES.length} Windows native packages into ${DESKTOP_DIR}/node_modules ...`)
    for (const pkg of WIN_PACKAGES) await installPackage(pkg, tmp)
    console.log("Done.")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

await main()
