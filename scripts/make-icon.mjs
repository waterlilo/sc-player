// Renders the app icon (a hand-drawn nod to the SoundCloud cloud in the portfolio style, assets/app-icon.svg) to build/icon.png,
// 512×512; electron-builder turns it into the Windows .ico. Run: node scripts/make-icon.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

mkdirSync("build", { recursive: true });
await sharp("assets/app-icon.svg", { density: 1200 }).resize(512, 512).png().toFile("build/icon.png");
// the same picture for the window and the tray (bundled with main)
mkdirSync("resources", { recursive: true });
await sharp("build/icon.png").toFile("resources/icon.png");
console.log("build/icon.png, resources/icon.png");

// the taskbar thumbnail buttons (⏮ ⏯ ⏭), 16 px and 32 px for scaled displays
for (const name of ["play", "pause", "next", "previous"]) {
  await sharp(`assets/thumbar/${name}.svg`, { density: 600 }).resize(16, 16).png().toFile(`resources/thumb-${name}.png`);
  await sharp(`assets/thumbar/${name}.svg`, { density: 1200 }).resize(32, 32).png().toFile(`resources/thumb-${name}@2x.png`);
}
console.log("resources/thumb-*.png");
