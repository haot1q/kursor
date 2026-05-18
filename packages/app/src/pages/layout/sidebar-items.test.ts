import { describe, expect, test } from "bun:test"
// Imported from the extracted module rather than ./sidebar-items so that
// this unit test does not pull in the full Solid + Kobalte UI dependency
// tree (which fails to load in the test environment because it expects a
// browser/runtime). The function is re-exported from ./sidebar-items for
// backwards compatibility, and ./avatar-source has no UI imports.
import { getProjectAvatarSource } from "./avatar-source"

// Privacy invariant for getProjectAvatarSource.
//
// Before this change, the function hard-recognized the upstream opencode
// repository by its first-commit SHA ("4b0ea68d7af9a6031a7ffda7ad66e0cb83
// 315750") and substituted "https://opencode.ai/favicon.svg" as the
// project avatar. That branch (a) phoned home to opencode.ai every time
// the upstream repo happened to be opened in kursor (the <img src=...>
// causes a real HTTP GET), and (b) misbranded an unrelated third-party
// project with another product's logo.
//
// These tests assert the new behavior:
//   - the legacy hash no longer triggers a special case;
//   - no input shape ever causes the function to return a URL pointing at
//     opencode.ai (so a future caller cannot trip over a forgotten hard-
//     coded URL inside the helper).
describe("getProjectAvatarSource — phone-home regression coverage", () => {
  const UPSTREAM_OPENCODE_FIRST_COMMIT = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

  test("the legacy upstream opencode project id no longer gets a special avatar URL", () => {
    expect(getProjectAvatarSource(UPSTREAM_OPENCODE_FIRST_COMMIT)).toBeUndefined()
  })

  test("the legacy id never returns a remote opencode.ai URL, even with icon hints", () => {
    // Without an icon, falls through to undefined.
    expect(getProjectAvatarSource(UPSTREAM_OPENCODE_FIRST_COMMIT, undefined)).toBeUndefined()

    // With a color-only icon (no URL), returns undefined (color branch).
    const colorOnly = getProjectAvatarSource(UPSTREAM_OPENCODE_FIRST_COMMIT, { color: "#ff0000" })
    expect(colorOnly).toBeUndefined()

    // With a user-provided URL, returns that URL — NOT opencode.ai.
    const withUrl = getProjectAvatarSource(UPSTREAM_OPENCODE_FIRST_COMMIT, { url: "https://example.com/logo.png" })
    expect(withUrl).toBe("https://example.com/logo.png")
    expect(withUrl).not.toContain("opencode.ai")

    // Override takes precedence over everything.
    const withOverride = getProjectAvatarSource(UPSTREAM_OPENCODE_FIRST_COMMIT, {
      override: "https://example.com/override.png",
      url: "https://example.com/fallback.png",
    })
    expect(withOverride).toBe("https://example.com/override.png")
    expect(withOverride).not.toContain("opencode.ai")
  })

  test("normal project ids respect override > color > url precedence", () => {
    expect(getProjectAvatarSource("any-other-id")).toBeUndefined()
    expect(getProjectAvatarSource("any-other-id", { url: "x" })).toBe("x")
    expect(getProjectAvatarSource("any-other-id", { color: "#fff" })).toBeUndefined()
    expect(getProjectAvatarSource("any-other-id", { override: "o", url: "x", color: "#fff" })).toBe("o")
  })

  test("invariant: no input shape causes the function to return an opencode.ai URL", () => {
    // Pin the behavior with the riskiest input combinations — the legacy
    // hash mixed with anything else. None of them should ever surface a
    // URL containing "opencode.ai" or "opncd.ai".
    const inputs: Array<[string | undefined, { color?: string; url?: string; override?: string } | undefined]> = [
      [UPSTREAM_OPENCODE_FIRST_COMMIT, undefined],
      [UPSTREAM_OPENCODE_FIRST_COMMIT, {}],
      [UPSTREAM_OPENCODE_FIRST_COMMIT, { color: "#000" }],
      [UPSTREAM_OPENCODE_FIRST_COMMIT, { url: "" }],
      [UPSTREAM_OPENCODE_FIRST_COMMIT, { url: "https://my-cdn.example/favicon.svg" }],
      [UPSTREAM_OPENCODE_FIRST_COMMIT, { override: "https://my-cdn.example/icon.png" }],
      [undefined, undefined],
      ["", { url: "https://my-cdn.example/x.png" }],
    ]
    for (const [id, icon] of inputs) {
      const result = getProjectAvatarSource(id, icon)
      if (result === undefined) continue
      expect(result).not.toContain("opencode.ai")
      expect(result).not.toContain("opncd.ai")
    }
  })
})
