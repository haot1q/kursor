import * as Tool from "./tool"
import * as Truncate from "./truncate"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { ModelID, ProviderID } from "../provider/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.task" })

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
  run_in_background: Schema.optional(Schema.Boolean).annotate({
    description:
      "If true, return immediately and run the worker in the background. The worker's result arrives later as a <task_notification> user message in this session. Use for long-running work (large doc summarization, broad research, parallel exploration) when you want to launch other work, answer the user, or end the turn while the worker runs. Default: false (synchronous — the tool blocks until the worker finishes).",
  }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const trunc = yield* Truncate.Service

    // Compute the preview / disk-spill envelope for a worker's final text.
    // Shared by the synchronous and background paths so both share identical
    // truncation semantics.
    const envelope = Effect.fn("TaskTool.envelope")(function* (lastText: string) {
      const limits = yield* trunc.limits()
      // Preview must fit well below the framework's per-tool truncation
      // threshold (Tool.wrap re-truncates every tool's output via
      // Truncate.output); otherwise our spilled file is double-wrapped with a
      // second file containing the framework's generic shell-style hint. Half
      // the framework limits leaves plenty of room for the <task_result>
      // envelope and output_file metadata lines.
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

      return { preview, outputPath, removedLines, removedBytes, exceeds, totalLines, totalBytes }
    })

    // Compose the <task_result> body (shared by sync output and async
    // notification). Includes the preview block and the truncation marker.
    function renderResultBody(env: {
      preview: string
      outputPath?: string
      removedLines: number
      removedBytes: number
      exceeds: boolean
    }) {
      const lines: string[] = ["<task_result>", env.preview]
      if (env.exceeds) {
        const removedDesc =
          env.removedLines > 0
            ? `${env.removedLines} more line${env.removedLines === 1 ? "" : "s"}`
            : `${env.removedBytes} more byte${env.removedBytes === 1 ? "" : "s"}`
        lines.push(
          "",
          `...result truncated — ${removedDesc} in output_file. Trust this preview by default; re-read the file only if you need a section it omitted.`,
        )
      }
      lines.push("</task_result>")
      return lines.join("\n")
    }

    function renderNotification(input: {
      taskID: SessionID
      status: "completed" | "failed" | "cancelled"
      description: string
      agent: string
      body: string
      outputPath?: string
    }) {
      const head: string[] = [
        `task_id: ${input.taskID}`,
        `status: ${input.status}`,
        `description: ${input.description}`,
        `agent: ${input.agent}`,
      ]
      if (input.outputPath) head.push(`output_file: ${input.outputPath}`)
      return ["<task_notification>", ...head, "", input.body, "</task_notification>"].join("\n")
    }

    // Background path. The tool returns immediately with a "started" envelope;
    // the worker runs detached and posts its outcome as a synthetic user
    // message (`<task_notification>`) on the parent session. The detached
    // effect uses EffectBridge.fork — the same primitive used elsewhere in
    // this file for abort wiring — so it inherits the workspace/instance
    // ALS context and keeps the layer's services available.
    //
    // We deliberately call ops.prompt with `noReply: true` for the
    // notification so the parent's loop is not re-triggered out-of-band.
    // If the parent's loop is already iterating (e.g. the coordinator is
    // still mid-turn), the new user message is naturally picked up on the
    // next loop iteration via `lastUser.id > lastAssistant.id`. If the loop
    // has finished, the message sits in the session and the LLM sees it on
    // the user's next turn — the same delivery semantics as any other
    // session message.
    const runInBackground = Effect.fn("TaskTool.runInBackground")(function* (input: {
      params: Schema.Schema.Type<typeof Parameters>
      ctx: Tool.Context
      ops: TaskPromptOps
      parent: { agent?: string }
      nextSession: { id: SessionID }
      model: { providerID: ProviderID; modelID: ModelID }
      workerAgent: string
      workerTools: Record<string, boolean>
      messageID: ReturnType<typeof MessageID.ascending>
    }) {
      const { params, ctx, ops, parent, nextSession, model, workerAgent, workerTools, messageID } = input
      const taskID = nextSession.id

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: taskID,
          model,
        },
      })

      const notify = (text: string) =>
        ops.prompt({
          sessionID: ctx.sessionID,
          ...(parent.agent ? { agent: parent.agent } : {}),
          noReply: true,
          parts: [{ type: "text" as const, synthetic: true, text }],
        })

      const reportSuccess = (lastText: string) =>
        Effect.gen(function* () {
          const env = yield* envelope(lastText)
          const text = renderNotification({
            taskID,
            status: "completed",
            description: params.description,
            agent: params.subagent_type,
            body: renderResultBody(env),
            outputPath: env.outputPath,
          })
          yield* notify(text)
        })

      const reportFailure = (status: "failed" | "cancelled", reason: string) =>
        Effect.gen(function* () {
          const body = ["<task_error>", reason || status, "</task_error>"].join("\n")
          const text = renderNotification({
            taskID,
            status,
            description: params.description,
            agent: params.subagent_type,
            body,
          })
          yield* notify(text)
        })

      // The background effect: resolve parts, run the worker, then post the
      // notification. Wrapped end-to-end so even resolution errors are
      // reported to the parent (otherwise the coordinator would have no
      // signal that the background task ever finished).
      const background = Effect.gen(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        return yield* ops.prompt({
          messageID,
          sessionID: taskID,
          model: { modelID: model.modelID, providerID: model.providerID },
          agent: workerAgent,
          tools: workerTools,
          parts,
        })
      }).pipe(
        Effect.matchCauseEffect({
          onSuccess: (result) => {
            const lastText = result.parts.findLast((item) => item.type === "text")?.text ?? ""
            return reportSuccess(lastText)
          },
          onFailure: (cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return reportFailure("cancelled", "Task was cancelled.")
            }
            const defect = Cause.squash(cause)
            const reason = defect instanceof Error ? defect.message : String(defect)
            return reportFailure("failed", reason)
          },
        }),
        // If even the notification fails (rare: DB unavailable, parent
        // already removed), log and swallow — there is no caller to surface
        // the error to.
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.sync(() => {
            log.error("background task notification failed", { taskID, cause: Cause.pretty(cause) })
          }),
        ),
      )

      const bridge = yield* EffectBridge.make()
      bridge.fork(background)

      const lines = [
        `task_id: ${taskID}`,
        `status: started`,
        `description: ${params.description}`,
        `agent: ${params.subagent_type}`,
        "",
        "The task is running in the background. Its result will arrive as a <task_notification> message in this session, either later in your current turn (if it finishes quickly) or on a future turn. While it runs you may launch additional tasks, do other work, or end your turn. Do NOT call task again with this task_id until the notification arrives — that would race with the in-flight worker.",
      ]

      return {
        title: params.description,
        metadata: {
          sessionId: taskID,
          model,
        },
        output: lines.join("\n"),
      }
    })

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

      const messageID = MessageID.ascending()
      const workerTools = {
        ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
        ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
        ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
      }

      if (params.run_in_background) {
        return yield* runInBackground({
          params,
          ctx,
          ops,
          parent,
          nextSession,
          model,
          workerAgent: next.name,
          workerTools,
          messageID,
        })
      }

      const runCancel = yield* EffectBridge.make()
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
            const env = yield* envelope(lastText)

            const outputLines: string[] = [
              `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
            ]
            if (env.outputPath) {
              outputLines.push(
                `output_file: ${env.outputPath} (full worker result saved here; use the read tool with offset/limit to fetch a specific section only when the preview is insufficient)`,
              )
            }
            outputLines.push("", renderResultBody(env))

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                ...(env.outputPath ? { outputPath: env.outputPath } : {}),
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
