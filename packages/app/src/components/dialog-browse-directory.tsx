// Server-backed directory picker for the web UI.
//
// Hits the sidecar's loopback-only /fs/* routes (see
// packages/opencode/src/server/routes/instance/httpapi/handlers/fs.ts) so a
// browser-only build can let the user choose a local workspace directory
// without an Electron native dialog. Designed to be opt-in: it's registered
// on the web `platform.openDirectoryPickerDialog` (entry.tsx) which the
// existing "open project" code path already prefers when present, so this
// component slots in transparently and the desktop / remote-SSH flows are
// untouched.
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"

interface FsEntry {
  name: string
  path: string
  type: "directory" | "file" | "symlink" | "other"
  hidden: boolean
}

interface FsListResult {
  path: string
  parent: string | null
  entries: FsEntry[]
  truncated: boolean
  total: number
}

interface FsShortcuts {
  home: string
  desktop: string | null
  documents: string | null
  downloads: string | null
  mounts: string[]
}

interface FsHome {
  home: string
  platform: string
  separator: string
}

export interface DialogBrowseDirectoryProps {
  title?: string
  /**
   * For API compatibility with `platform.openDirectoryPickerDialog`. When
   * true the resolved value is wrapped in an array; multiple selection is
   * not supported in this server-backed picker yet so behaviour collapses
   * to single-select either way.
   */
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogBrowseDirectory(props: DialogBrowseDirectoryProps) {
  const dialog = useDialog()
  const server = useServer()
  const globalSDK = useGlobalSDK()

  // The SDK is auto-generated and doesn't yet expose the new /fs/* methods,
  // so we go down a notch and call fetch directly using the same base URL +
  // Basic-auth header the rest of the app uses. Keeps this component
  // self-contained and avoids a generated-SDK regeneration step.
  const baseUrl = createMemo(() => globalSDK.url.replace(/\/+$/, ""))
  const authHeader = createMemo((): Record<string, string> => {
    const conn = server.current
    if (!conn || conn.type !== "http" || !conn.http.password) return {}
    const username = conn.http.username ?? "opencode"
    return { Authorization: `Basic ${btoa(`${username}:${conn.http.password}`)}` }
  })

  const apiGet = async <T,>(pathSegment: string): Promise<T> => {
    const res = await fetch(`${baseUrl()}${pathSegment}`, {
      headers: { ...authHeader() },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  }

  const apiPost = async <T,>(pathSegment: string, body: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl()}${pathSegment}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  }

  // Eagerly load home + shortcuts so the dialog renders with content the
  // moment it opens, rather than flashing an empty state.
  const [homeInfo] = createResource(() => apiGet<FsHome>("/fs/home"))
  const [shortcuts] = createResource(() => apiGet<FsShortcuts>("/fs/shortcuts"))

  const [currentPath, setCurrentPath] = createSignal<string | null>(null)
  const [pathInput, setPathInput] = createSignal("")
  const [showHidden, setShowHidden] = createSignal(false)

  // Default the current path to home once /fs/home resolves. The signal
  // remains null while loading so the listing query doesn't fire with
  // empty input.
  const effectivePath = createMemo(() => currentPath() ?? homeInfo()?.home ?? null)

  const [listing] = createResource(
    () => {
      const p = effectivePath()
      if (!p) return null
      return { path: p, showHidden: showHidden() }
    },
    async (input) => {
      if (!input) return null
      try {
        const qs = new URLSearchParams({ path: input.path, showHidden: String(input.showHidden) })
        return await apiGet<FsListResult>(`/fs/list?${qs.toString()}`)
      } catch (err) {
        showToast({ title: `Cannot list folder: ${(err as Error).message}` })
        return null
      }
    },
  )

  function navigate(target: string) {
    setCurrentPath(target)
    setPathInput("")
  }

  function navigateToParent() {
    const parent = listing()?.parent
    if (parent) navigate(parent)
  }

  async function navigateToTyped() {
    const raw = pathInput().trim()
    if (!raw) return
    try {
      const resolved = await apiPost<{ resolved: string; exists: boolean; isDirectory: boolean }>("/fs/realpath", {
        path: raw,
      })
      if (!resolved.exists) {
        showToast({ title: `Path does not exist: ${resolved.resolved}` })
        return
      }
      if (!resolved.isDirectory) {
        showToast({ title: `Not a directory: ${resolved.resolved}` })
        return
      }
      navigate(resolved.resolved)
    } catch (err) {
      showToast({ title: `Could not resolve path: ${(err as Error).message}` })
    }
  }

  function confirmSelection() {
    const p = effectivePath()
    if (!p) return
    props.onSelect(props.multiple ? [p] : p)
    dialog.close()
  }

  const shortcutEntries = createMemo(() => {
    const s = shortcuts()
    if (!s) return [] as Array<{ label: string; path: string }>
    const out: Array<{ label: string; path: string }> = []
    out.push({ label: "Home", path: s.home })
    if (s.desktop) out.push({ label: "Desktop", path: s.desktop })
    if (s.documents) out.push({ label: "Documents", path: s.documents })
    if (s.downloads) out.push({ label: "Downloads", path: s.downloads })
    for (const m of s.mounts) out.push({ label: m, path: m })
    return out
  })

  return (
    <Dialog title={props.title ?? "Open project"}>
      <div class="flex flex-col gap-3 w-full max-w-2xl min-w-md">
        <div class="flex items-center gap-2">
          <TextField
            class="flex-1"
            placeholder={effectivePath() ?? "/path/to/folder or ~"}
            value={pathInput()}
            onChange={(value) => setPathInput(value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              void navigateToTyped()
            }}
          />
          <Button variant="ghost" onClick={() => void navigateToTyped()}>
            Go
          </Button>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <For each={shortcutEntries()}>
            {(entry) => (
              <Button size="small" variant="ghost" onClick={() => navigate(entry.path)}>
                {entry.label}
              </Button>
            )}
          </For>
          <label class="flex items-center gap-1.5 text-12-regular text-text-weak ml-auto select-none">
            <input
              type="checkbox"
              checked={showHidden()}
              onChange={(e: Event) => setShowHidden((e.target as HTMLInputElement).checked)}
            />
            Show hidden
          </label>
        </div>

        <div class="flex items-center gap-2 text-12-regular text-text-weak px-1">
          <Show when={listing()?.parent}>
            <Button size="small" variant="ghost" onClick={navigateToParent}>
              ..
            </Button>
          </Show>
          <span class="truncate font-mono">{effectivePath() ?? ""}</span>
        </div>

        <div class="border border-border rounded-md overflow-hidden max-h-72 overflow-y-auto">
          <Show
            when={!listing.loading}
            fallback={<div class="px-3 py-6 text-13-regular text-text-weak">Loading…</div>}
          >
            <Show
              when={listing()?.entries.length}
              fallback={<div class="px-3 py-6 text-13-regular text-text-weak">No subfolders</div>}
            >
              <ul class="divide-y divide-border">
                <For each={listing()?.entries ?? []}>
                  {(entry) => (
                    <li>
                      <button
                        type="button"
                        class={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-13-regular hover:bg-bg-weak ${
                          entry.type === "directory" ? "cursor-pointer" : "opacity-50"
                        }`}
                        disabled={entry.type !== "directory"}
                        onClick={() => entry.type === "directory" && navigate(entry.path)}
                      >
                        <span class="shrink-0">{entry.type === "directory" ? "📁" : "📄"}</span>
                        <span class="truncate">{entry.name}</span>
                        <Show when={entry.hidden}>
                          <span class="text-text-weak text-11-regular">(hidden)</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={listing()?.truncated}>
                <div class="px-3 py-2 text-12-regular text-text-weak border-t border-border">
                  Showing {listing()?.entries.length} of {listing()?.total}. Type a more specific path to narrow.
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmSelection} disabled={!effectivePath()}>
            Select this folder
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
