# Design Document: macOS Port & DMG Packaging for sc-player

**Date:** 2026-11-03  
**Target Repository:** `waterlilo/sc-player`  
**Branch:** `feature/macos-support`  
**Status:** In Review  

---

## 1. Intent and Context

`sc-player` is an unofficial, feature-rich SoundCloud desktop client built using Electron 44, React 19, TypeScript, and Vite. Currently, it is targeted and configured exclusively for Windows 10/11 (NSIS installer and portable `.exe`, Windows Controls Overlay, registry lookups for Steam, Windows taskbar thumbnails).

The goal of this project is to port `sc-player` to macOS, providing a first-class macOS experience (DMG/ZIP packages, Apple Silicon & Intel support, native traffic lights, menu bar, and Steam library path) while preserving 100% backward compatibility with Windows so that all changes can be contributed upstream via a clean Pull Request.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **macOS Execution & Dev Mode:** Support running `npm run dev` and `npm run build` seamlessly on macOS (Darwin).
- **Native Window & Title Bar Layout:**
  - On macOS, use native window controls («traffic lights»: close, minimize, zoom) placed on the top-left with appropriate padding.
  - Suppress the Windows-specific minimize/maximize/close buttons on macOS so they do not duplicate or clutter the UI.
  - Maintain the draggable header area while ensuring traffic lights and navigation buttons remain clickable.
  - Keep existing Windows Controls Overlay behavior intact on Windows.
- **Audio & Offline ML Support (Whisper Alignment):**
  - Update `package.json` packaging rules to include `onnxruntime-node/bin/napi-v6/darwin/**` so offline lyrics sync works on macOS.
- **System Integration:**
  - **Steam Workshop Wallpapers:** Detect Steam library folders on macOS under `~/Library/Application Support/Steam` in addition to Windows registry lookups.
  - **macOS Menu & Dock:** Implement standard macOS application menu (Cmd+Q to Quit, Cmd+W to Close, Edit menu for text inputs) and handle `app.on("activate")` to restore the window when the Dock icon is clicked.
  - **Tray Icon:** Mark tray icon as template image on macOS so it adapts to dark/light menu bars.
- **Release Packaging:**
  - Add macOS configuration to `electron-builder` in `package.json` with `dmg` and `zip` targets for both `arm64` and `x64`.
  - Update `scripts/dist.mjs` to package macOS builds on macOS and Windows builds on Windows (or allow target flags).

### Non-Goals
- **Apple Developer ID Notarization / Paid Certificates:** As the original Windows project is self-distributed without code signing, macOS builds will not include paid Apple Developer certificates. Instructions for Gatekeeper bypass (`xattr -cr` or Right-click -> Open) will be documented in the README.
- **Linux Porting:** Out of scope for this milestone (can be addressed in a separate PR).
- **Core Engine Changes:** No changes to SoundCloud API communication, audio decoding pipelines, or data models.

### Anti-Goals
- **No Windows Regressions:** Under no circumstances should Windows behavior, styling, or build artifacts be broken or degraded.
- **No Bloated Architecture:** Avoid introducing heavy platform abstraction layers; use simple, standard Electron/Node platform checks (`process.platform === 'darwin'`).

---

## 3. Approaches Considered

### Approach 1: Clean Cross-Platform Abstraction (Selected)
- **Concept:** Keep unified codebase. Use `process.platform === 'darwin'` for runtime decisions (window titlebar style, Steam paths, tray icon template mode, dock activation). Extend `package.json` `build` configuration with a dedicated `mac` block while keeping the `win` block untouched. Make `scripts/dist.mjs` build for the host OS.
- **Trade-offs:** Requires careful conditional checking in both main and renderer processes, but results in a clean, minimal git diff that is easily acceptable by the upstream maintainer.

### Approach 2: macOS-Only Fork Overhaul (Rejected)
- **Concept:** Strip out Windows-specific code (registry calls, thumbar, WCO) and replace them with hardcoded macOS logic.
- **Trade-offs:** Faster to write for a personal build, but completely breaks Windows support, making upstream PR impossible.

### Approach 3: Minimal Build Shim (Rejected)
- **Concept:** Only fix compiler and electron-builder errors so that the app starts, without adjusting the title bar or window controls.
- **Trade-offs:** Results in broken UI (native traffic lights colliding with app logos, non-functional Windows buttons lingering on the right). Unacceptable user experience.

---

## 4. Technical Specifications & Architecture

### 4.1 Window Configuration (`src/main/windows/main-window.ts`)
- **macOS:**
  - `titleBarStyle: 'hiddenInset'`
  - `trafficLightPosition: { x: 14, y: 12 }`
  - Do NOT specify Windows-specific `titleBarOverlay` when on macOS.
- **Windows:**
  - Keep existing `titleBarStyle: 'hidden'` and `titleBarOverlay: { color: "#00000000", symbolColor: "#00000000", height: TITLEBAR_HEIGHT }`.

### 4.2 Title Bar Component (`src/renderer/src/components/chrome/TitleBar.tsx`)
- Detect platform in the renderer: expose `process.platform` or a boolean `isMac` via preload IPC (`app:info` or `window.sky.platform`).
- On macOS:
  - Add leading spacing/padding (e.g., `pl-18` / ~70px) so the back button and app logo sit to the right of the traffic lights.
  - Do not render `WindowButtons` (the minimize/maximize/close buttons).
- On Windows:
  - Retain current layout and `WindowButtons`.

### 4.3 macOS Lifecycle, Dock & Window Close Integration (`src/main/index.ts`, `src/main/windows/main-window.ts`)
- **macOS Window Close & Audio Playback (Builder Call):**
  - Following macOS Human Interface Guidelines and music app conventions (Spotify, Apple Music): closing the window (via Cmd+W or the red traffic light) on macOS always hides the window (`win.hide()`) rather than destroying it, ensuring audio playback in the renderer continues uninterrupted.
  - In `src/main/index.ts`, adapt `window-all-closed`:
    ```ts
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
    ```
  - Handle `app.on("activate")`:
    ```ts
    app.on("activate", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    ```
  - The app only terminates on macOS when explicitly quitting (Cmd+Q, tray menu "Quit", or Dock "Quit").

### 4.4 Updater Strategy for Unsigned macOS (Builder Call) (`src/main/system/updater.ts`)
- On macOS, `electron-updater` relies on `Squirrel.Mac`, which strictly enforces valid code signatures and fails on unsigned or ad-hoc signed `.app` packages.
- For macOS, adopt the existing portable Windows approach:
  - Check GitHub releases via API / feed for new versions.
  - Do not trigger silent background Squirrel downloads. Instead, present an update notification with a link directing the user to the GitHub release page to download the latest DMG.
  - Avoid Squirrel signature validation errors.

### 4.5 Steam Wallpaper Integration (`src/main/system/steam-wallpaper.ts`)
- On macOS, Steam stores library files in `~/Library/Application Support/Steam`.
- Check if `process.platform === 'darwin'`:
  - Main Steam folder: `join(app.getPath("home"), "Library/Application Support/Steam")`.
  - Parse `libraryfolders.vdf` from that path if present.

### 4.6 Packaging & Build System (`package.json`, `scripts/dist.mjs`)
- **Architecture Strategy (Builder Call):**
  - Local builds (`scripts/dist.mjs`) target the host architecture (`process.arch` -> `arm64` on Apple Silicon, `x64` on Intel) by default. This avoids failures where `npm install` on an Apple Silicon Mac only pulls `darwin-arm64` binaries for `onnxruntime-node`.
  - Add support for an explicit `--arch` argument (e.g. `node scripts/dist.mjs --arch=universal` or `x64`) for CI environments.
- **`package.json`:**
  - In `files`: allow darwin binaries for onnxruntime-node:
    ```json
    "!node_modules/onnxruntime-node/bin/napi-v6/linux/**",
    "!node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**",
    ```
    (Remove `darwin` from the exclusion list).
  - Add `mac` target to `build`:
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
- **`scripts/dist.mjs`:**
  - Check `process.platform`:
    - If `darwin`: invoke `electron-builder` with `--mac dmg zip` for the current host architecture (`--${process.arch}`).
    - If `win32`: invoke `electron-builder` with `--win nsis portable`.
    - Allow CLI flags to override.

---

## 5. What's Left to the Builder
- Precise pixel adjustments for traffic light alignment in `TitleBar.tsx` and full-screen view (`src/renderer/src/screens/PlayerFullScreen.tsx`).
- Verifying whether `sharp` / `mediabunny` requires any special bundling attention on macOS (native vs fallback).
- Creating or verifying ICNS/PNG icon rendering in DMG.

---

## 6. Verification and Testing Plan
1. `npm install`: dependencies resolve cleanly on macOS without compilation errors.
2. `npm run typecheck` & `npm run lint`: pass without regressions.
3. `npm run dev`:
   - Application opens on macOS.
   - Traffic lights appear on top-left and function (close, minimize, maximize).
   - Window drag area works without blocking traffic lights.
   - SoundCloud audio plays smoothly.
   - Tray icon appears in macOS menu bar.
4. `npm run dist`:
   - Generates `.dmg` and `.zip` in `dist/` directory for `arm64`.
   - The generated `.app` inside the DMG opens and runs without errors.
