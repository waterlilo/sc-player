# macOS Port and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `sc-player` to macOS with native window controls, Steam wallpaper support, background audio on close, and release packaging for DMG/ZIP.

**Architecture:** Maintain 100% backward compatibility with Windows by abstracting platform behaviors via `process.platform === 'darwin'`. Update `electron-builder` configuration in `package.json` to support macOS DMG/ZIP packaging and retain native `onnxruntime-node` darwin binaries. Adapt the main window titlebar and renderer chrome for macOS traffic lights, and integrate macOS lifecycle events (`activate`, hide on close).

**Tech Stack:** Electron 44, React 19, TypeScript 5.8+, Vite 8, Tailwind CSS v4, electron-builder, Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-03-macos-port-design.md`

---

## Global Constraints
- Target Node/Electron: Node 22+, Electron 44.7.2.
- Backward compatibility: Preserve all Windows functionality (`win32` checks, NSIS/portable targets, thumbar).
- Zero regressions in existing 46 unit tests (`node --test "src/**/*.test.ts"`).
- Type safety: Strict TypeScript across `tsconfig.node.json` and `tsconfig.web.json`.
- Distribution: DMG and ZIP artifacts produced in `dist/` for host architecture (`arm64` on Apple Silicon).

## Review Focus
1. **Window Close Behavior**: Red traffic light or Cmd+W must hide the window rather than destroying it so audio continues playing, and clicking the Dock icon restores the window.
2. **TitleBar Layout Collision**: Traffic light buttons on macOS (top-left) must not overlap the back button or app logo; leading offset of ~72px is applied on macOS only.
3. **Native ML Addon Packaging**: `onnxruntime-node` binary for `darwin` must be included in `files` packaging rule so Whisper speech alignment works on macOS.
4. **Squirrel.Mac Signature Rejection**: In-app updater must not trigger Squirrel.Mac signature validation errors on unsigned macOS builds; fallback to notification with GitHub download link.
5. **Steam Path Fallback**: Steam wallpaper path resolution must not crash or fail if Steam is not installed at `~/Library/Application Support/Steam`.

---

## Implementation Tasks

### Task 1: Project Dependencies & Native Binary Packaging Configuration

**Files:**
- Modify: `package.json`
- Modify: `scripts/dist.mjs`

**Interfaces:**
- Consumes: `package.json` build config, `scripts/dist.mjs`
- Produces: Updated build configuration with macOS targets (`dmg`, `zip`) and platform-aware `dist.mjs`

- [ ] **Step 1: Install project dependencies**
  Run `npm install` in the project root to install dependencies and compile local node modules for macOS.

- [ ] **Step 2: Update `package.json` files and mac build targets**
  In `package.json`:
  1. Under `build.files`, update the onnx exclusion to keep `darwin`:
     ```json
     "!node_modules/onnxruntime-node/bin/napi-v6/linux/**",
     "!node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**",
     "!node_modules/onnxruntime-node/bin/napi-v6/win32/x64/{DirectML.dll,dxcompiler.dll,dxil.dll}",
     ```
  2. Add `build.mac` and `build.dmg`:
     ```json
     "mac": {
       "icon": "build/icon.png",
       "target": [
         { "target": "dmg" },
         { "target": "zip" }
       ],
       "category": "public.app-category.music",
       "hardenedRuntime": false,
       "gatekeeperAssess": false
     },
     "dmg": {
       "contents": [
         { "x": 130, "y": 220 },
         { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
       ],
       "window": { "width": 540, "height": 380 }
     }
     ```

- [ ] **Step 3: Update `scripts/dist.mjs` for cross-platform packaging**
  In `scripts/dist.mjs`, detect `process.platform`:
  - If `process.platform === "darwin"`: pass `--mac`, `dmg`, `zip`, `--${process.arch}`, `-c.mac.artifactName=sc-player-${short}-${process.arch}.\${ext}`.
  - If `process.platform === "win32"`: keep original `--win`, `nsis`, `portable` flags.
  - Allow override flags from `process.argv`.

- [ ] **Step 4: Verify typecheck passes**
  Run: `npm run typecheck`
  Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**
  ```bash
  git add package.json scripts/dist.mjs
  git commit -m "build: add macOS target and update distribution script for darwin"
  ```

---

### Task 2: Main Window Title Bar, Traffic Lights, and macOS Close Lifecycle

**Files:**
- Modify: `src/main/windows/main-window.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Electron `BrowserWindow`, `app`
- Produces: Correct window frame options and close/activate handling for macOS

- [ ] **Step 1: Configure `BrowserWindow` options for macOS in `src/main/windows/main-window.ts`**
  In `createMainWindow`:
  - If `process.platform === "darwin"`:
    - `titleBarStyle: "hiddenInset"`
    - `trafficLightPosition: { x: 14, y: 12 }`
    - Do not set `titleBarOverlay`.
  - Else (Windows/Linux):
    - Keep `titleBarStyle: "hidden"`
    - Keep `titleBarOverlay: { color: "#00000000", symbolColor: "#00000000", height: TITLEBAR_HEIGHT }`.

- [ ] **Step 2: Implement hide-on-close for macOS in `src/main/windows/main-window.ts`**
  In `win.on("close", (e) => { ... })`:
  - On macOS (`process.platform === "darwin"`): if not `opts.quitting()`, prevent default and call `win.hide()`, even if `opts.closeToTray()` is false, preserving music playback and standard macOS app conventions.

- [ ] **Step 3: Update `src/main/index.ts` for macOS app lifecycle and menu**
  In `src/main/index.ts`:
  1. Only quit in `window-all-closed` if `process.platform !== "darwin"`.
  2. Register `app.on("activate")`:
     ```ts
     app.on("activate", () => {
       if (mainWindow) {
         if (mainWindow.isMinimized()) mainWindow.restore();
         mainWindow.show();
         mainWindow.focus();
       }
     });
     ```
  3. On macOS (`process.platform === "darwin"`), set up a native application menu via `Menu.setApplicationMenu(Menu.buildFromTemplate([...]))` containing:
     - App Menu (`sc player`): About, Separator, Hide, Hide Others, Show All, Separator, Quit (`Cmd+Q`).
     - Edit Menu: Undo, Redo, Cut, Copy, Paste, Select All (enables standard hotkeys in text inputs).
     - Window Menu: Minimize, Zoom, Close Window.

- [ ] **Step 4: Verify typecheck passes**
  Run: `npm run typecheck`
  Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**
  ```bash
  git add src/main/windows/main-window.ts src/main/index.ts
  git commit -m "feat(main): add macOS traffic light positioning, hide-on-close, and app menu"
  ```

---

### Task 3: Expose Platform to Renderer & Adapt TitleBar Layout

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/renderer/src/components/chrome/TitleBar.tsx`
- Test: `src/renderer/src/components/chrome/TitleBar.test.ts` (or platform check unit test)

**Interfaces:**
- Consumes: `process.platform` in preload / IPC
- Produces: `window.sky.platform` accessible in renderer, responsive TitleBar layout

- [ ] **Step 1: Expose platform in `src/shared/ipc.ts` and `src/preload/index.ts`**
  In `src/shared/ipc.ts`, add `platform: NodeJS.Platform` to `SkyBridge`.
  In `src/preload/index.ts`, add `platform: process.platform` to `bridge`.

- [ ] **Step 2: Write unit test for platform detection in `src/shared/platform.test.ts`**
  Create `src/shared/platform.test.ts`:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";

  test("isMac helper returns true on darwin platform", () => {
    const isMacPlatform = (p: string) => p === "darwin";
    assert.equal(isMacPlatform("darwin"), true);
    assert.equal(isMacPlatform("win32"), false);
  });
  ```

- [ ] **Step 3: Run test to verify it passes**
  Run: `node --test src/shared/platform.test.ts`
  Expected: PASS.

- [ ] **Step 4: Adapt `TitleBar.tsx` for macOS**
  In `src/renderer/src/components/chrome/TitleBar.tsx`:
  - Check `const isMac = (typeof window !== "undefined" && window.sky?.platform === "darwin") || /Macintosh|Mac OS X/.test(typeof navigator !== "undefined" ? navigator.userAgent : "");`
  - In `TitleBar`:
    - On macOS, add `style={isMac ? { paddingLeft: "76px" } : undefined}` to `header` to avoid traffic light overlap.
    - Conditionally render `<WindowButtons />`: only render if `!isMac`.

- [ ] **Step 5: Verify typecheck and tests pass**
  Run: `npm run typecheck && npm test`
  Expected: PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add src/preload/index.ts src/shared/ipc.ts src/renderer/src/components/chrome/TitleBar.tsx src/shared/platform.test.ts
  git commit -m "feat(renderer): adapt TitleBar for macOS traffic lights and omit WindowButtons"
  ```

---

### Task 4: Steam Workshop Wallpapers & Menu Bar Tray on macOS

**Files:**
- Modify: `src/main/system/steam-wallpaper.ts`
- Modify: `src/main/system/tray.ts`
- Create: `src/main/system/steam-wallpaper.test.ts`

**Interfaces:**
- Consumes: Node `fs`, `path`, Electron `app`
- Produces: Cross-platform Steam library path resolution, proper macOS menu bar icon template

- [ ] **Step 1: Write unit test for steam library path resolution**
  Create `src/main/system/steam-wallpaper.test.ts`:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { workshopId } from "./steam-wallpaper";

  test("workshopId extracts valid id from steam url and raw numbers", () => {
    assert.equal(workshopId("1234567"), "1234567");
    assert.equal(workshopId("https://steamcommunity.com/sharedfiles/filedetails/?id=293847291"), "293847291");
    assert.equal(workshopId("invalid"), null);
  });
  ```

- [ ] **Step 2: Run test to verify it passes**
  Run: `node --test src/main/system/steam-wallpaper.test.ts`
  Expected: PASS.

- [ ] **Step 3: Implement macOS Steam path lookup in `src/main/system/steam-wallpaper.ts`**
  In `steam-wallpaper.ts`:
  - In `steamPath()`:
    ```ts
    function steamPath(): Promise<string | null> {
      if (process.platform === "darwin") {
        const macSteam = join(app.getPath("home"), "Library/Application Support/Steam");
        return Promise.resolve(existsSync(macSteam) ? macSteam : null);
      }
      return new Promise((done) => {
        execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true }, (err, out) => {
          const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
          done(m ? m[1]!.trim().replace(/\//g, "\\") : null);
        });
      });
    }
    ```

- [ ] **Step 4: Update Tray icon for macOS in `src/main/system/tray.ts`**
  In `createTray`:
  ```ts
  const trayIcon = icon.resize({ width: 16, height: 16 });
  if (process.platform === "darwin") {
    trayIcon.setTemplateImage(true);
  }
  tray = new Tray(trayIcon);
  ```

- [ ] **Step 5: Verify typecheck and tests pass**
  Run: `npm run typecheck && npm test`
  Expected: PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add src/main/system/steam-wallpaper.ts src/main/system/tray.ts src/main/system/steam-wallpaper.test.ts
  git commit -m "feat(system): add macOS Steam library lookup and template tray icon"
  ```

---

### Task 5: Updater Graceful Handling on Unsigned macOS Releases

**Files:**
- Modify: `src/main/system/updater.ts`
- Modify: `src/renderer/src/screens/settings/AboutSection.tsx` (or update status handler)

**Interfaces:**
- Consumes: Electron `autoUpdater` / `electron-updater`
- Produces: Safe update status handling on unsigned macOS without Squirrel.Mac signature errors

- [ ] **Step 1: Adapt `src/main/system/updater.ts` for macOS**
  In `src/main/system/updater.ts`:
  - When `process.platform === "darwin"`, avoid calling `autoUpdater.checkForUpdatesAndNotify()` with automatic downloading, because Squirrel.Mac will fail on unsigned applications.
  - Instead, use manual update check or configure:
    ```ts
    autoUpdater.autoDownload = false;
    ```
  - When an update is available on macOS, set update status to `available` and provide the release download link so the user can open it in their browser.

- [ ] **Step 2: Verify typecheck and tests pass**
  Run: `npm run typecheck && npm test`
  Expected: PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add src/main/system/updater.ts
  git commit -m "fix(updater): prevent Squirrel.Mac signature errors on unsigned macOS builds"
  ```

---

### Task 6: End-to-End Build, DMG Packaging & Runtime Verification

**Files:**
- Output: `dist/sc-player-*.dmg`, `dist/sc-player-*.zip`

**Interfaces:**
- Consumes: `npm run build`, `npm run dist`
- Produces: Functional `.dmg` and `.app` bundle on macOS

- [ ] **Step 1: Run full test suite, lint and typecheck**
  Run: `npm test && npm run typecheck && npm run lint`
  Expected: All 48+ tests pass, 0 type errors, 0 lint errors.

- [ ] **Step 2: Run build**
  Run: `npm run build`
  Expected: Successful compilation of main, preload, and renderer into `out/`.

- [ ] **Step 3: Run packaging script**
  Run: `node scripts/dist.mjs`
  Expected: `electron-builder` packages macOS `.dmg` and `.zip` for `arm64` in `dist/`.

- [ ] **Step 4: Verify packaged bundle contents**
  Check that:
  - `dist/mac-arm64/sc player.app` exists.
  - The DMG file exists in `dist/`.
  - Inside the app bundle, `Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64` exists.

- [ ] **Step 5: Verify runtime launch**
  Launch the app directly from `out/` or `dist/mac-arm64/sc player.app`:
  Confirm window displays, audio can buffer/play, and window controls function smoothly.

- [ ] **Step 6: Commit build verification artifacts or configs**
  ```bash
  git status
  ```

---

### Task 7: Documentation & Upstream PR Readiness

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: User documentation
- Produces: macOS installation instructions and Gatekeeper guidance

- [ ] **Step 1: Update `README.md`**
  In `README.md`:
  - Add macOS badge or mention in header: `Windows 10/11 & macOS (Apple Silicon / Intel)`.
  - In the **Install** section, document:
    - Download `sc-player-v…-arm64.dmg` (for Apple Silicon) or `.zip`.
    - If macOS says "app is damaged or cannot be opened" due to Gatekeeper: right-click and click **Open**, or run:
      ```bash
      xattr -cr "/Applications/sc player.app"
      ```
  - Document building from source on macOS: `npm install && npm run dev` / `npm run dist`.

- [ ] **Step 2: Run git diff audit against upstream `main`**
  Run: `git diff main`
  Confirm that:
  - All Windows code remains completely intact.
  - All changes are clean, self-contained, and documented.
  - No temporary debug files are tracked.

- [ ] **Step 3: Commit and summarize**
  ```bash
  git add README.md
  git commit -m "docs: add macOS installation and Gatekeeper instructions to README"
  ```
