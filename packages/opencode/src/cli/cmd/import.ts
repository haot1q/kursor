import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "@/session/session"
import { MessageV2 } from "../../session/message-v2"
import { effectCmd } from "../effect-cmd"
import { Database } from "@/storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { InstanceRef } from "@/effect/instance-ref"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { Effect, Schema } from "effect"

const decodeMessageInfo = Schema.decodeUnknownSync(MessageV2.Info)
const decodePart = Schema.decodeUnknownSync(MessageV2.Part)

/** Discriminated union returned by the ShareNext API (GET /api/shares/:id/data) */
export type ShareData =
  | { type: "session"; data: SDKSession }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: unknown }
  | { type: "model"; data: unknown }

/** Extract share ID from a share URL like https://opncd.ai/share/abc123 */
export function parseShareUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/[^/]+\/share\/([a-zA-Z0-9_-]+)$/)
  return match ? match[1] : null
}

export function shouldAttachShareAuthHeaders(shareUrl: string, accountBaseUrl: string): boolean {
  try {
    return new URL(shareUrl).origin === new URL(accountBaseUrl).origin
  } catch {
    return false
  }
}

/**
 * Transform ShareNext API response (flat array) into the nested structure for local file storage.
 *
 * The API returns a flat array: [session, message, message, part, part, ...]
 * Local storage expects: { info: session, messages: [{ info: message, parts: [part, ...] }, ...] }
 *
 * This groups parts by their messageID to reconstruct the hierarchy before writing to disk.
 */
export function transformShareData(shareData: ShareData[]): {
  info: SDKSession
  messages: Array<{ info: Message; parts: Part[] }>
} | null {
  const sessionItem = shareData.find((d) => d.type === "session")
  if (!sessionItem) return null

  const messageMap = new Map<string, Message>()
  const partMap = new Map<string, Part[]>()

  for (const item of shareData) {
    if (item.type === "message") {
      messageMap.set(item.data.id, item.data)
    } else if (item.type === "part") {
      if (!partMap.has(item.data.messageID)) {
        partMap.set(item.data.messageID, [])
      }
      partMap.get(item.data.messageID)!.push(item.data)
    }
  }

  if (messageMap.size === 0) return null

  return {
    info: sessionItem.data,
    messages: Array.from(messageMap.values()).map((msg) => ({
      info: msg,
      parts: partMap.get(msg.id) ?? [],
    })),
  }
}

type ExportData = { info: SDKSession; messages: Array<{ info: Message; parts: Part[] }> }

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx.project.id)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, projectID: string) {
  const isUrl = file.startsWith("http://") || file.startsWith("https://")

  if (isUrl) {
    // Privacy: kursor disables session sharing end-to-end (see
    // packages/opencode/src/share/share-next.ts and
    // packages/opencode/src/config/config.ts). URL-based import is part of
    // the share feature — it issued a GET against the share API origin
    // and would otherwise leak the user's IP + User-Agent + the share
    // secret to a third-party service. The disabled short-circuits inside
    // ShareNext only guard create / sync / remove; this CLI path called
    // `fetch()` directly and would bypass them. Refusing here keeps the
    // disabled guarantee end to end. Local-file import below is
    // unaffected: it touches only the user's own disk and never the
    // network. parseShareUrl, shouldAttachShareAuthHeaders, and
    // transformShareData remain exported and unit-tested so any future
    // local-only share-data round-trip can reuse them without
    // re-introducing the network call.
    process.stdout.write(
      "URL-based import is disabled in kursor for privacy: no session content is fetched from remote services. " +
        "Use a local JSON file path instead.",
    )
    process.stdout.write(EOL)
    return
  }

  const exportData: ExportData | undefined = yield* Effect.promise(() =>
    Filesystem.readJson<ExportData>(file).catch(() => undefined),
  )
  if (!exportData) {
    process.stdout.write(`File not found: ${file}`)
    process.stdout.write(EOL)
    return
  }

  const info = Schema.decodeUnknownSync(Session.Info)({
    ...exportData.info,
    projectID,
  }) as Session.Info
  const row = Session.toRow(info)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values(row)
      .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
      .run(),
  )

  for (const msg of exportData.messages) {
    const msgInfo = decodeMessageInfo(msg.info) as MessageV2.Info
    const { id, sessionID: _, ...msgData } = msgInfo
    Database.use((db) =>
      db
        .insert(MessageTable)
        .values({
          id,
          session_id: row.id,
          time_created: msgInfo.time?.created ?? Date.now(),
          data: msgData,
        })
        .onConflictDoNothing()
        .run(),
    )

    for (const part of msg.parts) {
      const partInfo = decodePart(part) as MessageV2.Part
      const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
      Database.use((db) =>
        db
          .insert(PartTable)
          .values({
            id: partId,
            message_id: messageID,
            session_id: row.id,
            data: partData,
          })
          .onConflictDoNothing()
          .run(),
      )
    }
  }

  process.stdout.write(`Imported session: ${exportData.info.id}`)
  process.stdout.write(EOL)
})
