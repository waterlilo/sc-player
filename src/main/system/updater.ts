import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateStatus } from "@shared/ipc";
import { log } from "./log";
import { isPortableRelease } from "./updater-check";

const { autoUpdater } = electronUpdater;
const EVERY = 6 * 3600 * 1000;

/**
 * Updates from GitHub Releases (waterlilo/sc-player). The installed app downloads the new version when asked and
 * installs it on restart. A portable .exe can't replace itself, so it is only told that a new version exists (with a
 * link to the release). Off in development.
 */
let status: UpdateStatus = { state: "idle" };
let send: (s: UpdateStatus) => void = () => {};
const portable = () => isPortableRelease();

function setStatus(next: UpdateStatus) {
  status = next;
  send(status);
}

export function initUpdater(win: () => BrowserWindow | null, enabled: () => boolean) {
  send = (s) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send("update:status", s);
  };
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setStatus({ state: "checking" }));
  autoUpdater.on("update-not-available", () => setStatus({ state: "none" }));
  autoUpdater.on("update-available", (info) => setStatus({ state: "available", version: info.version, portable: portable() }));
  autoUpdater.on("download-progress", (p) => {
    if (status.state === "available" || status.state === "downloading") setStatus({ state: "downloading", version: status.version, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => setStatus({ state: "ready", version: info.version }));
  autoUpdater.on("error", (err) => {
    // the first line only: electron-updater appends the response headers and a stack
    log("main", `update: ${err.message.split("\n")[0]}`);
    setStatus({ state: "error", message: err.message });
  });
  const auto = () => {
    if (enabled()) void check();
  };
  setTimeout(auto, 8000);
  setInterval(auto, EVERY);
}

export const updateStatus = () => status;

export async function check(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: "none" };
  if (status.state === "downloading" || status.state === "ready") return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setStatus({ state: "error", message: (err as Error).message });
  }
  return status;
}

export function download() {
  if (status.state === "available" && !portable()) void autoUpdater.downloadUpdate();
}

export function install() {
  if (status.state === "ready") autoUpdater.quitAndInstall(false, true);
}
