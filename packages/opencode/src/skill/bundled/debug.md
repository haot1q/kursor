# Debug

Walk the user from "something is broken" to a fix that is grounded in real evidence — not guesses.

## Mindset

The point of debugging is not to ship a patch quickly; it is to make the broken behavior **stop reproducing**, and to make sure you understand **why** before you change anything. Speculative edits that happen to make the symptom go away are how regressions get planted.

## The flow

The flow below loops back: if Step 4 refutes your hypothesis, return to Step 3 with what you learned. Do not skip ahead.

### Step 1 — Pin down the failure

Read what the user wrote. If it doesn't already answer all three of:
- What did you expect to happen?
- What actually happened?
- When did it start, or what changed right before?

…then ask **one** clarifying question. Don't run a survey. Aim for a single short sentence describing the failure you can repeat back to the user.

### Step 2 — Localize

You need a short list of files / functions where the bug most likely lives. Useful tools:

- `grep` and `glob` for exact strings the user pasted (error messages, function names, log tokens)
- `git log --oneline -n 30` and `git diff HEAD~5..HEAD` for recent activity, especially if the user said "it broke today"
- `read` on the smallest module that owns the failing behavior

If the bug is in a running process rather than in code, also collect:
- Recent log output (look in `~/.kursor/`, `~/.opencode/`, app-specific log paths)
- Process snapshot (`ps`, `lsof -p`, `netstat`)

Stop when you can name one or two specific call sites that are the prime suspects.

### Step 3 — State a single hypothesis

Write down one concrete cause-and-effect claim, like:

> `parseConfig` returns `undefined` when the config key contains a dot,
> because the dot triggers the nested-path branch at `src/config.ts:84`,
> which then silently fails the lookup.

Tie it to specific code, ideally with `path:line`. Avoid "maybe it's X, or maybe Y". A list of possibilities is the absence of a hypothesis.

If you genuinely have no candidate after one pass through Step 2, do not invent one. Ask the user **one** targeted question.

### Step 4 — Validate cheaply

Before you change any code, try to confirm or refute the hypothesis with the cheapest experiment you can run:

- Re-read the suspect function with surrounding context
- A throwaway shell command (`node -e`, `python -c`, `bun run`, `git blame`)
- A temporary log/print only if the question can't be answered any other way

If the experiment refutes the hypothesis, return to Step 3. Do not just patch over what you saw.

### Step 5 — Fix

Apply the smallest change that addresses the **root cause**, not the visible symptom. Symptom patches are how the bug comes back next month with a different name.

Then verify, in this order:
1. The original reproduction no longer fails.
2. The relevant tests still pass — find the test command in `package.json`, `Makefile`, `pyproject.toml`, etc.
3. If the failure mode wasn't already covered by a test, **add one before the fix lands**.

### Step 6 — Hand back

A debug session ends with a short, structured note to the user:

- **Root cause** — one or two sentences
- **Files changed** — bullet list with one line per file
- **Verification** — what test you ran, what the original reproduction now shows
- **Leftovers** — anything you noticed but did not touch (related smells, similar code paths that might have the same bug)

## Hard rules

- No speculative edits. Every change must be backed by evidence from Step 4.
- Do not piggyback unrelated lint / style cleanup onto a debug patch — keep the diff readable.
- If something about the user's environment matters (OS, runtime version, env vars), confirm it; don't assume.
- After two rounds without a viable hypothesis, **stop and ask** rather than thrash.
