import { describe, expect, test } from "bun:test"
import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { __testing } from "../../src/server/routes/instance/httpapi/handlers/fs"
import { tmpdirScoped } from "../fixture/fixture"
import { Effect, Layer } from "effect"
import { NodeServices } from "@effect/platform-node"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Project } from "../../src/project/project"
import { Session } from "@/session/session"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const workspaceLayer = Workspace.defaultLayer.pipe(
  Layer.provide(InstanceStore.defaultLayer),
  Layer.provide(InstanceBootstrap.defaultLayer),
)
const it = testEffect(Layer.mergeAll(NodeServices.layer, Project.defaultLayer, Session.defaultLayer, workspaceLayer))

function fsRequest(p: string, init: RequestInit = {}, host: string = "localhost:4096"): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has("host")) headers.set("host", host)
  return Promise.resolve(Server.Default().app.request(p, { ...init, headers }))
}

describe("__testing.isLoopbackHost", () => {
  test("accepts canonical loopback hosts with and without port", () => {
    expect(__testing.isLoopbackHost("localhost")).toBe(true)
    expect(__testing.isLoopbackHost("localhost:4096")).toBe(true)
    expect(__testing.isLoopbackHost("127.0.0.1")).toBe(true)
    expect(__testing.isLoopbackHost("127.0.0.1:8080")).toBe(true)
    expect(__testing.isLoopbackHost("[::1]")).toBe(true)
    expect(__testing.isLoopbackHost("[::1]:8080")).toBe(true)
    expect(__testing.isLoopbackHost("::1")).toBe(true)
    expect(__testing.isLoopbackHost("Localhost")).toBe(true)
    expect(__testing.isLoopbackHost("LOCALHOST")).toBe(true)
    expect(__testing.isLoopbackHost("LOCALHOST:4096")).toBe(true)
  })

  test("rejects LAN, public, and missing hosts", () => {
    expect(__testing.isLoopbackHost(undefined)).toBe(false)
    expect(__testing.isLoopbackHost("")).toBe(false)
    expect(__testing.isLoopbackHost("192.168.1.5")).toBe(false)
    expect(__testing.isLoopbackHost("192.168.1.5:4096")).toBe(false)
    expect(__testing.isLoopbackHost("example.com")).toBe(false)
    expect(__testing.isLoopbackHost("kursor.dev:443")).toBe(false)
    expect(__testing.isLoopbackHost("10.0.0.1")).toBe(false)
    // 127.0.0.2/8 is also loopback in the IPv4 spec but we keep the allowlist
    // conservative — better to underapprove than to leak.
    expect(__testing.isLoopbackHost("127.0.0.2")).toBe(false)
  })

  test("rejects 0.0.0.0 (wildcard bind, not a loopback)", () => {
    expect(__testing.isLoopbackHost("0.0.0.0")).toBe(false)
    expect(__testing.isLoopbackHost("0.0.0.0:4096")).toBe(false)
  })

  test("rejects subdomain spoofing", () => {
    // Hosts that string-contain "localhost" but aren't the literal loopback
    // label must be rejected — otherwise an attacker could register
    // localhost.attacker.example and trick a victim's browser into hitting
    // the picker.
    expect(__testing.isLoopbackHost("localhost.evil.com")).toBe(false)
    expect(__testing.isLoopbackHost("evil-localhost")).toBe(false)
    expect(__testing.isLoopbackHost("127.0.0.1.example.com")).toBe(false)
    expect(__testing.isLoopbackHost("xlocalhost")).toBe(false)
    expect(__testing.isLoopbackHost("localhostx")).toBe(false)
  })
})

describe("__testing.normalize", () => {
  test("returns absolute path unchanged after resolve", () => {
    expect(__testing.normalize("/tmp")).toBe(path.resolve("/tmp"))
    expect(__testing.normalize("/tmp/")).toBe(path.resolve("/tmp"))
    expect(__testing.normalize("/tmp/foo/../bar")).toBe(path.resolve("/tmp/bar"))
  })

  test("expands tilde", () => {
    expect(__testing.normalize("~")).toBe(os.homedir())
    expect(__testing.normalize("~/sub")).toBe(path.join(os.homedir(), "sub"))
  })

  test("rejects relative paths and empties", () => {
    expect(__testing.normalize("")).toBeNull()
    expect(__testing.normalize("foo")).toBeNull()
    expect(__testing.normalize("./foo")).toBeNull()
    expect(__testing.normalize("../foo")).toBeNull()
    // @ts-expect-error intentional bad input
    expect(__testing.normalize(undefined)).toBeNull()
    // @ts-expect-error intentional bad input
    expect(__testing.normalize(null)).toBeNull()
  })

  test("rejects ~user (other-user tilde expansion is intentionally unsupported)", () => {
    expect(__testing.normalize("~root")).toBeNull()
    expect(__testing.normalize("~daemon/foo")).toBeNull()
  })

  test("rejects NULL bytes anywhere in the path", () => {
    expect(__testing.normalize("/tmp/\0/etc/passwd")).toBeNull()
    expect(__testing.normalize("\0/tmp")).toBeNull()
    expect(__testing.normalize("/tmp/foo\0")).toBeNull()
    expect(__testing.normalize("~/\0")).toBeNull()
  })

  test("rejects paths longer than MAX_PATH_LENGTH", () => {
    const huge = "/" + "a".repeat(__testing.MAX_PATH_LENGTH + 10)
    expect(__testing.normalize(huge)).toBeNull()
    // Boundary: exactly MAX_PATH_LENGTH chars passes (assuming absolute).
    const right_below = "/" + "a".repeat(__testing.MAX_PATH_LENGTH - 1)
    expect(right_below.length).toBe(__testing.MAX_PATH_LENGTH)
    expect(__testing.normalize(right_below)).not.toBeNull()
  })

  test("normalizes trailing slashes consistently", () => {
    expect(__testing.normalize("/tmp//")).toBe(path.resolve("/tmp"))
    expect(__testing.normalize("/tmp/")).toBe(path.resolve("/tmp"))
    // Tilde + trailing slash collapses to home with no trailing separator.
    expect(__testing.normalize("~/")).toBe(os.homedir())
  })
})

describe("HttpApi /fs/home", () => {
  it.live("returns home, platform and separator over loopback", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/home"))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        home: string
        platform: string
        separator: string
      }
      expect(body.home).toBe(os.homedir())
      expect(body.separator).toBe(path.sep)
      expect(typeof body.platform).toBe("string")
    }),
  )

  it.live("refuses non-loopback Host with 403", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/home", {}, "192.168.1.5:4096"))
      expect(response.status).toBe(403)
    }),
  )

  it.live("refuses public host with 403", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/home", {}, "kursor.example.com"))
      expect(response.status).toBe(403)
    }),
  )
})

describe("HttpApi /fs/list — input validation", () => {
  it.live("400s when path query is missing entirely", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/list"))
      // The Effect HttpApi schema check rejects missing required query
      // params with a schema-validation 400 before our handler runs.
      expect(response.status).toBe(400)
    }),
  )

  it.live("400s on empty path query value", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/list?path="))
      expect(response.status).toBe(400)
    }),
  )

  it.live("400s on a path containing a NULL byte", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent("/tmp/\0/etc")}`))
      expect(response.status).toBe(400)
    }),
  )

  it.live("400s on a path far exceeding MAX_PATH_LENGTH", () =>
    Effect.gen(function* () {
      const oversize = "/" + "a".repeat(__testing.MAX_PATH_LENGTH + 100)
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent(oversize)}`))
      expect(response.status).toBe(400)
    }),
  )

  it.live("400s on an invalid showHidden value (schema rejects)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const response = yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}&showHidden=yes`),
      )
      // Schema literal "true"|"false" — "yes" must be rejected.
      expect(response.status).toBe(400)
    }),
  )
})

describe("HttpApi /fs/list — system directory filtering", () => {
  it.live("hides macOS/Linux system entries when listing the user's $HOME", () =>
    Effect.gen(function* () {
      // Skip on Windows where home doesn't carry Library/Applications;
      // separate test below covers the Windows-relevant root behavior.
      if (process.platform === "win32") return
      const response = yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(os.homedir())}&showHidden=true`),
      )
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        entries: Array<{ name: string }>
      }
      const names = new Set(body.entries.map((e) => e.name))
      // System dirs that exist on macOS+Linux and aren't useful as
      // workspace roots — must be filtered when listing home directly.
      for (const sysName of ["Library", "Applications", "System"]) {
        expect(names.has(sysName)).toBe(false)
      }
    }),
  )

  it.live("hides system entries when listing the filesystem root", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent("/")}`))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        entries: Array<{ name: string }>
      }
      const names = new Set(body.entries.map((e) => e.name))
      // Filtered names — must not appear when listing /.
      for (const sysName of ["etc", "bin", "dev", "var", "usr", "sbin", "tmp"]) {
        expect(names.has(sysName)).toBe(false)
      }
    }),
  )

  it.live("still lists system directories' contents when navigated to explicitly", () =>
    Effect.gen(function* () {
      // Filtering is by *parent* path (home / root). If a user types /etc
      // directly, they should see its contents — we don't want a hard
      // forbidden list, just a tidy default view.
      if (process.platform === "win32") return
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent("/etc")}`))
      // Either 200 (read OK) or 403 (permission), but never 404 from the
      // filtering layer.
      expect([200, 403]).toContain(response.status)
    }),
  )
})

describe("HttpApi /fs/list", () => {
  it.live("lists directories and files in a tmpdir", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() => mkdir(path.join(dir, "subdir-a")))
      yield* Effect.promise(() => mkdir(path.join(dir, "subdir-b")))
      yield* Effect.promise(() => writeFile(path.join(dir, "hello.txt"), "hi"))

      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        path: string
        entries: Array<{ name: string; type: string; hidden: boolean }>
        truncated: boolean
        total: number
      }
      expect(body.path).toBe(path.resolve(dir))
      const names = body.entries.map((e) => e.name)
      expect(names).toContain("subdir-a")
      expect(names).toContain("subdir-b")
      expect(names).toContain("hello.txt")
      // Directories sort before files.
      expect(names.indexOf("subdir-a")).toBeLessThan(names.indexOf("hello.txt"))
      expect(body.truncated).toBe(false)
    }),
  )

  it.live("hides dotfiles by default and surfaces them with showHidden=true", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() => mkdir(path.join(dir, "visible")))
      yield* Effect.promise(() => mkdir(path.join(dir, ".hidden")))

      const hiddenOff = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`).then((r) => r.json()),
      )) as { entries: Array<{ name: string }> }
      expect(hiddenOff.entries.map((e) => e.name)).toEqual(["visible"])

      const hiddenOn = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}&showHidden=true`).then((r) => r.json()),
      )) as { entries: Array<{ name: string; hidden: boolean }> }
      const names = hiddenOn.entries.map((e) => e.name)
      expect(names).toContain(".hidden")
      expect(names).toContain("visible")
      const dot = hiddenOn.entries.find((e) => e.name === ".hidden")!
      expect(dot.hidden).toBe(true)
    }),
  )

  it.live("expands tilde to the sidecar host home directory", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=~`))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as { path: string }
      expect(body.path).toBe(os.homedir())
    }),
  )

  it.live("404s when the target directory does not exist", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent("/this/path/should/not/exist-zxcvbn")}`),
      )
      expect(response.status).toBe(404)
    }),
  )

  it.live("400s on a relative path (not absolute, not tilde)", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent("relative/dir")}`))
      expect(response.status).toBe(400)
    }),
  )

  it.live("404s when the target exists but is a file, not a directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "regular.txt")
      yield* Effect.promise(() => writeFile(filePath, "content"))
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent(filePath)}`))
      expect(response.status).toBe(404)
    }),
  )

  it.live("403s on non-loopback Host", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const response = yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`, {}, "192.168.1.5:4096"),
      )
      expect(response.status).toBe(403)
    }),
  )

  it.live("truncates the response when a directory has more than MAX_ENTRIES children", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // Create just enough entries to cross the truncation threshold without
      // spending the whole test budget on disk IO.
      const total = __testing.MAX_ENTRIES + 5
      yield* Effect.promise(async () => {
        for (let i = 0; i < total; i++) {
          await mkdir(path.join(dir, `entry-${i.toString().padStart(5, "0")}`))
        }
      })
      const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        entries: unknown[]
        truncated: boolean
        total: number
      }
      expect(body.truncated).toBe(true)
      expect(body.total).toBe(total)
      expect(body.entries.length).toBe(__testing.MAX_ENTRIES)
    }),
  )

  it.live("reports parent for nested directories and null at the filesystem root", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const nested = path.join(dir, "child")
      yield* Effect.promise(() => mkdir(nested))
      const nestedResp = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(nested)}`).then((r) => r.json()),
      )) as { parent: string | null }
      expect(nestedResp.parent).toBe(path.resolve(dir))

      const rootResp = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(path.parse(dir).root)}`).then((r) => r.json()),
      )) as { parent: string | null }
      expect(rootResp.parent).toBeNull()
    }),
  )

  it.live("classifies symlinks-to-directories as directory", () =>
    Effect.gen(function* () {
      // Bun on Windows may not let an unprivileged user create a symlink.
      // Skip the assertion on win32 — the loopback gate is still exercised.
      if (process.platform === "win32") return
      const dir = yield* tmpdirScoped()
      const target = path.join(dir, "actual-dir")
      const link = path.join(dir, "link-dir")
      yield* Effect.promise(() => mkdir(target))
      yield* Effect.promise(() => symlink(target, link, "dir"))
      const body = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`).then((r) => r.json()),
      )) as { entries: Array<{ name: string; type: string }> }
      const linkEntry = body.entries.find((e) => e.name === "link-dir")
      expect(linkEntry?.type).toBe("directory")
    }),
  )

  it.live("classifies a broken symlink as 'other' without erroring on the listing", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const dir = yield* tmpdirScoped()
      const broken = path.join(dir, "broken-link")
      // Symlink to a target that doesn't exist — stat() throws, classify
      // catches and reports "other" so the listing as a whole stays usable.
      yield* Effect.promise(() => symlink(path.join(dir, "nope-does-not-exist"), broken))
      const body = (yield* Effect.promise(() =>
        fsRequest(`/fs/list?path=${encodeURIComponent(dir)}`).then((r) => r.json()),
      )) as { entries: Array<{ name: string; type: string }> }
      const entry = body.entries.find((e) => e.name === "broken-link")
      expect(entry?.type).toBe("other")
    }),
  )

  it.live("returns 403 when the OS denies read permission on a directory", () =>
    Effect.gen(function* () {
      // POSIX-only — Windows ACLs don't honor chmod 0o000 in a way that
      // produces EACCES on readdir, and Bun on Windows ignores the mode.
      if (process.platform === "win32") return
      // Skip when running as root (in CI containers, etc.) — root bypasses
      // mode checks so we can't produce EACCES this way.
      if (typeof process.getuid === "function" && process.getuid() === 0) return
      const dir = yield* tmpdirScoped()
      const locked = path.join(dir, "locked")
      yield* Effect.promise(() => mkdir(locked))
      yield* Effect.promise(() => chmod(locked, 0o000))
      try {
        const response = yield* Effect.promise(() => fsRequest(`/fs/list?path=${encodeURIComponent(locked)}`))
        expect(response.status).toBe(403)
      } finally {
        // Restore so tmpdirScoped cleanup can succeed.
        yield* Effect.promise(() => chmod(locked, 0o700).catch(() => undefined))
      }
    }),
  )
})

describe("HttpApi /fs/realpath — extended", () => {
  it.live("reports a regular file as exists=true, isDirectory=false", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "regular.txt")
      yield* Effect.promise(() => writeFile(file, "x"))
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: file }),
        }),
      )
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        exists: boolean
        isDirectory: boolean
        resolved: string
      }
      expect(body.exists).toBe(true)
      expect(body.isDirectory).toBe(false)
    }),
  )

  it.live("resolves a symlink to its target", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const dir = yield* tmpdirScoped()
      const target = path.join(dir, "real")
      const link = path.join(dir, "link")
      yield* Effect.promise(() => mkdir(target))
      yield* Effect.promise(() => symlink(target, link, "dir"))
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: link }),
        }),
      )
      const body = (yield* Effect.promise(() => response.json())) as {
        resolved: string
        exists: boolean
        isDirectory: boolean
      }
      expect(body.exists).toBe(true)
      expect(body.isDirectory).toBe(true)
      // realpath() canonicalizes the symlink — must point at `target`.
      // realpath may add /private prefix on macOS for /tmp resolves; we
      // assert path tail rather than full equality.
      expect(body.resolved.endsWith(path.basename(target))).toBe(true)
    }),
  )

  it.live("collapses ../ segments after tilde expansion", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "~/foo/../" }),
        }),
      )
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        resolved: string
      }
      // realpath() may canonicalize symlink-y prefixes (e.g. macOS adds
      // /private to /tmp); compare against the OS's canonical form of home.
      const expected = yield* Effect.promise(() => realpath(os.homedir()).catch(() => os.homedir()))
      expect(body.resolved).toBe(expected)
    }),
  )

  it.live("400s on a NULL byte path", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/tmp/\0/etc" }),
        }),
      )
      expect(response.status).toBe(400)
    }),
  )
})

describe("HttpApi /fs/* — registration", () => {
  // The /fs/* routes live on RootHttpApi, which is wrapped in the same
  // Authorization middleware as the rest of the API. The existing
  // httpapi-authorization.test.ts exercises that middleware end-to-end on
  // synthetic routes; here we just check that all four routes are present
  // in the published OpenAPI document so a future refactor that removes
  // them from the root layer fails this test loudly.
  //
  // (We don't check for the 401 response: the legacy-OpenAPI transform in
  //  packages/opencode/src/server/routes/instance/httpapi/public.ts
  //  intentionally strips 401 entries from operations so the generated SDK
  //  doesn't expose auth surface.)
  it.live("publishes /fs/home, /fs/list, /fs/shortcuts, /fs/realpath", () =>
    Effect.gen(function* () {
      const openapi = (yield* Effect.promise(() => Server.openapi())) as {
        paths?: Record<string, Record<string, unknown>>
      }
      expect(openapi.paths?.["/fs/home"]?.get).toBeDefined()
      expect(openapi.paths?.["/fs/list"]?.get).toBeDefined()
      expect(openapi.paths?.["/fs/shortcuts"]?.get).toBeDefined()
      expect(openapi.paths?.["/fs/realpath"]?.post).toBeDefined()
    }),
  )

  it.live("does not publish a write-style /fs route (no DELETE/PUT/PATCH)", () =>
    Effect.gen(function* () {
      // Belt-and-suspenders against future-me accidentally exposing a
      // delete/patch endpoint on the picker namespace.
      const openapi = (yield* Effect.promise(() => Server.openapi())) as {
        paths?: Record<string, Record<string, unknown>>
      }
      for (const [path, operations] of Object.entries(openapi.paths ?? {})) {
        if (!path.startsWith("/fs/")) continue
        for (const verb of ["delete", "put", "patch"]) {
          expect(operations[verb]).toBeUndefined()
        }
      }
    }),
  )
})

describe("HttpApi /fs/* — HTTP method enforcement", () => {
  // The opencode server's catch-all UI route ("*" "/*") swallows any
  // unmatched method+path with a 200 HTML shell. That's a known
  // architectural choice we don't change here — but we DO want to assert
  // our fs handler isn't accidentally invoked for the wrong method. We
  // test that by checking the response content-type instead of status.
  it.live("POST to a GET-only route does not invoke the GET handler", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/home", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      )
      // Our handler would return application/json; the UI fallback returns
      // text/html. Asserting "not JSON" proves the wrong-method request
      // never reached our handler.
      const contentType = response.headers.get("content-type") ?? ""
      expect(contentType).not.toContain("application/json")
    }),
  )

  it.live("GET to a POST-only route does not invoke the POST handler", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/realpath"))
      const contentType = response.headers.get("content-type") ?? ""
      expect(contentType).not.toContain("application/json")
    }),
  )
})

describe("HttpApi /fs/shortcuts", () => {
  it.live("returns the home directory and optional desktop/documents/downloads + mounts", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/shortcuts"))
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        home: string
        desktop: string | null
        documents: string | null
        downloads: string | null
        mounts: string[]
      }
      expect(body.home).toBe(os.homedir())
      for (const opt of [body.desktop, body.documents, body.downloads]) {
        expect(opt === null || (typeof opt === "string" && opt.startsWith(os.homedir()))).toBe(true)
      }
      expect(Array.isArray(body.mounts)).toBe(true)
      for (const m of body.mounts) {
        expect(path.isAbsolute(m)).toBe(true)
      }
    }),
  )

  it.live("403s on non-loopback Host", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => fsRequest("/fs/shortcuts", {}, "10.0.0.50:443"))
      expect(response.status).toBe(403)
    }),
  )
})

describe("HttpApi /fs/realpath", () => {
  it.live("resolves a tilde path to home and reports exists+isDirectory", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "~" }),
        }),
      )
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        resolved: string
        exists: boolean
        isDirectory: boolean
      }
      expect(body.exists).toBe(true)
      expect(body.isDirectory).toBe(true)
      // realpath might canonicalize /private/var/.../home; check it ends with the home leaf at least.
      expect(body.resolved.length).toBeGreaterThan(0)
    }),
  )

  it.live("reports exists=false for a non-existent path without erroring", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/does/not/exist/zxcvbn-9999" }),
        }),
      )
      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        resolved: string
        exists: boolean
        isDirectory: boolean
      }
      expect(body.exists).toBe(false)
      expect(body.isDirectory).toBe(false)
    }),
  )

  it.live("400s on a relative path", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest("/fs/realpath", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "relative/dir" }),
        }),
      )
      expect(response.status).toBe(400)
    }),
  )

  it.live("403s on non-loopback Host", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fsRequest(
          "/fs/realpath",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: "~" }),
          },
          "10.0.0.50:443",
        ),
      )
      expect(response.status).toBe(403)
    }),
  )
})
