# Skillify

Distill what just happened in this session into a reusable `SKILL.md` that the user can invoke later.

## Step 1 — Mine the session

Before asking anything, look back at what actually happened:

- What concrete process was repeated, even informally? (the "thing we just did")
- What inputs or arguments did it take?
- What were the distinct, ordered phases?
- What artifact or signal proved each phase worked?
- **Where did the user correct, steer, or push back?** These moments capture preferences and almost always belong in `Rules`.
- Which tools and permissions were needed?
- Were any sub-agents used? For what?

If after this pass you cannot point to a repeatable process, stop and tell the user — there is nothing to skillify.

## Step 2 — Confirm with the user, in rounds

Use the `question` tool (not freeform prose). Iterate as needed, but stop as soon as the picture is clear — don't over-interview a simple skill.

**Round A — Big picture**
- Propose a name and one-line description; ask the user to confirm or change either.
- Propose the goal and the success criteria for the skill as a whole.

**Round B — Shape**
- Show the step list you reconstructed in Step 1.
- Propose any arguments the skill should accept.
- Ask whether this skill should run **inline** (in the current conversation, so the user can intervene) or **forked** (in a fresh sub-agent context, for self-contained tasks).
- Ask where to save:
  - **This repo** → `.claude/skills/<name>/SKILL.md` (project-local; kursor auto-discovers this path)
  - **Global** → `~/.claude/skills/<name>/SKILL.md` (follows the user across all repos)

**Round C — Per-step (only the non-obvious ones)**
- What does this step produce that a later step depends on? (an ID, a path, a commit SHA, …)
- What confirms it succeeded?
- Should the user approve before proceeding? (anything irreversible: pushes, merges, destructive ops)
- Could it run in parallel with a sibling step?
- Any rule that must always / never apply?

**Round D — When to fire**
- When should this skill be auto-suggested? Give the user 2-3 candidate trigger phrases. Example: *"Use when the user wants to cherry-pick a PR onto a release branch. Cues: 'cp to release', 'hotfix this'."*

## Step 3 — Draft the SKILL.md

Use this skeleton. Drop any section that does not apply to the skill at hand — small skills should look small.

```markdown
---
name: <skill-name>
description: <one-line trigger description for auto-invocation>
---

# <Skill title>

<one short paragraph: what this skill does and when>

## Inputs
- `$arg_name` — description (omit the section if there are no arguments)

## Goal
A concrete statement of what "done" looks like, including the artifact(s) produced.

## Steps

### 1. Step title
What to do. Be precise — include exact commands or tool calls when possible.

**Success criteria** (required on every step) — what proves we can move on.

### 2. …
```

**Optional per-step annotations**, used only when they add value:
- `Execution` — `Direct` (default), `Task agent`, or `[human]` (user does it themselves)
- `Artifacts` — what later steps will consume
- `Human checkpoint` — pause for user approval (mandatory for irreversible actions)
- `Rules` — hard constraints, ideal place to record user corrections

**Notation conventions**:
- Parallel sub-steps use letters: `3a`, `3b`.
- A step the user owns gets `[human]` in its title.
- Keep simple skills simple. A two-step skill does not need annotations on every step.

## Step 4 — Confirm, save, hand off

Show the full `SKILL.md` to the user inside a fenced `markdown` block so they can read it with syntax highlighting. Use `question` to ask:

> Save this skill?
> - **Yes, save** — write to the chosen path
> - **Edit and re-show** — apply user feedback, draft again
> - **Cancel** — abandon

After writing, tell the user:
- The exact path the file was written to
- How to trigger it later (via the `skill` tool, or the auto-invocation phrases)
- That they can edit `SKILL.md` directly to tune it

## Hard rules

- Anywhere the user corrected you during the session is almost certainly a `Rule` — capture it.
- Do not annotate trivial steps just to fill the template.
- Never invent a step that did not happen in the session.
- If the session lacked a repeatable process, say so and stop — do not manufacture one.
