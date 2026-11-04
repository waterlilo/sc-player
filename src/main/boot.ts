/**
 * When the app's own code began, ms after the process started — imported first by index.ts, so it runs before the
 * other modules load. A slow start then shows where the time went: before our code (Chromium, the AppImage's files),
 * in loading our modules, or after (start: … in the log).
 */
export const scriptStartMs = Math.round(process.uptime() * 1000);
