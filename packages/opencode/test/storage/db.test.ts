import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Database } from "@/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const expected = ["latest", "beta"].includes(InstallationChannel)
      ? path.join(Global.Path.data, "kursor.db")
      : path.join(Global.Path.data, `kursor-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
  })

  // Namespace invariant: the database filename itself must never carry the
  // upstream "opencode" name. This is the file kursor reads/writes session
  // history, projects, auth, etc. — keeping the basename distinct (and
  // distinct from any opencode.db that may also live in Global.Path.data)
  // prevents accidental data collision if a future refactor restores the
  // shared data directory.
  test("database basename is namespaced to kursor, never opencode", () => {
    const basename = path.basename(Database.getChannelPath())
    expect(basename.startsWith("kursor")).toBe(true)
    expect(basename.endsWith(".db")).toBe(true)
    expect(basename).not.toMatch(/opencode/)
  })
})
