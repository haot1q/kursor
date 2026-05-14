import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import fs from "fs/promises"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  return replyWithTexts(input, [text])
}

function replyWithTexts(input: SessionPrompt.PromptInput, texts: ReadonlyArray<string>): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: texts.map((text) => ({
      id: PartID.ascending(),
      messageID: id,
      sessionID: input.sessionID,
      type: "text" as const,
      text,
    })),
  }
}

function opsWithTexts(texts: ReadonlyArray<string>): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) => Effect.sync(() => replyWithTexts(input, texts)),
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`task_id: ${child.id}`)
      expect(seen?.sessionID).toBe(child.id)
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance("execute returns small worker results unchanged (no output_file, no truncation)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps({ text: "short summary line 1\nshort summary line 2" })

      const result = yield* def.execute(
        {
          description: "tiny task",
          prompt: "summarize this small thing",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("<task_result>\nshort summary line 1\nshort summary line 2\n</task_result>")
      expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
      expect(result.output).not.toContain("output_file:")
      expect(result.output).not.toContain("result truncated")
      expect((result.metadata as { outputPath?: string }).outputPath).toBeUndefined()
      expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
    }),
  )

  it.instance("execute spills oversized line-count results to disk and returns a head preview", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const headline = "HEADLINE: doc summary first line"
      const body = Array.from({ length: previewMaxLines * 3 }, (_, i) => `body line ${i + 1}`).join("\n")
      const fullText = `${headline}\n${body}`
      const totalBytes = Buffer.byteLength(fullText, "utf-8")

      const promptOps = stubOps({ text: fullText })

      const result = yield* def.execute(
        {
          description: "summarize big doc",
          prompt: "summarize a large document",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const outputPath = (result.metadata as { outputPath?: string }).outputPath
      expect(outputPath).toBeDefined()
      expect(result.output).toContain(`output_file: ${outputPath}`)
      expect(result.output).toContain("result truncated")
      expect(result.output).toContain(headline)
      expect(result.output).toContain(`<task_result>`)
      expect(result.output).toContain(`</task_result>`)
      expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThan(totalBytes)

      const onDisk = yield* Effect.promise(() => fs.readFile(outputPath!, "utf-8"))
      expect(onDisk).toBe(fullText)
    }),
  )

  it.instance("execute handles worker that emits zero text parts", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = opsWithTexts([])

      const result = yield* def.execute(
        {
          description: "empty",
          prompt: "do nothing",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("<task_result>\n\n</task_result>")
      expect(result.output).not.toContain("output_file:")
      expect(result.output).not.toContain("result truncated")
      expect((result.metadata as { outputPath?: string }).outputPath).toBeUndefined()
    }),
  )

  it.instance("execute uses only the last text part when worker emits multiple", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = opsWithTexts([
        "FIRST: thinking step",
        "SECOND: mid-stream draft",
        "FINAL: the answer the coordinator should see",
      ])

      const result = yield* def.execute(
        {
          description: "multi-part",
          prompt: "produce several text parts",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("<task_result>\nFINAL: the answer the coordinator should see\n</task_result>")
      expect(result.output).not.toContain("FIRST: thinking step")
      expect(result.output).not.toContain("SECOND: mid-stream draft")
    }),
  )

  it.instance("execute spills by byte threshold even when line count is tiny", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const previewMaxBytes = Math.max(1024, Math.floor(limits.maxBytes / 2))
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // Five fat lines, each ~12 KB, total ~60 KB. Far below previewMaxLines (1000)
      // but well above previewMaxBytes (~25 KB) so the byte branch must fire.
      const fatLine = "x".repeat(12 * 1024)
      const fullText = Array.from({ length: 5 }, (_, i) => `line${i}-${fatLine}`).join("\n")
      const totalLines = fullText.split("\n").length
      const totalBytes = Buffer.byteLength(fullText, "utf-8")
      expect(totalLines).toBeLessThan(previewMaxLines)
      expect(totalBytes).toBeGreaterThan(previewMaxBytes)

      const promptOps = stubOps({ text: fullText })

      const result = yield* def.execute(
        {
          description: "byte spill",
          prompt: "return a few very long lines",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const outputPath = (result.metadata as { outputPath?: string }).outputPath
      expect(outputPath).toBeDefined()
      expect(result.output).toContain(`output_file: ${outputPath}`)
      expect(result.output).toContain("result truncated")
      expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThan(totalBytes)

      const onDisk = yield* Effect.promise(() => fs.readFile(outputPath!, "utf-8"))
      expect(onDisk).toBe(fullText)
    }),
  )

  it.instance("execute round-trips multi-byte UTF-8 worker output on disk", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxBytes = Math.max(1024, Math.floor(limits.maxBytes / 2))
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // Mix of Chinese (3 bytes), Japanese (3 bytes), and emoji (4 bytes in UTF-8).
      // ~12000 chars across 4 lines gives ~40-50 KB > previewMaxBytes (~25 KB).
      const seg = "文档归纳摘要 — 日本語の要約 — 🚀✨📄 — "
      const oneLine = seg.repeat(120)
      const fullText = Array.from({ length: 4 }, () => oneLine).join("\n")
      const totalBytes = Buffer.byteLength(fullText, "utf-8")
      expect(totalBytes).toBeGreaterThan(previewMaxBytes)

      const promptOps = stubOps({ text: fullText })

      const result = yield* def.execute(
        {
          description: "utf-8 doc",
          prompt: "summarize a multi-byte doc",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const outputPath = (result.metadata as { outputPath?: string }).outputPath
      expect(outputPath).toBeDefined()
      // Disk content must be byte-for-byte identical to the original, no half-character mangling.
      const onDisk = yield* Effect.promise(() => fs.readFile(outputPath!, "utf-8"))
      expect(onDisk).toBe(fullText)
      expect(Buffer.byteLength(onDisk, "utf-8")).toBe(totalBytes)
      // Preview must still contain a recognisable headline character from the source.
      expect(result.output).toContain("文档")
    }),
  )

  it.instance("execute does not spill when line count equals the preview threshold", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // Exactly previewMaxLines lines; total bytes deliberately tiny so the byte branch can't trigger.
      const atThreshold = Array.from({ length: previewMaxLines }, (_, i) => `L${i}`).join("\n")
      expect(atThreshold.split("\n").length).toBe(previewMaxLines)

      const promptOps = stubOps({ text: atThreshold })

      const result = yield* def.execute(
        {
          description: "boundary",
          prompt: "return exactly threshold lines",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).not.toContain("output_file:")
      expect(result.output).not.toContain("result truncated")
      expect((result.metadata as { outputPath?: string }).outputPath).toBeUndefined()
    }),
  )

  it.instance("execute spills when line count exceeds the preview threshold by one", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const justOver = Array.from({ length: previewMaxLines + 1 }, (_, i) => `L${i}`).join("\n")
      expect(justOver.split("\n").length).toBe(previewMaxLines + 1)

      const promptOps = stubOps({ text: justOver })

      const result = yield* def.execute(
        {
          description: "just over",
          prompt: "return threshold+1 lines",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect((result.metadata as { outputPath?: string }).outputPath).toBeDefined()
      expect(result.output).toContain("output_file:")
      expect(result.output).toContain("result truncated")
    }),
  )

  it.instance("execute keeps metadata.truncated false so framework does not double-spill", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const fullText = Array.from({ length: previewMaxLines * 4 }, (_, i) => `row ${i}`).join("\n")
      const promptOps = stubOps({ text: fullText })

      const result = yield* def.execute(
        {
          description: "double spill guard",
          prompt: "huge result",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const meta = result.metadata as { outputPath?: string; truncated?: boolean }
      expect(meta.outputPath).toBeDefined()
      // metadata.truncated is set by Tool.wrap (tool.ts) AFTER the inner executor returns;
      // if it is true, the framework re-truncated and wrote a SECOND file, which means our
      // preview was too big and the model would see two conflicting output_file paths.
      expect(meta.truncated).toBe(false)
      // The only "output_file:" mention should be our own (single occurrence).
      const occurrences = result.output.match(/output_file:/g)?.length ?? 0
      expect(occurrences).toBe(1)
      // The disk file we created is the one the model sees.
      const onDisk = yield* Effect.promise(() => fs.readFile(meta.outputPath!, "utf-8"))
      expect(onDisk).toBe(fullText)
    }),
  )

  it.instance(
    "execute respects custom tool_output config thresholds",
    () =>
      Effect.gen(function* () {
        const trunc = yield* Truncate.Service
        const limits = yield* trunc.limits()
        // Custom config below should produce these limits, but we read them via trunc.limits()
        // to avoid hard-coding numbers that may drift.
        expect(limits.maxLines).toBe(120)
        expect(limits.maxBytes).toBe(8192)

        const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2)) // 60

        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        // 200 short lines — exceeds previewMaxLines=60 under custom config but would NOT
        // exceed the default 1000-line preview threshold; this proves our code honors config.
        const fullText = Array.from({ length: 200 }, (_, i) => `r${i}`).join("\n")
        const promptOps = stubOps({ text: fullText })

        const result = yield* def.execute(
          {
            description: "custom config",
            prompt: "return 200 lines",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const outputPath = (result.metadata as { outputPath?: string }).outputPath
        expect(outputPath).toBeDefined()
        expect(result.output).toContain("output_file:")
        expect(result.output).toContain("result truncated")
        const onDisk = yield* Effect.promise(() => fs.readFile(outputPath!, "utf-8"))
        expect(onDisk).toBe(fullText)
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
      }),
    {
      config: {
        tool_output: {
          max_lines: 120,
          max_bytes: 8192,
        },
      },
    },
  )

  it.instance("execute spills on a resumed task_id when the next turn is large", () =>
    Effect.gen(function* () {
      const trunc = yield* Truncate.Service
      const limits = yield* trunc.limits()
      const previewMaxLines = Math.max(1, Math.floor(limits.maxLines / 2))
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      // First call: small result, no spill, creates a child session.
      const firstOps = stubOps({ text: "first turn short summary" })
      const first = yield* def.execute(
        {
          description: "first turn",
          prompt: "do first thing",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: firstOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      const childID = first.metadata.sessionId
      expect(first.output).not.toContain("output_file:")

      // Second call: resume the same child session, large result this time.
      const huge = Array.from({ length: previewMaxLines * 3 }, (_, i) => `cont line ${i}`).join("\n")
      const secondOps = stubOps({ text: huge })
      const second = yield* def.execute(
        {
          description: "second turn",
          prompt: "do second thing",
          subagent_type: "general",
          task_id: childID,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: secondOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(second.metadata.sessionId).toBe(childID)
      const outputPath = (second.metadata as { outputPath?: string }).outputPath
      expect(outputPath).toBeDefined()
      expect(second.output).toContain(`output_file: ${outputPath}`)
      expect(second.output).toContain("result truncated")
      const onDisk = yield* Effect.promise(() => fs.readFile(outputPath!, "utf-8"))
      expect(onDisk).toBe(huge)

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(childID)
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "read",
            pattern: "*",
            action: "allow",
          },
        ])
        expect(seen?.tools).toEqual({
          todowrite: false,
          bash: false,
          read: false,
        })
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )
})
