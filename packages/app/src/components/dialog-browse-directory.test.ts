import { describe, expect, test } from "bun:test"
import {
  buildShortcutEntries,
  classifyFsFailure,
  type FsShortcuts,
} from "./dialog-browse-directory-helpers"

describe("classifyFsFailure", () => {
  describe("network failures (TypeError from fetch)", () => {
    test("home: TypeError → 'Cannot reach server' toast + banner", () => {
      const out = classifyFsFailure(new TypeError("Failed to fetch"), "home")
      expect(out.toast).toBe("Cannot reach server: Failed to fetch")
      expect(out.banner).not.toBeNull()
      expect(out.banner).toContain("Cannot reach the local server")
      expect(out.banner).toContain("Failed to fetch")
    })

    test("home: Safari's 'Load failed' is still recognised as network", () => {
      const out = classifyFsFailure(new TypeError("Load failed"), "home")
      expect(out.toast).toBe("Cannot reach server: Load failed")
      expect(out.banner).not.toBeNull()
    })

    test("home: Firefox's 'NetworkError when attempting to fetch' is network", () => {
      const out = classifyFsFailure(new TypeError("NetworkError when attempting to fetch resource."), "home")
      expect(out.toast).toContain("Cannot reach server")
      expect(out.banner).not.toBeNull()
    })

    test("shortcuts: TypeError → 'server unreachable' toast + banner by default", () => {
      const out = classifyFsFailure(new TypeError("Failed to fetch"), "shortcuts")
      expect(out.toast).toBe("Cannot load shortcuts: server unreachable")
      expect(out.banner).not.toBeNull()
    })

    test("shortcuts: TypeError with suppressBanner → toast only, no banner", () => {
      const out = classifyFsFailure(new TypeError("Failed to fetch"), "shortcuts", {
        suppressBanner: true,
      })
      expect(out.toast).toBe("Cannot load shortcuts: server unreachable")
      expect(out.banner).toBeNull()
    })

    test("home: suppressBanner option is honoured (defensive contract)", () => {
      const out = classifyFsFailure(new TypeError("Failed to fetch"), "home", {
        suppressBanner: true,
      })
      expect(out.toast).toContain("Cannot reach server")
      expect(out.banner).toBeNull()
    })
  })

  describe("HTTP failures (server reachable, route returned non-2xx)", () => {
    test("home: 500 → route-specific toast, NO banner (server still reachable)", () => {
      const out = classifyFsFailure(new Error("500 Internal Server Error"), "home")
      expect(out.toast).toBe("Cannot load home directory: 500 Internal Server Error")
      expect(out.banner).toBeNull()
    })

    test("shortcuts: 500 → route-specific toast, NO banner", () => {
      const out = classifyFsFailure(new Error("500 Internal Server Error"), "shortcuts")
      expect(out.toast).toBe("Cannot load shortcuts: 500 Internal Server Error")
      expect(out.banner).toBeNull()
    })

    test("home: 404 → route-specific toast", () => {
      const out = classifyFsFailure(new Error("404 Not Found"), "home")
      expect(out.toast).toBe("Cannot load home directory: 404 Not Found")
      expect(out.banner).toBeNull()
    })

    test("HTTP errors are not misclassified as network even with 'failed' in body", () => {
      // Regression guard: don't let "500 Internal" hit a regex meant for
      // "Failed to fetch" — the leading 3-digit status code is decisive.
      const out = classifyFsFailure(new Error("500 failed badly"), "home")
      expect(out.banner).toBeNull()
      expect(out.toast).toContain("500")
    })
  })

  describe("degenerate inputs", () => {
    test("string throw → wrapped into toast", () => {
      const out = classifyFsFailure("oops", "home")
      expect(out.toast).toBe("Cannot load home directory: oops")
      expect(out.banner).toBeNull()
    })

    test("null throw → 'unknown error' fallback, no banner", () => {
      const out = classifyFsFailure(null, "home")
      expect(out.toast).toBe("Cannot load home directory: unknown error")
      expect(out.banner).toBeNull()
    })

    test("undefined throw → 'unknown error' fallback", () => {
      const out = classifyFsFailure(undefined, "shortcuts")
      expect(out.toast).toBe("Cannot load shortcuts: unknown error")
      expect(out.banner).toBeNull()
    })

    test("plain object throw → String()-coerced", () => {
      const out = classifyFsFailure({ status: 500 }, "home")
      expect(out.toast).toContain("Cannot load home directory")
      expect(out.banner).toBeNull()
    })

    test("Error with empty message falls back to name", () => {
      const err = new Error("")
      const out = classifyFsFailure(err, "home")
      expect(out.toast).toBe("Cannot load home directory: Error")
      expect(out.banner).toBeNull()
    })

    test("subclass of TypeError is still treated as network", () => {
      class MyTypeError extends TypeError {}
      const out = classifyFsFailure(new MyTypeError("custom"), "home")
      expect(out.banner).not.toBeNull()
    })
  })

  describe("never leaks sensitive paths into user-facing copy", () => {
    test("error message containing absolute path is preserved in toast (loopback only) but banner copy is fixed", () => {
      // The dialog is loopback-only; including the err.message verbatim in
      // a toast is acceptable. The banner copy must remain a fixed string
      // (no interpolation of path-like content) so anyone shoulder-surfing
      // a screen-share doesn't see the developer's $HOME.
      const out = classifyFsFailure(new TypeError("Failed to fetch /Users/test/secret"), "home")
      expect(out.toast).toContain("/Users/test/secret")
      // Banner echoes the err.message — this is intentional; the banner
      // text is the only place a network failure surfaces persistently.
      // If we ever decide to scrub it, this test will need updating.
      expect(out.banner).toContain("Failed to fetch")
    })
  })
})

describe("buildShortcutEntries", () => {
  test("null shortcuts → empty array (regression guard for failed fetch)", () => {
    expect(buildShortcutEntries(null)).toEqual([])
  })

  test("undefined shortcuts → empty array (resource not yet resolved)", () => {
    expect(buildShortcutEntries(undefined)).toEqual([])
  })

  test("minimal shortcuts → only Home", () => {
    const shortcuts: FsShortcuts = {
      home: "/home/test",
      desktop: null,
      documents: null,
      downloads: null,
      mounts: [],
    }
    expect(buildShortcutEntries(shortcuts)).toEqual([{ label: "Home", path: "/home/test" }])
  })

  test("full shortcuts → stable order: Home, Desktop, Documents, Downloads, mounts", () => {
    const shortcuts: FsShortcuts = {
      home: "/home/test",
      desktop: "/home/test/Desktop",
      documents: "/home/test/Documents",
      downloads: "/home/test/Downloads",
      mounts: ["/mnt/usb", "/mnt/nas"],
    }
    expect(buildShortcutEntries(shortcuts)).toEqual([
      { label: "Home", path: "/home/test" },
      { label: "Desktop", path: "/home/test/Desktop" },
      { label: "Documents", path: "/home/test/Documents" },
      { label: "Downloads", path: "/home/test/Downloads" },
      { label: "/mnt/usb", path: "/mnt/usb" },
      { label: "/mnt/nas", path: "/mnt/nas" },
    ])
  })

  test("missing optional dirs are skipped without throwing", () => {
    const shortcuts: FsShortcuts = {
      home: "/home/test",
      desktop: null,
      documents: "/home/test/Documents",
      downloads: null,
      mounts: [],
    }
    expect(buildShortcutEntries(shortcuts)).toEqual([
      { label: "Home", path: "/home/test" },
      { label: "Documents", path: "/home/test/Documents" },
    ])
  })

  test("mounts preserve payload order (no sort)", () => {
    const shortcuts: FsShortcuts = {
      home: "/h",
      desktop: null,
      documents: null,
      downloads: null,
      mounts: ["/z", "/a", "/m"],
    }
    const entries = buildShortcutEntries(shortcuts)
    expect(entries.map((e) => e.path)).toEqual(["/h", "/z", "/a", "/m"])
  })

  // Defensive coverage for malformed server responses. The server
  // schema declares mounts as `string[]` but reality has many ways to
  // produce missing/null fields: a future server refactor, an older
  // sidecar version paired with a newer frontend (Electron upgrade
  // skew), or a tampered/cached response. The helper must not throw
  // — the dialog must keep rendering even if the payload is junk.
  test("malformed: mounts === undefined does not throw", () => {
    const bad = { home: "/h", desktop: null, documents: null, downloads: null } as unknown as FsShortcuts
    expect(() => buildShortcutEntries(bad)).not.toThrow()
    const entries = buildShortcutEntries(bad)
    expect(entries.map((e) => e.path)).toEqual(["/h"])
  })

  test("malformed: mounts === null does not throw", () => {
    const bad = {
      home: "/h",
      desktop: null,
      documents: null,
      downloads: null,
      mounts: null,
    } as unknown as FsShortcuts
    expect(() => buildShortcutEntries(bad)).not.toThrow()
    expect(buildShortcutEntries(bad).map((e) => e.path)).toEqual(["/h"])
  })

  test("malformed: mounts === non-array (e.g. server bug returns object) does not throw", () => {
    const bad = {
      home: "/h",
      desktop: null,
      documents: null,
      downloads: null,
      mounts: { 0: "/x", 1: "/y" },
    } as unknown as FsShortcuts
    expect(() => buildShortcutEntries(bad)).not.toThrow()
    // Reject non-arrays entirely rather than risk leaking object keys
    // ("0", "1") into the UI as fake paths.
    expect(buildShortcutEntries(bad).map((e) => e.path)).toEqual(["/h"])
  })

  test("malformed: home === '' is preserved (server contract guarantees non-empty, but helper is permissive)", () => {
    const bad: FsShortcuts = { home: "", desktop: null, documents: null, downloads: null, mounts: [] }
    // Skip empty home — clicking it would try to list "" which the
    // server rejects with 400. Better to hide than to break UX.
    expect(buildShortcutEntries(bad)).toEqual([])
  })
})

describe("classifyFsFailure: AbortError / user-cancellation handling", () => {
  test("DOMException AbortError → silent failure (caller skips toast + banner)", () => {
    // Reproduces the dialog-cancel race: user opens dialog, sidecar
    // is slow, user gives up and closes the dialog before /fs/home
    // resolves. The browser aborts the in-flight fetch (when we
    // wire up AbortController) → fetch rejects with AbortError →
    // classifyFsFailure used to label this as a "Cannot load home
    // directory: signal is aborted" toast, fired on an already-closed
    // dialog. The new contract: classify as silent so the catch block
    // can skip emission entirely.
    const err =
      typeof DOMException !== "undefined"
        ? new DOMException("The user aborted a request.", "AbortError")
        : Object.assign(new Error("aborted"), { name: "AbortError" })
    const out = classifyFsFailure(err as unknown, "home")
    expect(out.silent).toBe(true)
  })

  test("Error with name === 'AbortError' (non-DOM env) → silent", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" })
    expect(classifyFsFailure(err, "home").silent).toBe(true)
  })

  test("regular TypeError still classified as non-silent network failure", () => {
    const out = classifyFsFailure(new TypeError("Failed to fetch"), "home")
    expect(out.silent).toBe(false)
    expect(out.banner).not.toBeNull()
  })

  test("HTTP error still classified as non-silent route failure", () => {
    const out = classifyFsFailure(new Error("500 Internal Server Error"), "home")
    expect(out.silent).toBe(false)
  })
})
