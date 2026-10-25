// Renders the living prototype (proto.html) frame by frame from the precomputed analysis, then muxes the clip:
//   npx electron design/redesign/video.cjs <screen> [frames=420] [--still N]
// → out/<screen>.mp4 (with the analysed track, 30 fps) or out/<screen>-still.png
// Frames are driven by __frame(n), never by the clock, so every frame matches its piece of the music.
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--") || a === "--still");
const screen = args[0] || "home";
const stillAt = process.argv.includes("--still") ? Number(process.argv[process.argv.indexOf("--still") + 1]) : null;
const count = Number(args[1] && !args.includes("--still") ? args[1] : 420);
// the music the recording is analysed with: a local file, given as SC_VIDEO_AUDIO (not kept in the repository)
const AUDIO = process.env.SC_VIDEO_AUDIO ?? "";

app.commandLine.appendSwitch("force-device-scale-factor", stillAt != null ? "1.5" : "1");

app.whenReady().then(async () => {
  const out = join(__dirname, "out");
  mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false, webSecurity: false } });
  win.webContents.on("console-message", (_e, _l, msg) => console.log("[page]", msg));
  await win.loadURL(pathToFileURL(join(__dirname, "proto.html")).href + `?screen=${screen}&render=1`);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise((r) => { const w = () => (window.__ready ? r() : setTimeout(w, 50)); w(); }))");
  if (stillAt != null) {
    await win.webContents.executeJavaScript(`window.__frame(${stillAt})`);
    const img = await win.webContents.capturePage();
    writeFileSync(join(out, `${screen}-still.png`), img.toPNG());
    console.log("still", screen, img.getSize());
    return app.quit();
  }
  const dir = join(out, `frames-${screen}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < count; f++) {
    await win.webContents.executeJavaScript(`window.__frame(${f})`);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `${String(f).padStart(4, "0")}.png`), img.toPNG());
    if (f % 60 === 0) console.log("frame", f);
  }
  execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", "30", "-i", join(dir, "%04d.png"), "-i", AUDIO, "-t", String(count / 30),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-c:a", "aac", "-b:a", "192k", "-af", "afade=t=out:st=" + (count / 30 - 0.6) + ":d=0.6",
    join(out, `${screen}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log("video", join(out, `${screen}.mp4`));
  app.quit();
});
