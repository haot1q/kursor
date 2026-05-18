import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "kursor"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  // Privacy / isolation invariant: kursor must NOT share the on-disk
  // namespace with upstream opencode. A machine with both products
  // installed should keep their session history, project database, auth
  // tokens, and any other state strictly separate. Anyone who later
  // edits global.ts must update this test deliberately.
  describe("namespace isolation from opencode", () => {
    const dirs = [
      ["data", Global.Path.data],
      ["cache", Global.Path.cache],
      ["config", Global.Path.config],
      ["state", Global.Path.state],
      ["tmp", Global.Path.tmp],
      ["log", Global.Path.log],
      ["bin", Global.Path.bin],
      ["repos", Global.Path.repos],
    ] as const

    for (const [label, dir] of dirs) {
      test(`${label} path ends with a /kursor segment`, () => {
        const segments = dir.split(path.sep)
        expect(segments).toContain("kursor")
      })

      test(`${label} path never resolves under a /opencode XDG dir`, () => {
        // Allow the literal substring "opencode" elsewhere (e.g. nested
        // /tmp/opencode-foo test fixtures) but never as the namespace segment
        // that XDG appends — that segment is the one that collides on disk.
        const segments = dir.split(path.sep)
        expect(segments).not.toContain("opencode")
      })
    }
  })
})
