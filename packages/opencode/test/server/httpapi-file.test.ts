import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { Instance } from "../../src/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

// Upstream-derived test. The `serves search endpoints` case below depends
// on a ripgrep streaming code path in @/file/ripgrep that intermittently
// hangs on Bun + macOS in this repository's test environment, even when
// the `rg` binary itself is present and works correctly when invoked
// manually (verified). The hang reproduces in full isolation outside our
// File/Instance machinery, so it is not a regression from any kursor
// patch — it is a pre-existing upstream interaction between Stream.callback
// + forkScoped + Bun's subprocess handling that we have not been able to
// fix without an invasive rewrite of rg.files() (see ripgrep.ts:346).
//
// CI environments (Linux + system rg in PATH) do not exhibit this hang,
// so the test runs there by default. Locally, devs hitting the hang can
// set KURSOR_SKIP_FLAKY_RG_TESTS=1 to skip without polluting CI output.
const skipFlakyRg = process.env.KURSOR_SKIP_FLAKY_RG_TESTS === "1"

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test.skipIf(skipFlakyRg)("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})
