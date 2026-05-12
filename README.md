# kursor

A **local-first, GUI coding agent**. Cursor-style three-column layout, runs entirely on your machine, talks to whichever LLM provider you configure, fully hackable.

> kursor is an independent project. It is not affiliated with or endorsed by Anysphere (Cursor) or Anthropic (Claude / Claude Code). It is built on top of the open-source [opencode](https://github.com/anomalyco/opencode) project (MIT licensed) and is inspired at the design level by the broader generation of coding agents — Cursor, Aider, Cody, Continue, Claude Code, and others.

## What's inside

- **Electron** desktop shell with three resizable columns: file tree on the left, code / file viewer in the middle, chat on the right (toggleable).
- **Local HTTP sidecar** running the agent core — the GUI talks to it over HTTP/SSE.
- **Multi-provider** AI via the [Vercel AI SDK](https://sdk.vercel.ai): Anthropic, OpenAI, Google, Bedrock, Vertex, Groq, Mistral, xAI, OpenRouter, Cerebras, plus any OpenAI-compatible local endpoint.
- **Skills** — markdown workflows the agent can auto-invoke (`debug`, `simplify`, `remember`, `batch`, `stuck`, `skillify`, `write-tests`, `review-pr`).
- **Slash commands** — `/commit`, `/diff`, `/compact`, `/memory`, …
- **Tooling** — read / edit / write / grep / glob / shell / patch / fetch / search / todo / question / task (sub-agent) / skill.
- **MCP** client + LSP integration baked in.

## Architecture

```
┌────────────────────────────────────┐
│  Electron Main (packages/desktop)  │
│  • spawns sidecar                  │
│  • loads renderer                  │
└──────────┬─────────────────────────┘
           │
   ┌───────┴────────┐
   ▼                ▼
┌──────────┐   ┌────────────────────────────┐
│ Renderer │◀─▶│  Local HTTP / SSE Server   │
│ (Solid)  │   │  (packages/opencode)       │
│ packages │   │  • agent engine            │
│  /app    │   │  • tool registry           │
└──────────┘   │  • session persistence     │
               │  • provider SDK            │
               │  • MCP / LSP / shell       │
               └──────────────┬─────────────┘
                              ▼
                  ┌────────────────────────┐
                  │  LLM providers, FS,    │
                  │  shell, git, MCP, ...  │
                  └────────────────────────┘
```

## Packages

| Path | Purpose |
|---|---|
| `packages/opencode` | Agent core: tool registry, session, provider, permission, skill, MCP, LSP, HTTP API |
| `packages/desktop` | Electron main / preload / renderer entry, sidecar management |
| `packages/app`     | Solid.js renderer (the actual GUI) |
| `packages/core`    | Shared infrastructure (FS, schema, globals) |
| `packages/sdk`     | HTTP client SDK consumed by renderer |
| `packages/ui`      | Shared UI components |
| `packages/plugin`  | Plugin / extension framework |
| `packages/script`  | Build helper lib |

## Dev

Requires [`bun`](https://bun.sh) (see the `packageManager` field in `package.json`).

```bash
bun install
bun dev:desktop   # launches Electron + sidecar (the full app)
bun dev:web       # launches just the renderer in a browser dev server
bun dev           # launches just the agent CLI (no GUI)
```

## Notes for contributors

- The agent core is written in [Effect-TS](https://effect.website/). Anything ported into kursor from elsewhere is **rewritten** in Effect-TS style, not pasted.
- Many internal symbols and env vars still carry the `opencode` / `OPENCODE_*` prefix from the upstream. Renames are deferred to avoid invalidating other people's data directories.

## Credits

- Built on top of [opencode](https://github.com/anomalyco/opencode), which is MIT licensed. See `LICENSE` and `NOTICE`.
- Design vocabulary (skills, slash commands, plan/build modes, sub-agent coordination, …) is shared across the broader coding-agent ecosystem; kursor implements them in its own way.

## License

MIT. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE) for full text and third-party attributions.
