# Building kursor installers (`.dmg` / `.exe`)

This document explains how to produce installable artifacts you can hand to
other people:

- macOS — `.dmg` (Apple Silicon **and** Intel)
- Windows — `.exe` NSIS one-click installer (x64 **and** ARM64)
- Linux — `.AppImage`, `.deb`, `.rpm` (optional)

All builds are driven by [`electron-builder`](https://www.electron.build/) and
the per-package config at `packages/desktop/electron-builder.config.ts`.

---

## 0. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [bun](https://bun.sh) | 1.3.x (see `packageManager` in `package.json`) | required |
| Node.js | ≥ 22 | used by `electron-builder` internally |
| macOS | 13+ on Apple Silicon | for building macOS .dmg natively |
| `curl`, `tar` | system defaults | for fetching Windows native modules |

You do **not** need:

- Wine — `electron-builder` auto-downloads a small bundled wine to build
  Windows installers from macOS.
- An Apple Developer ID — builds are signed ad-hoc / unsigned (Gatekeeper
  warning on first run, easy to dismiss).
- A Windows code-signing certificate — Windows shows SmartScreen warning,
  easy to dismiss.

---

## 1. Install dependencies

```bash
bun install
```

This also runs `packages/opencode/script/fix-node-pty.ts` (chmod for the
pty helper on macOS / Linux).

---

## 2. One-command build (recommended)

From the repo root:

```bash
bun run package:all
```

This runs, in order:

1. `bun run build:desktop` → `electron-vite build` with `OPENCODE_CHANNEL=prod`
2. `bun run package:mac`   → produces `.dmg` + `.zip` for the host arch
3. `bun run package:win`   → fetches Windows native modules then produces `.exe`

Output lands in `packages/desktop/dist/`:

```
kursor-desktop-mac-arm64.dmg    # Apple Silicon Macs
kursor-desktop-mac-x64.dmg      # Intel Macs
kursor-desktop-win-x64.exe      # Windows x64 installer
kursor-desktop-win-arm64.exe    # Windows ARM64 installer
```

Each `.dmg` / `.exe` is around 120–150 MB and **self-contained** — it
includes the Electron runtime, the kursor renderer, and the agent sidecar
(`packages/opencode`).

---

## 3. Build individual targets

### macOS only

```bash
# both archs
bun run package:mac

# specific arch
bun --cwd packages/desktop run package:mac:arm64
bun --cwd packages/desktop run package:mac:x64
```

### Windows only

```bash
# both archs (auto-installs Windows native modules first)
bun run package:win

# specific arch
bun --cwd packages/desktop run prepare:win-natives
bun --cwd packages/desktop run package:win:x64
bun --cwd packages/desktop run package:win:arm64
```

> **Why `prepare:win-natives`?**  Bun (correctly) skips
> `optionalDependencies` whose `os` / `cpu` does not match the host. To
> cross-build a Windows installer from macOS, `packages/desktop/scripts/install-win-natives.ts`
> fetches the Windows-only native packages
> (`@lydell/node-pty-win32-x64`, `@parcel/watcher-win32-x64`, …)
> directly from the npm registry and unpacks them into the local
> `node_modules` so `electron-builder` can find them.

### Linux only

```bash
bun run package:linux
```

---

## 4. Channels (dev / beta / prod)

The build supports three channels controlled by `OPENCODE_CHANNEL`:

| Channel | App name | App ID | Icons |
|---|---|---|---|
| `dev`  | "kursor Dev"  | `ai.kursor.desktop.dev`  | `packages/desktop/icons/dev/` |
| `beta` | "kursor Beta" | `ai.kursor.desktop.beta` | `packages/desktop/icons/beta/` |
| `prod` | "kursor"      | `ai.kursor.desktop`      | `packages/desktop/icons/prod/` |

The default for the `bun run package:*` scripts at the repo root is `prod`.
Override it like this:

```bash
OPENCODE_CHANNEL=beta bun run package:all
```

Different channels can be installed side-by-side because they use
different app IDs and `userData` directories.

---

## 5. Distributing to other people

After running `bun run package:all`, send your users:

| Platform | File |
|---|---|
| Apple Silicon Mac | `kursor-desktop-mac-arm64.dmg` |
| Intel Mac         | `kursor-desktop-mac-x64.dmg` |
| Windows 10/11 x64 | `kursor-desktop-win-x64.exe` |
| Windows on ARM    | `kursor-desktop-win-arm64.exe` |

### First-run on macOS (ad-hoc-signed)

The .dmg is **not** signed with an Apple Developer ID, so Gatekeeper will
complain on first launch. Tell your user to either:

1. **Right-click the app → Open → Open** (one-time bypass), or
2. Run in Terminal: `xattr -dr com.apple.quarantine /Applications/kursor.app`

### First-run on Windows (unsigned)

Microsoft SmartScreen will say "Windows protected your PC". Tell your
user to click **More info → Run anyway**.

---

## 6. Build output reference

After a full build, `packages/desktop/dist/` contains:

```
dist/
├── kursor-desktop-mac-arm64.dmg          # ← give to Apple Silicon users
├── kursor-desktop-mac-arm64.dmg.blockmap # (auto-updater delta files)
├── kursor-desktop-mac-arm64.zip          # for the auto-updater
├── kursor-desktop-mac-arm64.zip.blockmap
├── kursor-desktop-mac-x64.dmg            # ← give to Intel Mac users
├── kursor-desktop-mac-x64.dmg.blockmap
├── kursor-desktop-mac-x64.zip
├── kursor-desktop-mac-x64.zip.blockmap
├── kursor-desktop-win-x64.exe            # ← give to Windows x64 users
├── kursor-desktop-win-x64.exe.blockmap
├── kursor-desktop-win-arm64.exe          # ← give to Windows ARM users
├── kursor-desktop-win-arm64.exe.blockmap
├── builder-debug.yml                     # diagnostic, safe to delete
├── mac-arm64/        # raw .app bundle
├── mac/              # raw .app bundle (x64)
├── win-unpacked/     # raw Win x64 directory build
└── win-arm64-unpacked/
```

Only the `.dmg` and `.exe` files need to be shipped to end users.

---

## 7. Troubleshooting

### "missing optional dependencies … node-pty-win32-x64"

You did not run `prepare:win-natives` before `package:win`. The repo-root
`bun run package:win` script does this automatically; the
`bun --cwd packages/desktop run package:win` script does not.

### `app-update.yml` error in `~/Library/Logs/@opencode-ai/desktop/main.log`

Harmless. The auto-updater is enabled for the `prod` channel and looks
for a `latest-mac.yml` / `latest.yml` release feed that you have not
published. The app still launches and works.

### Sidecar fails to start in the packaged app

Check `~/Library/Logs/@opencode-ai/desktop/main.log` (macOS) or
`%APPDATA%\@opencode-ai\desktop\logs\main.log` (Windows). The sidecar
binary is at `Contents/Resources/app.asar/out/main/sidecar.js` (the
bundled `packages/opencode` code path).

### "kursor.app is damaged" on macOS

The user opened a `.dmg` that was transferred without `xattr` quarantine
clearing. Tell them to run:

```bash
xattr -dr com.apple.quarantine /Applications/kursor.app
```

or right-click → Open the first time.
