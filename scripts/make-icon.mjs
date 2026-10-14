// Renders the app icon (a hand-drawn nod to the SoundCloud cloud in the portfolio style, assets/app-icon.svg) to build/icon.png,
// 512×512; electron-builder turns it into the Windows .ico. Run: node scripts/make-icon.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

mkdirSync("build", { recursive: true });
await sharp("assets/app-icon.svg", { density: 1200 }).resize(512, 512).png().toFile("build/icon.png");
console.log("build/icon.png");
