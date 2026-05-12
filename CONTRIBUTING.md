# Contributing to kursor

Thanks for your interest in kursor! This guide is intentionally short — open an issue or PR and we'll figure out the rest together.

## Quick start

```bash
bun install
bun dev:desktop     # launches Electron + sidecar
```

If `bun dev:desktop` doesn't work, open an issue with the output and your OS / version info.

## Where to find things

| Path | What it is |
|---|---|
| `packages/opencode` | Agent core: tool registry, session, provider, permission, skill, MCP, LSP, HTTP API |
| `packages/desktop`  | Electron main / preload / renderer entry, sidecar management |
| `packages/app`      | The Solid.js GUI |
| `packages/core`     | Shared infrastructure (FS, schema, globals) |
| `packages/sdk`      | HTTP client SDK consumed by the renderer |
| `packages/ui`       | Shared UI components |
| `packages/plugin`   | Plugin / extension framework |
| `packages/script`   | Build helper lib |

## Style

See [`AGENTS.md`](./AGENTS.md) — that's also the file the agent reads when it works in this repo, so the conventions there are enforced both by humans and by tooling.

Highlights:

- `bun` only — no `npm` / `yarn` / `pnpm`.
- Effect-TS on the server side; SolidJS on the client side.
- Run `bun typecheck` from the package directory before pushing — **not** `tsc` directly, **not** from the repo root.
- Tests run from inside `packages/<name>/`, not from the repo root.

## Filing issues

When you file an issue:

- Include the kursor version (`package.json` → `version`) or your last `git log -1 --oneline`.
- Include your OS + architecture (Intel / Apple Silicon / Linux / Windows).
- For runtime bugs, include the relevant block from the Electron dev logs (`Cmd+Opt+I` → Console).

## Pull requests

- One logical change per PR. Split unrelated cleanups out.
- Run `bun typecheck` and any nearby tests before opening.
- If the change adds a built-in skill, slash command, or tool, add a one-line entry in the appropriate registry (see `packages/opencode/src/skill/index.ts` and similar).
- Don't widen the diff with unrelated formatting changes — let the existing linter own that.

## Credits to upstream

kursor builds on [opencode](https://github.com/anomalyco/opencode) (MIT). When you fix something that originated upstream and isn't kursor-specific, consider sending the fix upstream as well — that helps both projects.
