// Renders mockup.html to PNGs at 1.5x (2x would not fit a 1440p screen: the window gets clamped) with the app's own Electron:
//   npx electron design/redesign/render.cjs
// → design/redesign/out/<variant>-<screen>.png
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("force-device-scale-factor", "1.5");
app.disableHardwareAcceleration();

const shots = process.argv.slice(2).filter((a) => /^[abc]-(home|full)$/.test(a));
const all = shots.length ? shots : ["a-home", "a-full", "b-home", "b-full", "c-home", "c-full"];

app.whenReady().then(async () => {
  const out = join(__dirname, "out");
  mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  for (const name of all) {
    const [v, screen] = name.split("-");
    const url = pathToFileURL(join(__dirname, "mockup.html")).href + `?v=${v}&screen=${screen}`;
    await win.loadURL(url);
    await win.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))");
    const img = await win.webContents.capturePage();
    writeFileSync(join(out, `${name}.png`), img.toPNG());
    console.log("saved", name, img.getSize());
  }
  app.quit();
});
