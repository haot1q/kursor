# Remember

Audit the user's memory / instruction files and produce a **proposal** — never apply edits directly. The user must approve each suggestion before anything is written.

## What we're trying to produce

A short, easy-to-scan report grouped by *what kind of action* the user would need to take. The user should be able to read it and say "yes / yes / no / yes" without having to figure out where each piece of advice belongs.

## Procedure

### 1. Collect every memory layer that exists

Read each of these if present; skip quietly if not:

| Layer | Location | What it's for |
|---|---|---|
| Project agent guide | `AGENTS.md` | Conventions any agent should follow in this repo |
| Project personal | `AGENTS.local.md` | Per-user notes about this repo, usually gitignored |
| Legacy Claude file | `CLAUDE.md` | Older Claude-style instructions, if a prior workflow used them |
| Global personal | `~/.config/kursor/AGENTS.md` or `~/.opencode/AGENTS.md` | Preferences that follow the user across repos |
| In-session memory | Notes the agent captured during this conversation | Volatile working notes |

After this step you should be able to compare layers against each other.

### 2. Classify each non-trivial entry

For every meaningful entry in the session notes (or the most volatile layer you found), decide where it logically belongs:

| Destination | Belongs here |
|---|---|
| `AGENTS.md` | Project conventions every agent should follow — commands, code style, file layout, "use bun, not npm" |
| `AGENTS.local.md` | User-private project preferences — "don't auto-commit", "always ask before pushing", review style |
| `~/.config/kursor/AGENTS.md` | Personal preferences across all projects — tone, response style, default tools |
| Stay put | Truly session-only context, half-formed patterns, unclear cases |

Workflow rules (branching, PR conventions, merge strategy) are often ambiguous between "team rule" and "personal preference" — mark these as `ambiguous` and ask the user.

When in doubt, ask. Do not guess at where something belongs.

### 3. Look for cross-layer issues

Sweep across all the layers and flag:

- **Duplicates** — something captured in a volatile layer that's already in a permanent one → propose dropping from the volatile side
- **Stale** — an older entry contradicted by a newer one → propose updating the old layer
- **Conflicts** — two layers disagreeing on the same topic → propose a resolution, usually preferring the more recent + more specific entry

### 4. Hand the user a clean report

Group everything by *action*, not by *source layer*:

1. **Promote** — move from volatile to permanent. One line per item: source → destination → why.
2. **Tidy up** — duplicates, stale entries, conflicts.
3. **Need your call** — ambiguous items the user has to disambiguate.
4. **Leaving alone** — short note for transparency.

If there is no session memory and no volatile notes worth promoting, say so clearly and offer to lightly audit `AGENTS.md` for clutter instead.

## Hard rules

- All proposals must be presented before any file is written.
- Never modify a file without explicit per-item approval.
- Do not create a new file unless the user agreed and the target path is empty.
- Ambiguous entries must be flagged, not guessed.
