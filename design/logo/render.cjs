// Renders a page of this folder to a PNG at its full height (offscreen, so the window isn't clamped to the screen):
//   npx electron design/logo/render.cjs [page.html] [out.png]
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const page = process.argv.find((a) => a.endsWith(".html")) || "logos.html";
const out = process.argv.find((a) => a.endsWith(".png")) || join(__dirname, "out", page.replace(".html", ".png"));

app.whenReady().then(async () => {
  mkdirSync(join(__dirname, "out"), { recursive: true });
  const win = new BrowserWindow({ width: 1600, height: 1200, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(pathToFileURL(join(__dirname, page)).href);
  await win.webContents.executeJavaScript("new Promise((r) => { const w = () => (window.__ready ? r() : setTimeout(w, 50)); w(); })");
  const h = await win.webContents.executeJavaScript("document.documentElement.scrollHeight");
  win.setContentSize(1600, h);
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: h });
  writeFileSync(out, img.toPNG());
  console.log("saved", out, img.getSize());
  app.quit();
});
