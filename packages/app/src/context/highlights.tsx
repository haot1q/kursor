import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { persisted } from "@/utils/persist"
import { DialogReleaseNotes, type Highlight } from "@/components/dialog-release-notes"

// Release-notes dialog used to fetch upstream changelog from
// https://opencode.ai/changelog.json on every launch. That request leaked
// "another kursor user just started" to a third-party service. We now skip
// the network fetch entirely; the user simply does not see an upgrade
// dialog. A future change can replace this with a bundled local JSON or a
// kursor-controlled endpoint if we ever decide to surface release notes
// again.

type Store = {
  version?: string
}

type ParsedRelease = {
  tag?: string
  highlights: Highlight[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }

  if (typeof value === "number") return String(value)
  return
}

function normalizeVersion(value: string | undefined) {
  const text = value?.trim()
  if (!text) return
  return text.startsWith("v") || text.startsWith("V") ? text.slice(1) : text
}

function parseMedia(value: unknown, alt: string): Highlight["media"] | undefined {
  if (!isRecord(value)) return
  const type = getText(value.type)?.toLowerCase()
  const src = getText(value.src) ?? getText(value.url)
  if (!src) return
  if (type !== "image" && type !== "video") return

  return { type, src, alt }
}

function parseHighlight(value: unknown): Highlight | undefined {
  if (!isRecord(value)) return

  const title = getText(value.title)
  if (!title) return

  const description = getText(value.description) ?? getText(value.shortDescription)
  if (!description) return

  const media = parseMedia(value.media, title)
  return { title, description, media }
}

function parseRelease(value: unknown): ParsedRelease | undefined {
  if (!isRecord(value)) return
  const tag = getText(value.tag) ?? getText(value.tag_name) ?? getText(value.name)

  if (!Array.isArray(value.highlights)) {
    return { tag, highlights: [] }
  }

  const highlights = value.highlights.flatMap((group) => {
    if (!isRecord(group)) return []

    const source = getText(group.source)
    if (!source) return []
    if (!source.toLowerCase().includes("desktop")) return []

    if (Array.isArray(group.items)) {
      return group.items.map((item) => parseHighlight(item)).filter((item): item is Highlight => item !== undefined)
    }

    const item = parseHighlight(group)
    if (!item) return []
    return [item]
  })

  return { tag, highlights }
}

function parseChangelog(value: unknown): ParsedRelease[] | undefined {
  if (Array.isArray(value)) {
    return value.map(parseRelease).filter((release): release is ParsedRelease => release !== undefined)
  }

  if (!isRecord(value)) return
  if (!Array.isArray(value.releases)) return

  return value.releases.map(parseRelease).filter((release): release is ParsedRelease => release !== undefined)
}

function sliceHighlights(input: { releases: ParsedRelease[]; current?: string; previous?: string }) {
  const current = normalizeVersion(input.current)
  const previous = normalizeVersion(input.previous)
  const releases = input.releases

  const start = (() => {
    if (!current) return 0
    const index = releases.findIndex((release) => normalizeVersion(release.tag) === current)
    return index === -1 ? 0 : index
  })()

  const end = (() => {
    if (!previous) return releases.length
    const index = releases.findIndex((release, i) => i >= start && normalizeVersion(release.tag) === previous)
    return index === -1 ? releases.length : index
  })()

  const highlights = releases.slice(start, end).flatMap((release) => release.highlights)
  const seen = new Set<string>()
  const unique = highlights.filter((highlight) => {
    const key = dedupeKey(highlight)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(0, 5)
}

function dedupeKey(highlight: Highlight) {
  return [highlight.title, highlight.description, highlight.media?.type ?? "", highlight.media?.src ?? ""].join("\n")
}

function loadReleaseHighlights(value: unknown, current?: string, previous?: string) {
  const releases = parseChangelog(value)
  if (!releases?.length) return []
  return sliceHighlights({ releases, current, previous })
}

export const { use: useHighlights, provider: HighlightsProvider } = createSimpleContext({
  name: "Highlights",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const dialog = useDialog()
    const settings = useSettings()
    const [store, setStore, _, ready] = persisted("highlights.v1", createStore<Store>({ version: undefined }))

    const [range, setRange] = createStore({
      from: undefined as string | undefined,
      to: undefined as string | undefined,
    })
    const state = { started: false }
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    }

    const markSeen = () => {
      if (!platform.version) return
      setStore("version", platform.version)
    }

    const start = (_previous: string) => {
      // Privacy: never reach out to a remote changelog endpoint. Just mark
      // the current version as seen so we don't keep re-prompting. The
      // dialog branch + supporting helpers (loadReleaseHighlights, parsers,
      // DialogReleaseNotes) are retained so a future local/bundled
      // changelog source can plug in here without re-introducing a network
      // dependency.
      markSeen()
      onCleanup(() => clearTimer())
    }

    createEffect(() => {
      if (state.started) return
      if (!ready()) return
      if (!settings.ready()) return
      if (!platform.version) return
      state.started = true

      const previous = store.version
      if (!previous) {
        setStore("version", platform.version)
        return
      }

      if (previous === platform.version) return

      setRange({ from: previous, to: platform.version })
      start(previous)
    })

    return {
      ready,
      from: () => range.from,
      to: () => range.to,
      get last() {
        return store.version
      },
      markSeen,
    }
  },
})
