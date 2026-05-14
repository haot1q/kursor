import * as Tool from "./tool"
import * as Truncate from "./truncate"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const trunc = yield* Truncate.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            })

            const lastText = result.parts.findLast((item) => item.type === "text")?.text ?? ""
            const limits = yield* trunc.limits()
            // Preview must fit well below the framework's per-tool truncation
            // threshold (Tool.wrap re-truncates every tool's output via
            // Truncate.output); otherwise our spilled file is double-wrapped
            // with a second file containing the framework's generic shell-style
            // hint. Half the framework limits leaves plenty of room for the
            // <task_result> envelope and output_file metadata lines.
            const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
            const previewMaxBytes = Math.max(1024, Math.floor(limits.maxBytes / 2))
            const totalLines = lastText.length === 0 ? 0 : lastText.split("\n").length
            const totalBytes = Buffer.byteLength(lastText, "utf-8")
            const exceeds = totalLines > previewMaxLines || totalBytes > previewMaxBytes

            let preview = lastText
            let outputPath: string | undefined
            let removedLines = 0
            let removedBytes = 0

            if (exceeds) {
              outputPath = yield* trunc.write(lastText)
              const lines = lastText.split("\n")
              const sliced: string[] = []
              let bytes = 0
              for (let i = 0; i < lines.length && sliced.length < previewMaxLines; i++) {
                const lineSize = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
                if (bytes + lineSize > previewMaxBytes) break
                sliced.push(lines[i])
                bytes += lineSize
              }
              preview = sliced.join("\n")
              removedLines = totalLines - sliced.length
              removedBytes = totalBytes - bytes
            }

            const outputLines: string[] = [
              `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
            ]
            if (outputPath) {
              outputLines.push(
                `output_file: ${outputPath} (full worker result saved here; use the read tool with offset/limit to fetch a specific section only when the preview is insufficient)`,
              )
            }
            outputLines.push("", "<task_result>", preview)
            if (exceeds) {
              const removedDesc =
                removedLines > 0
                  ? `${removedLines} more line${removedLines === 1 ? "" : "s"}`
                  : `${removedBytes} more byte${removedBytes === 1 ? "" : "s"}`
              outputLines.push(
                "",
                `...result truncated — ${removedDesc} in output_file. Trust this preview by default; re-read the file only if you need a section it omitted.`,
              )
            }
            outputLines.push("</task_result>")

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                ...(outputPath ? { outputPath } : {}),
              },
              output: outputLines.join("\n"),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
