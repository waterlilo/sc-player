// Builds the installer and the portable .exe. Releases are called v1, v1.1, v1.2 … : package.json keeps a semver
// version (1.1.0) for Electron, the files get the short name (sc-player-setup-v1.1.exe).
//   npm run dist
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
run("npx", [
  "electron-builder",
  "--win",
  "nsis",
  "portable",
  "--publish",
  "never",
  `-c.nsis.artifactName=sc-player-setup-${short}.\${ext}`,
  `-c.portable.artifactName=sc-player-portable-${short}.\${ext}`,
]);
console.log(`\nsc player ${short} (${version}) → dist/`);
