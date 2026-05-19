# Quickstart

## 1. Install dependencies

```bash
bun install
```

This runs the workspace install + a `postinstall` that fixes `node-pty` permissions on macOS/Linux.

## 2. Launch the desktop app

```bash
bun dev:desktop
```

This will:

1. Run `packages/desktop/scripts/predev.ts` — copies dev icons, generates `models-snapshot.js`, and builds the agent runtime into `packages/opencode/dist/node/node.js`.
2. Run `electron-vite dev` — compiles main/preload bundles and starts the Solid renderer dev server on `http://localhost:5173`.
3. Launch Electron, which spawns the local agent server (sidecar) on a random `127.0.0.1` port, secured by Basic Auth with a freshly generated UUID password (passed to the renderer via IPC).

You should see logs like:

```
sidecar connection started { url: 'http://127.0.0.1:NNNNN' }
init step { step: { phase: 'done' } }
server ready { url: 'http://127.0.0.1:NNNNN' }
```

## 3. Configure a provider (Anthropic / OpenAI)

After the window opens, use the in-app UI:

- Click the model selector (top-right of the input composer).
- "Connect provider" → pick Anthropic or OpenAI (or any of: Google, Bedrock, Vertex, Groq, Mistral, xAI, OpenRouter, Cerebras, Cohere, Perplexity, etc.).
- Paste your API key.

Keys are stored locally in the OS keychain via `electron-store`, not in plaintext config.

Relevant components if you need to customize:

- `packages/app/src/components/dialog-connect-provider.tsx`
- `packages/app/src/components/dialog-custom-provider.tsx`
- `packages/app/src/components/settings-providers.tsx`

## 4. Try the agent

Type a message in the composer. The default agent is **build** (full access). Switch to **plan** via the agent selector to enter a read-only planning mode.

Built-in tools that should work out-of-the-box (see `packages/opencode/src/tool/registry.ts`):

| Tool | Purpose |
|---|---|
| `read` | Read file or directory listing with offset/limit |
| `write` | Create / overwrite a file |
| `edit` | String-replacement edit |
| `apply_patch` | Multi-file unified-diff patches (preferred for GPT models) |
| `grep` | Ripgrep search |
| `glob` | File pattern matching |
| `shell` | Bash / PowerShell execution with permission gating |
| `task` | Spawn a sub-agent (e.g. `explore`, `general`) |
| `todo` | Manage the agent's TODO list |
| `fetch` | Fetch URL content |
| `search` | Web search (requires Exa or Parallel key, or OpenCode Zen provider) |
| `skill` | Load a skill (workflow / domain knowledge) |

Permission flow: when a tool wants to do something that's not pre-allowed, the renderer's permission dock pops up (`packages/app/src/pages/session/composer/session-permission-dock.tsx`).

## 5. Configuration files

Per-project config: `.opencode/config.json` (still named `opencode` internally for compatibility; will be renamed in a later phase).

Global state directories:

- macOS: `~/Library/Application Support/ai.kursor.desktop.dev/`
- Linux: `$XDG_DATA_HOME/ai.kursor.desktop.dev/`
- Windows: `%APPDATA%/ai.kursor.desktop.dev/`

Sessions / state DB: a SQLite database at the platform's XDG data home under `opencode/opencode.db`.

## 6. Useful dev flags

| Env var | Effect |
|---|---|
| `OPENCODE_CHANNEL=dev` | Default — dev branding |
| `OPENCODE_PORT=12345` | Force sidecar port |
| `OPENCODE_TEST_ONBOARDING=1` | Run with an ephemeral data directory (`/tmp/...`) for testing first-run flow |
| `OPENCODE_DB=:memory:` | In-memory SQLite (no persistence) |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE=1` | Expose `plan_enter` / `plan_exit` tools on the CLI (desktop already exposes plan via agent selector) |
| `OPENCODE_EXPERIMENTAL_SCOUT=1` | Enable scout subagent + repo_clone/repo_overview tools |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL=1` | Expose `lsp` tool to the model |

## 7. Just the CLI

For a TUI-only experience without Electron:

```bash
bun dev
```

This boots `packages/opencode/src/index.ts` directly with the `browser` condition; it'll run an opentui terminal interface.

## 8. Browser-only (no Electron)

If you want to use the web UI in an ordinary browser — for instance, to access kursor running on a remote machine over SSH — use `dev:web` instead of `dev:desktop`:

```bash
bun run dev:web
```

This starts **two** processes in parallel and prefixes their logs:

- `[server]` — sidecar listening on `http://127.0.0.1:4096`
- `[front]`  — Vite dev server on `http://localhost:3000` (or the next free port)

Open `http://localhost:3000` in your browser. The "Open project" button opens a server-backed directory browser (loopback-only `/fs/*` API) so you can pick any folder visible to the sidecar process. The desktop Electron app is **not** required.

### Remote machine over SSH

Forward both ports — the frontend port AND the sidecar port — because the browser-side JS calls the sidecar at `localhost:4096` and that has to land on the remote box, not on your laptop:

```bash
ssh -L 3000:localhost:3000 -L 4096:localhost:4096 user@remote
# on the remote:
bun run dev:web
```

Then open `http://localhost:3000` locally. The `Host` header still reads `localhost`, so the sidecar's loopback-only `/fs/*` routes accept the request through the tunnel.

### Caveats

- Only one sidecar may listen on `4096` at a time — close any other `kursor` desktop app or running `bun run dev:web` before starting a new one.
- `dev:web` runs the sidecar **without** a password (`OPENCODE_SERVER_PASSWORD` unset) for convenience. The `127.0.0.1` bind means only your local user (or, via SSH tunnel, you remotely) can reach it, but anyone else on a shared machine could too. Set `OPENCODE_SERVER_PASSWORD=...` to enable Basic auth.
- The frontend reads `VITE_OPENCODE_SERVER_HOST` / `VITE_OPENCODE_SERVER_PORT` env vars at build time. Default is `localhost:4096`; override only if you have a custom sidecar setup.
