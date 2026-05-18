import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount (data already under kursor keys)", () => {
    localStorage.setItem("kursor-theme-id", "oc-1")
    localStorage.setItem("kursor-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("kursor-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("kursor-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("kursor-theme-css-light")).toBeNull()
    expect(localStorage.getItem("kursor-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes (kursor keys)", () => {
    localStorage.setItem("kursor-theme-id", "nightowl")
    localStorage.setItem("kursor-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  // Cross-product migration coverage. Existing opencode users who upgrade
  // to kursor have their theme state under "opencode-*" keys; the
  // preload must pick those up on first launch, write them into the
  // kursor namespace, and remove the legacy entries. Subsequent launches
  // see kursor-* already populated and skip the legacy path entirely.

  test("migrates opencode-theme-id into kursor-theme-id on first run", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#abc;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    // Migrated into kursor namespace.
    expect(localStorage.getItem("kursor-theme-id")).toBe("nightowl")
    expect(localStorage.getItem("kursor-theme-css-light")).toBe("--background-base:#abc;")
    // Removed from opencode namespace.
    expect(localStorage.getItem("opencode-theme-id")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    // CSS appears in DOM (preload behavior).
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#abc;")
  })

  test("migrates opencode-color-scheme into kursor-color-scheme", () => {
    localStorage.setItem("opencode-color-scheme", "dark")

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(localStorage.getItem("kursor-color-scheme")).toBe("dark")
    expect(localStorage.getItem("opencode-color-scheme")).toBeNull()
  })

  test("kursor key wins when both kursor and opencode keys are present (downgrade-then-upgrade safety)", () => {
    // A user who hopped between products briefly could have both keys
    // populated. The kursor key reflects the most recent kursor state
    // and must take precedence. Otherwise upgrading would silently
    // overwrite the user's most recent settings with stale opencode
    // data.
    localStorage.setItem("kursor-theme-id", "nord")
    localStorage.setItem("opencode-theme-id", "dracula")

    run()

    expect(document.documentElement.dataset.theme).toBe("nord")
    // kursor key stays as-is (untouched by migration).
    expect(localStorage.getItem("kursor-theme-id")).toBe("nord")
    // opencode key is not touched when current is present (we don't
    // proactively clean up; it stays as dormant data).
    expect(localStorage.getItem("opencode-theme-id")).toBe("dracula")
  })

  test("clean-slate user (no theme keys at all) gets oc-2 default without spurious writes", () => {
    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    // No keys were created — default oc-2 needs no preload state.
    expect(localStorage.getItem("kursor-theme-id")).toBeNull()
    expect(localStorage.getItem("opencode-theme-id")).toBeNull()
  })

  test("clearing oc-1 also removes opencode-* cached css to avoid stale variants", () => {
    // The oc-1 → oc-2 migration must invalidate cached variant CSS in
    // BOTH namespaces; otherwise a legacy opencode-theme-css-* entry
    // could re-appear via the migrate() fallback on the next launch.
    localStorage.setItem("kursor-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(localStorage.getItem("kursor-theme-css-light")).toBeNull()
    expect(localStorage.getItem("kursor-theme-css-dark")).toBeNull()
  })
})
