import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./task_stop.txt"
import { Session } from "@/session/session"
import { SessionID } from "../session/schema"
import { type TaskPromptOps } from "./task"

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotate({
    description: "The task_id (subagent session id) of the running task to stop. This is the value returned by the task tool when it was launched.",
  }),
  reason: Schema.optional(Schema.String).annotate({
    description: "Optional short explanation of why the task is being stopped. Logged for debugging; not surfaced to the worker.",
  }),
})

export const TaskStopTool = Tool.define(
  "task_stop",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("TaskStopTool requires promptOps in ctx.extra"))

          // Validate that the referenced task is a child of the current
          // session before cancelling. This prevents the coordinator from
          // accidentally (or maliciously) cancelling unrelated sessions.
          const taskID = SessionID.make(params.task_id)
          const child = yield* sessions
            .get(taskID)
            .pipe(Effect.catchCause(() => Effect.succeed(undefined)))

          type Status = "not_found" | "denied" | "cancelled"
          const result = (status: Status, lines: string[]) => ({
            title:
              status === "cancelled" ? "Task stopped" : status === "not_found" ? "Task not found" : "Task not owned",
            metadata: { taskId: params.task_id, status } as { taskId: string; status: Status },
            output: lines.join("\n"),
          })

          if (!child) {
            return result("not_found", [
              `task_id: ${params.task_id}`,
              `status: not_found`,
              `No session with that id exists. It may have already been removed or the id is wrong.`,
            ])
          }

          if (child.parentID !== ctx.sessionID) {
            return result("denied", [
              `task_id: ${params.task_id}`,
              `status: denied`,
              `That session is not a child of this session. You can only stop tasks you launched.`,
            ])
          }

          yield* ops.cancel(taskID)

          return result("cancelled", [
            `task_id: ${params.task_id}`,
            `status: cancelled`,
            ...(params.reason ? [`reason: ${params.reason}`] : []),
            ``,
            `The background task has been signalled to stop. A <task_notification status="cancelled"> message will arrive once the worker has finished tearing down.`,
          ])
        }).pipe(Effect.orDie),
    }
  }),
)
