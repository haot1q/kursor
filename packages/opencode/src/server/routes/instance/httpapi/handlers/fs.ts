import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Log from "@opencode-ai/core/util/log"
import { RootHttpApi } from "../api"
import type { FsEntry, FsEntryType, FsPlatform } from "../groups/fs"

const log = Log.create({ service: "server.fs" })

// Cap how many entries we return per directory. Browsing a 200K-file dir
// shouldn't OOM the browser; the UI shows a "truncated" hint when we cap.
const MAX_ENTRIES = 1000

// Defense-in-depth — most operating systems cap PATH_MAX between 1024 and
// 4096 bytes, anything bigger is almost certainly an attack or a bug. We
// reject early in normalize() so the kernel never sees these and so a
// hostile request can't make path.resolve allocate megabytes.
const MAX_PATH_LENGTH = 4096

// Hosts allowed through the loopback gate. Effect's HttpServerRequest exposes
// the URL only, not the underlying socket peer, so we authenticate on the
// `Host` header which a browser populates from `location.host`. SSH port
// forwarding terminates on the remote's loopback, so the browser still sees
// `localhost:NNNN` and the header still matches.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

// Directories we hide from listings (not from explicit navigation — the user
// can still type the path) because they're never sensible workspace roots and
// they clutter $HOME / / listings on macOS / Windows / Linux.
const SYSTEM_DIR_NAMES = new Set([
  // macOS
  "Library",
  "Applications",
  "System",
  "Volumes",
  "private",
  "cores",
  "dev",
  "etc",
  "var",
  "tmp",
  "bin",
  "sbin",
  "usr",
  "opt",
  // Linux roots that share names with the above already covered
  "proc",
  "sys",
  "run",
  "boot",
  "lost+found",
  // Windows
  "$Recycle.Bin",
  "System Volume Information",
  "Recovery",
  "Config.Msi",
  "Windows",
  "ProgramData",
  "Program Files",
  "Program Files (x86)",
])

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  // Browsers normalize Host to "<host>[:<port>]". IPv6 must be bracketed when
  // it carries a port ("[::1]:8080"); a bare "::1" is technically not a valid
  // Host header but some clients send it, so we accept it as a literal match
  // without trying to split on ":".
  const trimmed = hostHeader.trim()
  if (trimmed.includes("::")) {
    // IPv6: accept bracketed forms with optional port, plus bare "::1".
    if (trimmed === "::1") return true
    const m = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed)
    if (m && m[1]) return LOOPBACK_HOSTS.has(m[1].toLowerCase())
    return false
  }
  const colon = trimmed.indexOf(":")
  const host = colon >= 0 ? trimmed.slice(0, colon) : trimmed
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

function expandTilde(input: string): string {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

// path.resolve() relative to cwd would silently work on relative paths, which
// is surprising from a UX standpoint ("I typed `foo` and got `/some/cwd/foo`").
// We require absolute paths after tilde expansion and reject the rest.
function normalize(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null
  if (input.length > MAX_PATH_LENGTH) return null
  // Most filesystems treat \0 as a string terminator; passing one through
  // would silently truncate the path for the kernel call. Bun's Node-compat
  // fs APIs reject \0 too — we reject earlier with a clearer 400 response.
  if (input.indexOf("\0") !== -1) return null
  const expanded = expandTilde(input)
  if (!path.isAbsolute(expanded)) return null
  // path.resolve collapses `..` and trailing slashes deterministically.
  return path.resolve(expanded)
}

function isHidden(name: string): boolean {
  return name.startsWith(".")
}

function classify(direntType: number, name: string, parent: string): FsEntryType {
  // Use posix-friendly numeric constants from fs.Dirent — we get a Dirent from
  // readdir({ withFileTypes: true }) so checks are sync and don't follow links.
  // dirent.isDirectory() etc. would be cleaner; we pass the raw bits to keep
  // the function pure for unit testing without a Dirent instance.
  // 1 = file, 2 = directory, 3 = symlink (Node internal mapping).
  if (direntType === 2) return "directory"
  if (direntType === 1) return "file"
  if (direntType === 3) {
    try {
      const resolved = path.join(parent, name)
      // statSync is fine here — listings are typically small, and async stat
      // per entry across thousands of files dominates wall time worse.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const st = require("node:fs").statSync(resolved)
      if (st.isDirectory()) return "directory"
      if (st.isFile()) return "file"
    } catch {
      // Broken symlink — treat as "other" so we surface the entry but don't
      // pretend it's a directory.
      return "other"
    }
  }
  return "other"
}

async function listDirectory(
  absPath: string,
  showHidden: boolean,
): Promise<{ entries: FsEntry[]; truncated: boolean; total: number }> {
  const dirents = await fs.readdir(absPath, { withFileTypes: true })
  const all: FsEntry[] = []
  for (const dirent of dirents) {
    const hidden = isHidden(dirent.name)
    if (hidden && !showHidden) continue
    // Filter out well-known system directories from $HOME / / listings, but
    // only by *name* — if the user explicitly navigates into them via the
    // path input, we still serve. This keeps the picker tidy without making
    // the API itself a forbidden list.
    if (SYSTEM_DIR_NAMES.has(dirent.name) && (absPath === path.parse(absPath).root || absPath === os.homedir())) {
      continue
    }
    // @ts-expect-error Node's Dirent exposes a numeric `_type` on Bun but we
    // use the public boolean methods; cast is to satisfy classify's signature.
    const direntType = dirent.isDirectory() ? 2 : dirent.isFile() ? 1 : dirent.isSymbolicLink() ? 3 : 0
    all.push({
      name: dirent.name,
      path: path.join(absPath, dirent.name),
      type: classify(direntType, dirent.name, absPath),
      hidden,
    })
  }
  all.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
  const truncated = all.length > MAX_ENTRIES
  return { entries: truncated ? all.slice(0, MAX_ENTRIES) : all, truncated, total: all.length }
}

function platform(): FsPlatform {
  const p = process.platform
  if (
    p === "darwin" ||
    p === "linux" ||
    p === "win32" ||
    p === "freebsd" ||
    p === "openbsd" ||
    p === "sunos" ||
    p === "aix"
  ) {
    return p
  }
  // Fall back to linux for any unrecognized POSIX-ish platform — the schema
  // requires one of the enumerated values and "linux" is the closest match.
  return "linux"
}

function commonMounts(): string[] {
  const candidates: string[] =
    process.platform === "darwin" ? ["/Volumes"] : process.platform === "win32" ? [] : ["/mnt", "/media"]
  const out: string[] = []
  for (const c of candidates) {
    try {
      if (existsSync(c)) out.push(c)
    } catch {
      // ignore
    }
  }
  return out
}

function specialDir(name: "Desktop" | "Documents" | "Downloads"): string | null {
  const candidate = path.join(os.homedir(), name)
  try {
    return existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

function forbidden(reason: string) {
  log.info("fs route refused", { reason })
  return new HttpApiError.Forbidden({})
}

function requireLoopback(): Effect.Effect<void, HttpApiError.Forbidden, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const host = request.headers["host"] ?? request.headers["Host"]
    if (!isLoopbackHost(host)) {
      return yield* Effect.fail(forbidden(`non-loopback host: ${host ?? "<none>"}`))
    }
  })
}

export const fsHandlers = HttpApiBuilder.group(RootHttpApi, "fs", (handlers) =>
  Effect.gen(function* () {
    const home = Effect.fn("FsHttpApi.home")(function* () {
      yield* requireLoopback()
      return {
        home: os.homedir(),
        platform: platform(),
        separator: path.sep,
      }
    })

    const list = Effect.fn("FsHttpApi.list")(function* (ctx: {
      query: { path: string; showHidden?: "true" | "false" }
    }) {
      yield* requireLoopback()
      const target = normalize(ctx.query.path)
      if (target === null) {
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      const showHidden = ctx.query.showHidden === "true"

      const stat = yield* Effect.tryPromise({
        try: () => fs.stat(target),
        catch: () => new HttpApiError.NotFound({}),
      })
      if (!stat.isDirectory()) {
        return yield* Effect.fail(new HttpApiError.NotFound({}))
      }

      const result = yield* Effect.tryPromise({
        try: () => listDirectory(target, showHidden),
        // EACCES, permission denied — surface as Forbidden so the UI can show
        // "you don't have permission to read this folder" without crashing.
        catch: (err) => {
          const code = (err as { code?: string }).code
          if (code === "EACCES" || code === "EPERM") return forbidden(`read denied: ${target}`)
          log.warn("fs.list failed", { target, err })
          return new HttpApiError.BadRequest({})
        },
      })

      const parent = path.dirname(target)
      return {
        path: target,
        parent: parent === target ? null : parent,
        entries: result.entries,
        truncated: result.truncated,
        total: result.total,
      }
    })

    const shortcuts = Effect.fn("FsHttpApi.shortcuts")(function* () {
      yield* requireLoopback()
      return {
        home: os.homedir(),
        desktop: specialDir("Desktop"),
        documents: specialDir("Documents"),
        downloads: specialDir("Downloads"),
        mounts: commonMounts(),
      }
    })

    const realpath = Effect.fn("FsHttpApi.realpath")(function* (ctx: { payload: { path: string } }) {
      yield* requireLoopback()
      const target = normalize(ctx.payload.path)
      if (target === null) {
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      // realpath() follows symlinks; fall back to the lexical normalize result
      // if the path doesn't exist so the UI can still show "doesn't exist".
      const resolved = yield* Effect.promise(() => fs.realpath(target).catch(() => target))
      const stat = yield* Effect.promise(() =>
        fs.stat(resolved).then(
          (s) => ({ exists: true, isDirectory: s.isDirectory() }),
          () => ({ exists: false, isDirectory: false }),
        ),
      )
      return { resolved, exists: stat.exists, isDirectory: stat.isDirectory }
    })

    return handlers.handle("home", home).handle("list", list).handle("shortcuts", shortcuts).handle("realpath", realpath)
  }),
)

// Exported for unit testing without spinning the server.
export const __testing = {
  isLoopbackHost,
  normalize,
  expandTilde,
  isHidden,
  SYSTEM_DIR_NAMES,
  MAX_ENTRIES,
  MAX_PATH_LENGTH,
}
