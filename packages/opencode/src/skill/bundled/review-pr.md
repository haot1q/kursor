# Review PR

Produce an honest, prioritized review of a pull request or a local diff.

## Procedure

### 1. Pick up the diff

In order:

- If the user named a PR (`#123`, a URL, or a branch), use `gh pr view <id> --json files,title,body` plus `gh pr diff <id>`.
- Otherwise diff against the default branch: `git diff origin/main...HEAD` (find the actual default with `git symbolic-ref refs/remotes/origin/HEAD`).
- If nothing is staged or pushed yet, fall back to plain `git diff` on the working tree.

You should end this step holding the unified diff and, if any, the PR description.

### 2. Understand the intent

Read the PR description (or, locally, the recent commit messages). Distill in one sentence:

- What is the change *trying* to do?
- What is explicitly out of scope?

If the description is silent or ambiguous, ask the user **one** sharp question. Don't review a change whose intent you have to invent.

### 3. Read the affected files in context

For each file the diff touches, read enough surrounding code to know:

- The role of this module in the system
- Local conventions — naming, error handling, layering
- Any invariants the diff touches implicitly

Line-by-line review without surrounding context is how bad reviews are produced. Don't do it.

### 4. Score the findings by severity, honestly

Use exactly three buckets:

**Blocking** — must be addressed before merge
- Logic bugs: wrong condition, off-by-one, wrong default, missing nil/null check
- Security: injection, secret leakage, broken authz, unsafe deserialization
- Data loss: destructive operations without confirmation, silent overwrite
- Regression: an existing test or invariant is weakened or removed

**Important** — should be fixed, or have a clear answer
- Duplicates logic that already exists elsewhere
- Performance regression — hot path bloat, N+1, accidental quadratic
- Boundary handling — empty / huge inputs, concurrent access, error paths
- API design — misleading name, awkward parameter order, leaky abstraction
- Notable test gaps

**Nit** — polish, can ship without
- Naming
- Comment quality, especially narrating comments
- Tiny style deviations the local linter would have caught
- Dead code added by the diff

Resist the temptation to inflate findings to look thorough. Mis-categorizing a nit as "Important" is more damaging than missing a nit entirely.

### 5. Write it up

Use this layout (drop empty sections):

```
## Summary
<1-3 sentences: what the PR does and your overall take>

## Blocking
- file.ts:42 — <issue> → <suggested fix>
  …

## Important
- file.ts:78 — <issue> → <suggestion>
  …

## Nits
- …

## Worth noting (out of scope)
- …
```

Every finding cites a specific `path:line` (or `path:function`). No "this feels off" floating without an anchor.

If the diff is genuinely clean and your only findings are nits, **say so out loud**. Don't manufacture severity to look diligent.

### 6. Offer to apply the fixes

Ask the user if you should land the **Blocking** and **Important** items directly. Nits should stay as comments unless the user opts in.

## Hard rules

- Be concrete. "Maybe refactor this" without an alternative is noise.
- Don't grade for style if the repo already has a linter — let the linter own it.
- If you don't understand a piece of code, **ask**. Approving code you don't understand is worse than asking a question that sounds basic.
- Don't widen the review into adjacent files. Stick to the diff.
