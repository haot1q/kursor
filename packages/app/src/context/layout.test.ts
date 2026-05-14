import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionKeyReader, ensureSessionKey, migrateLayoutValue, pruneSessionKeys } from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

describe("migrateLayoutValue - non-object passthrough", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["string", "hello"],
    ["array", [1, 2, 3]],
    ["boolean", true],
  ])("returns %s unchanged", (_label, input) => {
    expect(migrateLayoutValue(input)).toBe(input)
  })

  test("returns same reference when input is empty object with no migratable fields", () => {
    const input = {}
    expect(migrateLayoutValue(input)).toBe(input)
  })

  test("returns same reference when sidebar is not a record", () => {
    const input = { sidebar: "not-a-record" }
    expect(migrateLayoutValue(input)).toBe(input)
  })
})

describe("migrateLayoutValue - sidebar (kursor: force-open once)", () => {
  test("legacy boolean workspaces gets normalized AND force-opened on first run", () => {
    const input = { sidebar: { opened: false, width: 344, workspaces: true } }
    const out = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }

    expect(out.sidebar.opened).toBe(true)
    expect(out.sidebar.workspaces).toEqual({})
    expect(out.sidebar.workspacesDefault).toBe(true)
    expect(out.sidebar.kursorForceOpen).toBe(true)
    expect(out.sidebar.width).toBe(344)
  })

  test("already-object workspaces gets force-opened on first run", () => {
    const input = {
      sidebar: { opened: false, width: 400, workspaces: { dirA: true }, workspacesDefault: false },
    }
    const out = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }

    expect(out.sidebar.opened).toBe(true)
    expect(out.sidebar.kursorForceOpen).toBe(true)
    expect(out.sidebar.workspaces).toEqual({ dirA: true })
    expect(out.sidebar.workspacesDefault).toBe(false)
    expect(out.sidebar.width).toBe(400)
  })

  test("already-migrated sidebar with opened=false respects user's closed state", () => {
    const input = {
      sidebar: {
        opened: false,
        width: 344,
        workspaces: {},
        workspacesDefault: false,
        kursorForceOpen: true,
      },
    }
    const out = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }

    expect(out.sidebar.opened).toBe(false)
    expect(out.sidebar.kursorForceOpen).toBe(true)
  })

  test("already-migrated sidebar with opened=true preserves open state", () => {
    const input = {
      sidebar: {
        opened: true,
        width: 344,
        workspaces: {},
        workspacesDefault: false,
        kursorForceOpen: true,
      },
    }
    const out = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }

    expect(out.sidebar.opened).toBe(true)
  })

  test("idempotent: migrate(migrate(x)) == migrate(x) (sidebar stable after first run)", () => {
    const input = { sidebar: { opened: false, width: 344, workspaces: true } }
    const first = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }
    const second = migrateLayoutValue(first) as { sidebar: Record<string, unknown> }

    expect(second.sidebar.opened).toBe(first.sidebar.opened)
    expect(second.sidebar.kursorForceOpen).toBe(true)
    expect(second.sidebar.workspaces).toEqual(first.sidebar.workspaces)
    expect(second.sidebar.workspacesDefault).toBe(first.sidebar.workspacesDefault)
  })

  test("kursorForceOpen=false explicit flag still triggers force-open (only ===true short-circuits)", () => {
    const input = {
      sidebar: { opened: false, workspaces: {}, kursorForceOpen: false },
    }
    const out = migrateLayoutValue(input) as { sidebar: Record<string, unknown> }
    expect(out.sidebar.opened).toBe(true)
    expect(out.sidebar.kursorForceOpen).toBe(true)
  })
})

describe("migrateLayoutValue - fileTree (existing kursor: force-open once)", () => {
  test("first run with tab='changes' coerces to opened=true tab='all'", () => {
    const input = { fileTree: { opened: false, width: 200, tab: "changes" } }
    const out = migrateLayoutValue(input) as { fileTree: Record<string, unknown> }

    expect(out.fileTree.opened).toBe(true)
    expect(out.fileTree.tab).toBe("all")
    expect(out.fileTree.kursorForceOpen).toBe(true)
    expect(out.fileTree.width).toBe(200)
  })

  test("first run with legacy width=260 resets to default", () => {
    const input = { fileTree: { opened: true, width: 260, tab: "all" } }
    const out = migrateLayoutValue(input) as { fileTree: Record<string, unknown> }

    expect(out.fileTree.width).toBe(200)
    expect(out.fileTree.kursorForceOpen).toBe(true)
  })

  test("post-migration with tab='changes' respects user's choice", () => {
    const input = {
      fileTree: { opened: false, width: 200, tab: "changes", kursorForceOpen: true },
    }
    const out = migrateLayoutValue(input) as { fileTree: Record<string, unknown> }

    expect(out.fileTree.opened).toBe(false)
    expect(out.fileTree.tab).toBe("changes")
    expect(out.fileTree.kursorForceOpen).toBe(true)
  })

  test("post-migration with invalid tab gets coerced to 'all'", () => {
    const input = {
      fileTree: { opened: false, width: 200, tab: "garbage", kursorForceOpen: true },
    }
    const out = migrateLayoutValue(input) as { fileTree: Record<string, unknown> }

    expect(out.fileTree.opened).toBe(true)
    expect(out.fileTree.tab).toBe("all")
  })
})

describe("migrateLayoutValue - review (legacy panelOpened backfill)", () => {
  test("missing panelOpened backfills from fileTree.opened=true", () => {
    const input = {
      review: { diffStyle: "split" },
      fileTree: { opened: true, width: 200, tab: "all" },
    }
    const out = migrateLayoutValue(input) as { review: Record<string, unknown> }
    expect(out.review.panelOpened).toBe(true)
  })

  test("missing panelOpened defaults to true when no fileTree.opened", () => {
    const input = { review: { diffStyle: "split" } }
    const out = migrateLayoutValue(input) as { review: Record<string, unknown> }
    expect(out.review.panelOpened).toBe(true)
  })

  test("existing panelOpened is respected", () => {
    const input = {
      review: { diffStyle: "split", panelOpened: false },
      fileTree: { opened: true, width: 200, tab: "all" },
    }
    const out = migrateLayoutValue(input) as { review: Record<string, unknown> }
    expect(out.review.panelOpened).toBe(false)
  })
})

describe("migrateLayoutValue - composition", () => {
  test("simultaneously migrates sidebar + fileTree + review", () => {
    const input = {
      sidebar: { opened: false, width: 344, workspaces: true },
      fileTree: { opened: false, width: 260, tab: "changes" },
      review: { diffStyle: "split" },
      handoff: { tabs: undefined },
    }
    const out = migrateLayoutValue(input) as {
      sidebar: Record<string, unknown>
      fileTree: Record<string, unknown>
      review: Record<string, unknown>
      handoff: unknown
    }

    expect(out.sidebar.opened).toBe(true)
    expect(out.sidebar.workspaces).toEqual({})
    expect(out.sidebar.workspacesDefault).toBe(true)
    expect(out.sidebar.kursorForceOpen).toBe(true)

    expect(out.fileTree.opened).toBe(true)
    expect(out.fileTree.tab).toBe("all")
    expect(out.fileTree.width).toBe(200)
    expect(out.fileTree.kursorForceOpen).toBe(true)

    expect(out.review.panelOpened).toBe(false)

    expect(out.handoff).toEqual({ tabs: undefined })
  })

  test("returns identical reference when nothing needs migrating", () => {
    const input = {
      sidebar: {
        opened: false,
        width: 344,
        workspaces: {},
        workspacesDefault: false,
        kursorForceOpen: true,
      },
      fileTree: { opened: true, width: 200, tab: "all", kursorForceOpen: true },
      review: { diffStyle: "split", panelOpened: true },
      sessionTabs: {},
    }
    const out = migrateLayoutValue(input)
    expect(out).toBe(input)
  })
})
