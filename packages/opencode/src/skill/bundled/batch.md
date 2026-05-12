# Batch

Coordinate a wide, mechanical change across many files by splitting the work into independent slices that can run side-by-side.

## When to use this

Reach for `batch` when the user wants to do **the same kind of edit in lots of places** — a framework migration, a bulk rename, an annotation pass, a wholesale refactor of one pattern into another. The work must be naturally splittable so that two slices don't fight over the same lines.

If the change cuts deeply into a single module or needs a careful, sequential design, do not use `batch` — handle it directly.

## How it runs

There are three stages: **survey**, **dispatch**, **roll up**. Do not skip survey — most batch failures come from starting the rewrite before the conventions were understood.

---

### Stage 1 — Survey (plan mode preferred)

If the host supports it, switch into plan mode so you cannot accidentally edit code while you investigate.

1. **Map the surface.** Spawn one or two foreground `task` agents (you need their results back) to enumerate everything the change touches: files, call sites, helpers, tests, documentation, generated artifacts. Record any local idioms the slices will need to respect.

2. **Carve out slices.** Group the surface into roughly 5 – 30 slices. Each slice should be:
   - Self-contained — editable without coordinating with siblings
   - Mergeable on its own — does not depend on another slice landing first
   - Comparable in size — break apart the giants, fold in the trivial ones

   Use natural seams: one slice per directory, per module, per feature area. Avoid arbitrary "files 1-50" splits — they tend to straddle conventions.

3. **Decide how each slice will prove itself.** A passing unit test alone is not enough for a sweeping change. Pick a concrete verification path. Options, roughly in order of preference:
   - An existing integration or end-to-end suite the slice can run
   - A `bun run dev` / `npm start` + `curl` smoke against the affected endpoints
   - A scripted CLI walkthrough that exercises the changed behavior
   - Browser automation for UI changes

   If none fit, **stop and ask the user** before dispatching workers. Workers cannot ask questions mid-run.

4. **Write the plan.** It must contain: a short research summary, a numbered slice list (each with title / file glob / one-line description), the verification recipe, and the **exact worker prompt template** to be reused below.

5. Exit plan mode and present the plan for approval.

---

### Stage 2 — Dispatch

Once the plan is approved, fan out one background `task` agent per slice. Launch them in a single tool-call block so they run truly in parallel.

Every worker prompt must stand on its own — workers don't share state with each other or with you. Each prompt should include:

- The high-level user instruction
- That slice's exact assignment, lifted verbatim from the plan
- Any conventions discovered in Stage 1
- The verification recipe
- A boilerplate closing block that says, roughly:

  ```
  When the edit is done:
  1. Run the project's unit tests; fix anything you break.
  2. Run the verification recipe; fix any failures.
  3. Commit, push the branch, and open a PR (`gh pr create`) with a descriptive title.
  4. End your reply with exactly one line:
     RESULT: <pr-url>     (or)     RESULT: skipped — <reason>
  ```

If the runtime cannot fan out worktree agents, fall back to serial execution with the same prompts.

---

### Stage 3 — Roll up

Render a progress table immediately after dispatch so the user can watch:

| # | Slice | Status | Result |
|---|-------|--------|--------|
| 1 | … | running | — |
| 2 | … | running | — |

As workers finish, parse the `RESULT:` line out of each reply and rewrite the table with `done` / `failed` plus the PR URL or the reason. Once everyone has reported, post the final table and a one-line tally (e.g. `"21/24 slices landed, 3 need follow-up"`).

---

## Hard rules

- Survey is mandatory. Skipping it produces inconsistent slices.
- Each slice must be independently mergeable. If two slices share state, fuse them before dispatch.
- Worker prompts are frozen once dispatched — get the template right first.
- Never let a worker silently swallow a verification failure. The `RESULT:` line is the contract.
