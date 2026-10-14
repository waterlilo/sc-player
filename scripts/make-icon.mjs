// Renders the app icon (the portfolio favicon: a hand-drawn glowing flower, assets/icon.svg) to build/icon.png,
// 512×512; electron-builder turns it into the Windows .ico. Run: node scripts/make-icon.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

mkdirSync("build", { recursive: true });
await sharp("assets/icon.svg", { density: 1200 }).resize(512, 512).png().toFile("build/icon.png");
console.log("build/icon.png");
