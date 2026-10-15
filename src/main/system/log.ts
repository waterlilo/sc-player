import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * A small log file for bug reports (Settings → Diagnostics → Open logs): errors from main and from the page, one line
 * each. Kept under 1 MB (the previous one is kept as main.old.log).
 */
const MAX = 1024 * 1024;

export const logsDir = () => join(app.getPath("userData"), "logs");

export function log(source: "main" | "page", message: string) {
  try {
    const dir = logsDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "main.log");
    try {
      if (statSync(file).size > MAX) renameSync(file, join(dir, "main.old.log"));
    } catch {
      /* no file yet */
    }
    appendFileSync(file, `${new Date().toISOString()} [${source}] ${message.replace(/\s+/g, " ").slice(0, 2000)}\n`);
  } catch {
    /* logging must never break the app */
  }
}
