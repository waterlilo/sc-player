// Opens the living prototype with sound: npx electron design/redesign/proto.cjs [home|full|custom]
// Click anywhere to pause / play. The track is the processed bed from sc-media (not in this repo).
const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(() => {
  const screen = process.argv.slice(2).find((a) => ["home", "full", "custom"].includes(a)) || "home";
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, resizable: false, frame: false, backgroundColor: "#030304",
    webPreferences: { webSecurity: false } });
  win.loadURL(pathToFileURL(join(__dirname, "proto.html")).href + `?screen=${screen}`);
  win.webContents.on("before-input-event", (_e, input) => { if (input.key === "Escape") app.quit(); });
});
