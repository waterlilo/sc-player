# sc player — notes for coding agents and contributors

sc player is a free, unofficial SoundCloud desktop client (Electron + React + TypeScript) for Windows, macOS and Linux,
with its own small server (`server/`). These are the project's working rules. They apply to people and AI agents alike
(Claude Code, Codex, …).

## Ground rules

- **The core stays free.** Playback, likes, playlists, lyrics, friends, rooms, sync and accounts never go behind a
  payment or ads.
- **Nothing is pushed, released or deployed without the owner's explicit OK.** That covers pushing a branch,
  creating a GitHub release, and touching the live server. Committing locally and opening a pull request from a fork
  are fine.
- **Never test against the live server** (`*.sslip.io`): real people use it. Run your own copy (below). Security
  findings are reported privately, see [SECURITY.md](SECURITY.md).
- **No secrets in the repository.** The following files exist only on build machines and are git-ignored:
  - `proxy.local.json` and `server.local.json`: the built-in proxy and the server address;
  - `server/.env`.
- **SoundCloud's protections are respected.** No bot-detection evasion, no DRM decryption, and no downloading audio
  from third-party sources. DRM-only tracks are marked unavailable, or matched to another public upload by their sound.
- **Never copy code from projects without a compatible licence.** Ideas are fine. MIT/BSD code is fine, with credit.

## Layout

| Path | What |
|---|---|
| `src/main/` | Electron main process: SoundCloud client, lyrics, import, backup, social (messenger, rooms), system (tray, proxy, updates) |
| `src/preload/` | the bridge: only the IPC channels listed in `src/shared/ipc.ts` |
| `src/renderer/src/` | React UI (`screens/`, `components/`, `state/` stores, `i18n/en.ts` + `i18n/ru.ts`) |
| `src/shared/` | types and the IPC contract shared by both sides |
| `server/api/` | the API: Node 24, no dependencies, SQLite (`node:sqlite`) |
| `server/caddy/` | HTTPS + a forward proxy limited to SoundCloud's domains |
| `scripts/` | builds (`dist.mjs`), icons, stats |

## Running and checking

```bash
npm install
npm run dev                      # the app; add SKY_PROFILE=<name> for a separate data folder
npm run typecheck && npm run lint && npm test
```

- **Test instances use their own profile:** `SKY_PROFILE=test npm run dev` keeps its data in `%APPDATA%\sc player test`
  (or the platform's equivalent). Never run tests in, or change, a real user's installed app or its data. Delete test
  profiles afterwards.
- **`SC_API=http://127.0.0.1:8099`** points a dev build at a local server instead of the one in `server.local.json`.
- **The local server:**

  ```bash
  cd server/api
  DATA_DIR=./data-dev PORT=8099 TRUST_PROXY=0 ADMIN_TOKEN=dev-admin-token-0123456789 node src/main.ts
  node test/smoke.ts http://127.0.0.1:8099       # the whole API end to end
  ```

  More in `server/README.md`. The dev keys are examples. Real keys never appear in code, logs or chat.

## Conventions

- **Every user-facing string goes into both `i18n/en.ts` and `i18n/ru.ts`.** The UI is bilingual.
- **Comments say why, in full sentences.** Exported functions and components get a short doc comment that explains
  what they're for and any non-obvious behaviour. Follow the tone of the code around you.
- **Commit messages are one descriptive sentence about what changed for the user or the code.** Use no
  `feat:`/`fix:` prefixes. Write a body only when needed. Example: "Windows: the drawn window icons sit exactly in
  Windows' own button squares, so hover no longer lands off the icon".
- **Performance matters.** Measure CPU and RAM for any visual effect. Never animate an inherited custom property on
  `<html>` every frame.
- **Platforms:**
  - **Windows** uses the title bar overlay: Windows' own buttons sit under the page's drawn icons.
  - **macOS** shows traffic lights and needs macOS 13 or newer, because of Electron 44.
  - **Linux** uses the page's own buttons. Keep the AppImage on zstd with the static runtime
    (`toolsets.appimage`): xz made the app take 40 s to start.

## Branches and releases (owner-run)

- **Branches.** `main` is what users get. `v2` and `platforms` track it. Feature work goes in its own branch or
  worktree.
- **Pushing.** Push with `refs/heads/<branch>`: a tag named `v2` also exists.
- **Release names.** Releases are short: v2.3, v2.3.1. `package.json` keeps semver (2.3.0). `npm run dist` builds
  Windows. macOS and Linux come from the GitHub workflow "Build macOS and Linux".
- **Release notes** are bilingual (English, then "### На русском") and end with the community credit link used in
  previous releases.
- **`gh release create --target`** needs a branch name or a full commit SHA.
