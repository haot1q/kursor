#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json" with { type: "json" }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

// Detect Linux libc at build time. `src/file/watcher.ts` resolves
// `@parcel/watcher-linux-${arch}-${OPENCODE_LIBC || "glibc"}` at
// runtime; if OPENCODE_LIBC isn't injected here the bundle ships
// the raw identifier, which crashes the Electron sidecar on Linux
// the first time anything touches the file watcher
// (ReferenceError: OPENCODE_LIBC is not defined).
//
// We probe for the musl dynamic loader paths instead of shelling
// out to `ldd --version`, both because $PATH may be locked down
// in CI/containers and because the dynamic-loader path is what
// @parcel/watcher itself ends up resolving against anyway.
//
// On non-Linux platforms the ternary in watcher.ts short-circuits
// before referencing OPENCODE_LIBC, but Bun.build's define still
// needs a value so the identifier never appears bare in the
// emitted bundle — we use "" there.
const linuxLibc = await (async () => {
  if (process.platform !== "linux") return ""
  try {
    const muslLoaders = [
      "/lib/ld-musl-aarch64.so.1",
      "/lib/ld-musl-x86_64.so.1",
      "/lib/ld-musl-armhf.so.1",
    ]
    return muslLoaders.some((p) => fs.existsSync(p)) ? "musl" : "glibc"
  } catch {
    return "glibc"
  }
})()

await import("./generate.ts")

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENCODE_MIGRATIONS: JSON.stringify(migrations),
    OPENCODE_CHANNEL: JSON.stringify(Script.channel),
    OPENCODE_VERSION: JSON.stringify(pkg.version),
    OPENCODE_LIBC: JSON.stringify(linuxLibc),
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
