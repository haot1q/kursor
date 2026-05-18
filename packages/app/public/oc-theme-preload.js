;(function () {
  // Theme preload runs synchronously on every page load BEFORE any
  // framework code, so it has to be plain JS without imports. The four
  // localStorage keys it touches were renamed from "opencode-*" to
  // "kursor-*" to isolate kursor data from a side-by-side opencode
  // install on the same browser.
  //
  // Migration strategy for existing users: for each kursor-* key, if it
  // is empty but the corresponding opencode-* key has a value, copy the
  // value into the kursor key and remove the opencode key. This runs
  // exactly once per browser (the second launch finds kursor-* already
  // populated and skips the migration entirely).
  //
  // Failure mode: if localStorage.setItem throws (e.g. quota or
  // disabled), we leave the opencode-* value in place so the next
  // launch can try again. This matches the behavior of the larger
  // persist.ts migration helper.
  function migrate(legacyKey, currentKey) {
    try {
      var current = localStorage.getItem(currentKey)
      if (current !== null) return current
      var legacy = localStorage.getItem(legacyKey)
      if (legacy === null) return null
      try {
        localStorage.setItem(currentKey, legacy)
      } catch (e) {
        return legacy
      }
      try {
        localStorage.removeItem(legacyKey)
      } catch (e) {}
      return legacy
    } catch (e) {
      return null
    }
  }

  function dropLegacy(legacyKey) {
    try {
      localStorage.removeItem(legacyKey)
    } catch (e) {}
  }

  var themeKey = "kursor-theme-id"
  var schemeKey = "kursor-color-scheme"
  var lightKey = "kursor-theme-css-light"
  var darkKey = "kursor-theme-css-dark"

  var themeId = migrate("opencode-theme-id", themeKey) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    try {
      localStorage.setItem(themeKey, themeId)
    } catch (e) {}
    // The oc-1 → oc-2 migration invalidates any cached variant CSS, so
    // remove both kursor-* and opencode-* css caches.
    try {
      localStorage.removeItem(lightKey)
    } catch (e) {}
    try {
      localStorage.removeItem(darkKey)
    } catch (e) {}
    dropLegacy("opencode-theme-css-light")
    dropLegacy("opencode-theme-css-dark")
  }

  var scheme = migrate("opencode-color-scheme", schemeKey) || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  if (themeId === "oc-2") return

  var css = migrate(isDark ? "opencode-theme-css-dark" : "opencode-theme-css-light", isDark ? darkKey : lightKey)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
