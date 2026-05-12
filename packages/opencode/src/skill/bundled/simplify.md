# Simplify

Pass the recent diff through three focused critics in parallel — **reuse**, **quality**, **efficiency** — then act on what they find.

## Where the diff comes from

Default to `git diff` (or `git diff HEAD` if changes are already staged). If the working tree is clean, fall back to the files this session has been editing.

If you cannot produce *any* set of changed files, stop and tell the user — there is nothing to simplify.

## Run three critics in parallel

Spawn three sub-agents with the `task` tool in a **single tool-call block** so they run concurrently. Hand each one the full diff plus its focus.

### Critic 1 — Reuse hunter

For every new function, helper, or block of inline logic, look around for prior art that does the same thing:

1. Search adjacent directories first (`util/`, `lib/`, `helpers/`, anything next to the changed files), then the wider tree.
2. If a near-equivalent already exists, recommend swapping the new code for the existing function.
3. Watch for re-invented basics — hand-rolled path joining, string parsing the standard library already does, ad-hoc environment sniffing, custom type-guards that duplicate a utility.

### Critic 2 — Quality reviewer

Read the same diff with an eye for sloppy patterns:

1. **Duplicated state** — values cached when they could be derived; two fields holding the same fact; observers where a direct call would do.
2. **Parameter creep** — adding yet another argument when a small redesign would generalize the API.
3. **Near-duplicate blocks** — two slightly-different copies of the same logic; unify them.
4. **Leaky abstraction** — internals exposed across module boundaries that should stay hidden.
5. **Stringly typed code** — raw strings where a constant, enum, or union already exists.
6. **Wrapper noise** — components / elements / classes that add no semantic value, just an extra layer.
7. **Narrating comments** — comments that restate what the code does. Remove. Keep only comments that capture intent, trade-offs, or constraints the code itself cannot.

### Critic 3 — Efficiency reviewer

Same diff, this time looking for waste:

1. **Repeated work** — recomputing the same value, reading the same file twice, N+1 patterns.
2. **Missed parallelism** — independent steps run one after the other when they could fan out.
3. **Startup or hot-path bloat** — new blocking work added to a path that runs constantly.
4. **No-op writes in loops/intervals** — state that gets set every tick whether or not it changed; guard with change detection.
5. **TOCTOU existence checks** — `if (exists) doIt()` patterns. Just do it and handle the error.
6. **Resource leaks** — unbounded buffers, missing cleanup, unregistered listeners.
7. **Over-reading** — slurping a whole file when a stream or a slice would suffice.

## Merge and act

Wait for all three critics to finish. Combine their findings, drop duplicates, and apply each one directly. If a finding is wrong (false positive) or low-value, silently skip it — there is no need to debate the critics.

When done, give the user a one-paragraph summary: which findings were applied, which were dismissed and why, or "the diff was already clean".

## Hard rules

- Stay inside the diff's scope. Do not widen into unrelated cleanup.
- Skip unrelated style / lint fixes; the project's formatter and linter own that.
- If a finding implies a meaningful API change, **surface it to the user** before applying.
