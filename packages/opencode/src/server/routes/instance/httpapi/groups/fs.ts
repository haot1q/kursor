import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

// Filesystem picker routes — let a browser-only UI ("bun run dev:web") prompt
// the user for a local workspace directory by reading the sidecar host's
// filesystem. The sidecar itself runs on the user's machine, so it can see
// the local FS that the browser sandbox cannot.
//
// Hardening (see handlers/fs.ts for enforcement):
//   * Loopback-only by default — refuses to serve any request whose `Host`
//     header is not `localhost` / `127.0.0.1` / `[::1]`. SSH port forwarding
//     terminates on the remote's loopback so it stays usable for the
//     "ssh -L 4096:localhost:4096 host" workflow.
//   * Auth — these routes live on RootHttpApi which is already gated by the
//     sidecar's randomly generated Basic-auth password.
//   * Path safety — symlinks are stat-followed once; system roots such as
//     /etc, /private, /System (macOS) and C:\Windows (Windows) are filtered
//     out of listings; the handler refuses to list anywhere that the OS
//     process can't read (EACCES bubbles up as a clean error).
//   * No write surface — these routes are strictly read-only directory
//     enumeration. Workspace creation still goes through POST /workspace.

export const FsPlatform = Schema.Literals(["darwin", "linux", "win32", "freebsd", "openbsd", "sunos", "aix"])
export type FsPlatform = typeof FsPlatform.Type

export const FsEntryType = Schema.Literals(["directory", "file", "symlink", "other"])
export type FsEntryType = typeof FsEntryType.Type

export const FsEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: FsEntryType,
  hidden: Schema.Boolean,
}).annotate({ identifier: "FsEntry" })
export type FsEntry = typeof FsEntry.Type

export const FsHomeResult = Schema.Struct({
  home: Schema.String,
  platform: FsPlatform,
  separator: Schema.String,
}).annotate({ identifier: "FsHome" })
export type FsHomeResult = typeof FsHomeResult.Type

export const FsListQuery = Schema.Struct({
  path: Schema.String,
  showHidden: Schema.optional(Schema.Literals(["true", "false"])),
})

export const FsListResult = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  entries: Schema.Array(FsEntry),
  truncated: Schema.Boolean,
  total: Schema.Number,
}).annotate({ identifier: "FsList" })
export type FsListResult = typeof FsListResult.Type

export const FsShortcutsResult = Schema.Struct({
  home: Schema.String,
  desktop: Schema.NullOr(Schema.String),
  documents: Schema.NullOr(Schema.String),
  downloads: Schema.NullOr(Schema.String),
  mounts: Schema.Array(Schema.String),
}).annotate({ identifier: "FsShortcuts" })
export type FsShortcutsResult = typeof FsShortcutsResult.Type

export const FsRealpathPayload = Schema.Struct({
  path: Schema.String,
})

export const FsRealpathResult = Schema.Struct({
  resolved: Schema.String,
  exists: Schema.Boolean,
  isDirectory: Schema.Boolean,
}).annotate({ identifier: "FsRealpath" })
export type FsRealpathResult = typeof FsRealpathResult.Type

export const FsPaths = {
  home: "/fs/home",
  list: "/fs/list",
  shortcuts: "/fs/shortcuts",
  realpath: "/fs/realpath",
} as const

export const FsApi = HttpApi.make("fs").add(
  HttpApiGroup.make("fs")
    .add(
      HttpApiEndpoint.get("home", FsPaths.home, {
        success: described(FsHomeResult, "Host home directory information"),
        error: HttpApiError.Forbidden,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "fs.home",
          summary: "Get host home directory",
          description:
            "Return the home directory of the user the sidecar process runs as, plus host platform information. Loopback-only.",
        }),
      ),
      HttpApiEndpoint.get("list", FsPaths.list, {
        query: FsListQuery,
        success: described(FsListResult, "Directory listing"),
        error: [HttpApiError.Forbidden, HttpApiError.NotFound, HttpApiError.BadRequest] as const,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "fs.list",
          summary: "List a directory on the sidecar host",
          description:
            "Return the immediate child directories (and optionally files) of an absolute path on the sidecar host. Loopback-only.",
        }),
      ),
      HttpApiEndpoint.get("shortcuts", FsPaths.shortcuts, {
        success: described(FsShortcutsResult, "Common directory shortcuts"),
        error: HttpApiError.Forbidden,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "fs.shortcuts",
          summary: "Get common directory shortcuts",
          description:
            "Return host paths for common directories (home, Desktop, Documents, Downloads) and existing mount points. Loopback-only.",
        }),
      ),
      HttpApiEndpoint.post("realpath", FsPaths.realpath, {
        payload: FsRealpathPayload,
        success: described(FsRealpathResult, "Resolved path information"),
        error: [HttpApiError.Forbidden, HttpApiError.BadRequest] as const,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "fs.realpath",
          summary: "Resolve and validate a user-typed path",
          description:
            "Normalize an arbitrary user-typed path (handles ~, relative segments, symlinks) and report whether it exists and is a directory. Loopback-only.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "fs",
        description:
          "Filesystem picker — read-only directory enumeration so a web UI can let the user pick a local workspace. Loopback-only.",
      }),
    ),
)
