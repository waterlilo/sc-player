// Builds the app for the system it runs on. Releases are called v1, v1.1, v2.2.1 … : package.json keeps a semver
// version (2.3.0) for Electron, the files get the short name (sc-player-setup-v2.3.exe).
//   Windows: the installer and the portable .exe        (npm run dist, on Windows)
//   macOS:   .dmg and .zip, Apple Silicon and Intel     (on a Mac — the GitHub workflow "Build macOS and Linux")
//   Linux:   .AppImage and .deb, x64                    (on Linux — the same workflow)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor = "0", patch = "0"] = version.split(".");
const short = `v${major}${patch !== "0" ? `.${minor}.${patch}` : minor !== "0" ? `.${minor}` : ""}`;

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npm", ["run", "lint"]);
run("npm", ["run", "build"]);

const builder = (...args) => run("npx", ["electron-builder", ...args, "--publish", "never"]);

if (process.platform === "darwin") {
  // both in one run: latest-mac.yml then lists both (the update check picks the one for this Mac)
  builder("--mac", "dmg", "zip", "--arm64", "--x64", `-c.mac.artifactName=sc-player-${short}-\${arch}.\${ext}`);
} else if (process.platform === "linux") {
  builder("--linux", "AppImage", "deb", "--x64", `-c.appImage.artifactName=sc-player-${short}-x86_64.\${ext}`, `-c.deb.artifactName=sc-player-${short}-amd64.\${ext}`);
} else {
  builder("--win", "nsis", "portable", `-c.nsis.artifactName=sc-player-setup-${short}.\${ext}`, `-c.portable.artifactName=sc-player-portable-${short}.\${ext}`);
}
console.log(`\nsc player ${short} (${version}) → dist/`);
