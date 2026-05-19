import { beforeEach, describe, expect, test } from "bun:test"
import { readStoredLocale } from "./language"

// readStoredLocale is the synchronous, module-load-time read used to
// pick a UI language before the full Persist machinery wakes up. It
// must:
//
//   1. Read from the kursor namespace (kursor.global.dat:language) by
//      preference. This is the new home.
//   2. Fall back to the opencode namespace (opencode.global.dat:language)
//      when kursor is empty. Existing opencode users who upgrade keep
//      their language preference on the first frame of the first launch.
//   3. Return undefined for every degenerate case (no localStorage,
//      empty value, malformed JSON, missing locale field, non-string
//      locale, unknown locale). The caller falls back to detectLocale()
//      based on navigator.language and the kursor default.
//
// Privacy implication: without (2) a Chinese opencode user upgrading
// to kursor would see an English UI on the first frame even though
// their language was previously persisted. The desktop and web
// renderers also have IPC-based equivalents (renderer/index.tsx and
// renderer/i18n/index.ts), but those run later in the boot sequence;
// this function is the first-frame guarantee.

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  clear() {
    this.values.clear()
  }
  get length() {
    return this.values.size
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

describe("readStoredLocale: namespace precedence", () => {
  test("returns the kursor locale when only kursor.global.dat is populated", () => {
    storage.setItem("kursor.global.dat:language", JSON.stringify({ locale: "zh" }))
    expect(readStoredLocale()).toBe("zh")
  })

  test("falls back to the opencode legacy key when kursor is absent", () => {
    // Upgrade scenario: existing opencode user, first launch after the
    // rename. The persist layer hasn't yet migrated the value, but the
    // sync first-frame helper must still find it.
    storage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "zh" }))
    expect(readStoredLocale()).toBe("zh")
  })

  test("kursor wins over opencode when both are present (post-migration but pre-cleanup)", () => {
    // Race-style scenario: the persist migration wrote the kursor value
    // but failed to remove the opencode legacy entry (e.g. quota error
    // on removeItem). The next first-frame read must STILL prefer the
    // up-to-date kursor copy.
    storage.setItem("kursor.global.dat:language", JSON.stringify({ locale: "zh" }))
    storage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "ja" }))
    expect(readStoredLocale()).toBe("zh")
  })
})

describe("readStoredLocale: degenerate inputs", () => {
  test("returns undefined when neither namespace has data", () => {
    expect(readStoredLocale()).toBeUndefined()
  })

  test("returns undefined when stored value is malformed JSON", () => {
    // A previous opencode build may have left a corrupted entry. The
    // first-frame reader must NOT throw — boot must continue and fall
    // back to detectLocale(). Same behavior in either namespace.
    storage.setItem("kursor.global.dat:language", "definitely not json {")
    expect(readStoredLocale()).toBeUndefined()
  })

  test("returns undefined when stored value lacks a locale field", () => {
    storage.setItem("kursor.global.dat:language", JSON.stringify({}))
    expect(readStoredLocale()).toBeUndefined()
  })

  test("returns undefined when locale field is a non-string", () => {
    storage.setItem("kursor.global.dat:language", JSON.stringify({ locale: 42 }))
    expect(readStoredLocale()).toBeUndefined()
  })

  test("returns 'en' (normalizeLocale default) for an unknown locale", () => {
    // normalizeLocale clamps unknown strings to "en"; the test pins
    // that contract so callers can rely on the return being a Locale.
    storage.setItem("kursor.global.dat:language", JSON.stringify({ locale: "elvish" }))
    expect(readStoredLocale()).toBe("en")
  })

  test("returns 'en' (normalizeLocale default) when the locale field is an empty string", () => {
    // Empty string IS a string, so it passes the typeof guard, then
    // normalizeLocale clamps the unknown locale to the kursor default
    // "en". Pin the documented behavior — a future "treat empty as
    // missing" change must update this test.
    storage.setItem("kursor.global.dat:language", JSON.stringify({ locale: "" }))
    expect(readStoredLocale()).toBe("en")
  })
})

describe("readStoredLocale: opencode legacy edge cases", () => {
  test("malformed JSON in opencode-* is treated as absent (returns undefined, kursor still wins)", () => {
    storage.setItem("opencode.global.dat:language", "totally borked }")
    expect(readStoredLocale()).toBeUndefined()
  })

  test("the function never throws regardless of storage state", () => {
    // A safety blanket: the synchronous warm path must never explode
    // because it's called at module load time before any error
    // boundary is set up.
    storage.setItem("kursor.global.dat:language", "}{")
    storage.setItem("opencode.global.dat:language", "}{")
    expect(() => readStoredLocale()).not.toThrow()
  })
})
