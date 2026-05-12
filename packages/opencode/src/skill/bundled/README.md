# Bundled skills

Each `*.md` in this directory is a built-in workflow loaded at runtime via Bun's `text` import in `../index.ts`. Registration metadata (name + description) lives in the `BUILTIN_SKILLS` array in [../index.ts](../index.ts).

| File | Skill name | When to use |
|---|---|---|
| `debug.md` | `debug` | Diagnose a bug, exception, or unexpected behavior |
| `simplify.md` | `simplify` | Review and clean up recent changes (reuse / quality / efficiency) |
| `remember.md` | `remember` | Audit and reorganize AGENTS.md / personal memory layers |
| `stuck.md` | `stuck` | Diagnose a frozen/slow process (no killing) |
| `batch.md` | `batch` | Plan and execute a sweeping mechanical change across many files in parallel |
| `skillify.md` | `skillify` | Capture this session's process as a new SKILL.md |
| `write-tests.md` | `write-tests` | Add tests for a function/module matching project conventions |
| `review-pr.md` | `review-pr` | Produce a prioritized review of a PR or local diff |

The pre-existing `customize-opencode` skill lives at `../prompt/customize-opencode.md` (kept there for backwards compatibility).

## How discovery works

1. At `Skill.Service` init, every entry in `BUILTIN_SKILLS` is registered into the in-memory skills map with `location: "<built-in>"`.
2. Then disk discovery runs — it scans:
   - `~/.claude/skills/**/SKILL.md`
   - `~/.agents/skills/**/SKILL.md`
   - `<project>/.claude/skills/**/SKILL.md`
   - `<project>/.agents/skills/**/SKILL.md`
   - opencode config directories' `{skill,skills}/**/SKILL.md`
   - paths and URLs from `opencode.json` → `skills.paths` and `skills.urls`
3. **A disk-loaded skill with the same name overrides a built-in one** (built-ins are registered first; `add()` warns but overwrites).

So a user can edit a built-in skill by creating `~/.claude/skills/debug/SKILL.md` and the bundled one will be silently replaced.

## Adding a new bundled skill

1. Drop a markdown file in this directory.
2. Add an entry to `BUILTIN_SKILLS` in [../index.ts](../index.ts) with the appropriate `description` (this string is shown to the LLM for auto-invocation decisions — keep it action-oriented and trigger-rich, e.g. "Use when …").
3. Add the corresponding `import` near the top of `index.ts` using `with { type: "text" }`.
4. Rebuild the agent core: `cd packages/opencode && bun script/build-node.ts`.

## Style guide for SKILL.md bodies

- Lead with the goal in one sentence.
- Number the steps. Each step has a one-line **Success criteria** the model can recognize.
- Put hard constraints in a final **Rules** section ("Do NOT …", "Always …").
- No Anthropic-internal references, no `USER_TYPE === 'ant'`, no Slack channel IDs, no fictional teammates.
- Reference tool names by their opencode IDs (`task`, `read`, `shell`, `grep`, `glob`, `edit`, `write`, `apply_patch`, `fetch`, `search`, `todo`, `question`, `skill`).
- The skill format (YAML frontmatter + Markdown body, discovered from `.claude/skills/` or `.agents/skills/`) follows the broader skill-format convention used across several coding agents, so users can move skills between tools.
