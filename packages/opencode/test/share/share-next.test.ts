import { NodeFileSystem } from "@effect/platform-node"
import { beforeEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { Account } from "../../src/account/account"
import { AccountRepo } from "../../src/account/repo"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShareTable } from "../../src/share/share.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const env = Layer.mergeAll(
  Session.defaultLayer,
  AccountRepo.layer,
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function live(client: HttpClient.HttpClient) {
  const http = Layer.succeed(HttpClient.HttpClient, client)
  return ShareNext.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Account.layer.pipe(Layer.provide(AccountRepo.layer), Layer.provide(http))),
    Layer.provide(Config.defaultLayer),
    Layer.provide(http),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
  )
}

function wired(client: HttpClient.HttpClient) {
  const http = Layer.succeed(HttpClient.HttpClient, client)
  return Layer.mergeAll(
    Bus.layer,
    ShareNext.layer,
    Session.defaultLayer,
    AccountRepo.layer,
    NodeFileSystem.layer,
    CrossSpawnSpawner.defaultLayer,
  ).pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Account.layer.pipe(Layer.provide(AccountRepo.layer), Layer.provide(http))),
    Layer.provide(Config.defaultLayer),
    Layer.provide(http),
    Layer.provide(Provider.defaultLayer),
  )
}

const share = (id: SessionID) =>
  Database.use((db) => db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, id)).get())

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(live(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(live(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.Service.use((svc) => svc.request()).pipe(Effect.provide(live(none)))

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }),
    ),
  )

  // The four tests below replace upstream's create/remove/sync coverage with
  // the kursor disabled-mode invariant: every network entry point in
  // share-next.ts short-circuits and never reaches the HttpClient. We feed
  // a client that dies on every call (`none`) so any forgotten guard would
  // crash the test rather than quietly hit a real socket. Behavior of the
  // `request()` URL builder is still covered by the three tests above
  // because `request()` is a pure URL/headers constructor without network
  // side effects.

  it.live("create returns an empty sentinel and makes no HTTP call when disabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))

          const result = yield* ShareNext.Service.use((svc) => svc.create(session.id)).pipe(
            Effect.provide(live(none)),
          )

          // Privacy invariant: a sentinel share with empty fields, never a
          // real share record bound to a remote service.
          expect(result.id).toBe("")
          expect(result.url).toBe("")
          expect(result.secret).toBe("")

          // No DB write — the disabled branch returns before the insert.
          expect(share(session.id)).toBeUndefined()
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove no-ops and makes no HTTP call when disabled", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.remove(session.id))).pipe(
          Effect.provide(live(none)),
        )

        // Succeeds with no work done — neither HTTP nor DB writes happen.
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(share(session.id)).toBeUndefined()
      }),
    ),
  )

  it.live("create cannot fail via remote response when disabled (short-circuit precedes HTTP)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))

        // A client that would 500 if reached — used to assert that the
        // disabled branch returns BEFORE any HTTP request is built.
        const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id))).pipe(
          Effect.provide(live(client)),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(share(session.id)).toBeUndefined()
      }),
    ),
  )

  it.live("diff events do NOT trigger any sync HTTP call when disabled", () =>
    provideTmpdirInstance(
      () => {
        const seen: string[] = []
        // Record any URL the client is ever asked to hit. If the disabled
        // branch in share-next.ts is removed, the sync path would fire on
        // every diff event and this list would become non-empty.
        const client = HttpClient.make((req) => {
          seen.push(req.url)
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const bus = yield* Bus.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)

          // Even if a stale share row exists in the DB, the disabled
          // branch must not act on it.
          yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .insert(SessionShareTable)
                .values({
                  session_id: info.id,
                  id: "shr_abc",
                  url: "https://legacy-share.example.com/share/abc",
                  secret: "sec_123",
                })
                .run(),
            ),
          )

          yield* bus.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* Effect.sleep(1_250)

          expect(seen).toEqual([])
        }).pipe(Effect.provide(wired(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})
