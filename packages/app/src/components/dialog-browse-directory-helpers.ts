// Pure helpers extracted from dialog-browse-directory.tsx so the
// error-handling and derivation logic can be unit tested without a
// full Solid + DOM harness. The component re-exports nothing from
// here; it imports the helpers and applies them inside its reactive
// scope. Keep this file dependency-free (no Solid, no UI) so the
// tests can run as plain bun tests.

export interface FsShortcuts {
  home: string
  desktop: string | null
  documents: string | null
  downloads: string | null
  mounts: string[]
}

export interface FsFailure {
  /** Short, user-visible toast title. Never includes raw stack-y text. */
  toast: string
  /**
   * Inline-banner text. Null means "don't show the banner" — the toast is
   * enough. Set to non-null when the failure is severe enough that the
   * shortcut list / quick navigation is unavailable and the user needs a
   * persistent hint inside the dialog (not just a transient toast).
   */
  banner: string | null
  /**
   * True if the failure represents a user-initiated cancellation (e.g.
   * the dialog was closed mid-fetch and the browser aborted the in-flight
   * request, surfacing a DOMException("AbortError")). Callers must skip
   * both toast and banner emission for these — popping a "Cannot load
   * home directory" toast on an already-closed dialog is jarring and
   * looks like a real failure to the user.
   */
  silent: boolean
}

/**
 * Classify a thrown error from one of the /fs/* fetcher calls into a stable
 * user-visible label. The `kind` distinguishes which fetcher failed so we
 * don't say "Cannot reach server" when the server is reachable but a
 * single route returned 500.
 *
 * Inputs:
 *   - err: anything thrown — typically Error from fetch() (TypeError on
 *     network failure) or Error("<status> <statusText>") from the apiGet
 *     helper's !res.ok branch.
 *   - kind: "home" → /fs/home, the most critical fetcher (its result seeds
 *     the dialog's initial path); failure here means the picker is
 *     effectively unusable beyond manual typed paths.
 *           "shortcuts" → /fs/shortcuts, the shortcut bar; failure here is
 *     less severe — the rest of the picker still works.
 *
 * Outputs (FsFailure):
 *   - toast: short title for showToast()
 *   - banner: persistent in-dialog message, or null
 *
 * Design choices pinned by tests below:
 *   1. A TypeError (network/CORS/DNS) is treated as "server unreachable"
 *      regardless of kind, because if /fs/home failed with a network
 *      error /fs/shortcuts will almost certainly fail the same way; the
 *      banner therefore mentions the server rather than the specific
 *      route.
 *   2. A non-network failure (e.g. HTTP 500) is treated as a per-route
 *      problem — the toast names the route, no banner, because other
 *      parts of the dialog can still work.
 *   3. The banner is suppressed for "shortcuts" failures even on network
 *      errors when "home" already raised one — the caller is expected to
 *      pass `suppressBanner: true` in that case. This keeps the dialog
 *      from showing two stacked banners about the same root cause.
 */
export function classifyFsFailure(
  err: unknown,
  kind: "home" | "shortcuts",
  options: { suppressBanner?: boolean } = {},
): FsFailure {
  const message = errorMessage(err)

  // User-cancellation path. Must be checked BEFORE the TypeError-as-
  // network heuristic because some fetch polyfills wrap aborts in
  // TypeError. Returning silent: true tells the caller not to emit
  // anything — the user closed the dialog, they don't need a toast
  // about it.
  if (isAbortError(err)) {
    return { toast: "", banner: null, silent: true }
  }

  const network = isNetworkError(err, message)

  if (network) {
    const toast =
      kind === "home"
        ? `Cannot reach server: ${message}`
        : `Cannot load shortcuts: server unreachable`
    const banner = options.suppressBanner
      ? null
      : `Cannot reach the local server (${message}). Typed paths still work; the shortcut list is hidden until the server responds.`
    return { toast, banner, silent: false }
  }

  const routeLabel = kind === "home" ? "home directory" : "shortcuts"
  return {
    toast: `Cannot load ${routeLabel}: ${message}`,
    banner: null,
    silent: false,
  }
}

function isAbortError(err: unknown): boolean {
  if (err == null) return false
  // DOMException with name "AbortError" is what `fetch()` throws when
  // the AbortSignal fires. Some non-browser runtimes (Node test envs)
  // don't have DOMException but still set `.name` to "AbortError".
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true
  if (err instanceof Error && err.name === "AbortError") return true
  return false
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "unknown error"
  if (typeof err === "string") return err
  if (err == null) return "unknown error"
  try {
    return String(err)
  } catch {
    return "unknown error"
  }
}

function isNetworkError(err: unknown, message: string): boolean {
  // fetch() throws a TypeError for any low-level transport failure: DNS,
  // refused connection, CORS preflight, abort, etc. The message text
  // varies by browser ("Failed to fetch" in Chrome, "NetworkError when
  // attempting to fetch resource." in Firefox, "Load failed" in Safari)
  // so we lean on the TypeError check first and only consult the message
  // as a fallback for non-Error throws.
  if (err instanceof TypeError) return true
  // The apiGet helper wraps non-OK responses in `new Error("404 Not Found")`
  // or similar — those start with a digit and are NOT network failures.
  if (/^\d{3}\b/.test(message)) return false
  // Heuristic for environments where err is not a typed exception object.
  return /failed to fetch|network|connection|refused|enotfound|econnrefused/i.test(message)
}

/**
 * Build the ordered shortcut-entry list shown across the top of the picker.
 * Pure of any platform/host concerns; just maps the FsShortcuts payload
 * into a presentation-ready array. Stable order is part of the contract:
 *   Home, Desktop, Documents, Downloads, then mounts in payload order.
 */
export function buildShortcutEntries(
  shortcuts: FsShortcuts | null | undefined,
): Array<{ label: string; path: string }> {
  if (!shortcuts) return []
  const out: Array<{ label: string; path: string }> = []
  // Defensive against server skew / cached stale responses: any of these
  // fields can in principle arrive as null, undefined, or — for `mounts`
  // — a non-array. Skip empties rather than risk a TypeError tearing
  // down the dialog or rendering "" as a clickable bogus path.
  if (shortcuts.home) out.push({ label: "Home", path: shortcuts.home })
  if (shortcuts.desktop) out.push({ label: "Desktop", path: shortcuts.desktop })
  if (shortcuts.documents) out.push({ label: "Documents", path: shortcuts.documents })
  if (shortcuts.downloads) out.push({ label: "Downloads", path: shortcuts.downloads })
  if (Array.isArray(shortcuts.mounts)) {
    for (const m of shortcuts.mounts) {
      if (typeof m === "string" && m.length > 0) out.push({ label: m, path: m })
    }
  }
  return out
}
