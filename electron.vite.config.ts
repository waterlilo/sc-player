import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const shared = { "@shared": resolve("src/shared") };

/** Strict CSP in the built page only: the dev server needs inline scripts (React refresh) and a websocket. */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    // data: only for the dev demo tone (src/main/demo.ts); it can't reach the network
    "media-src 'self' blob: data: https:",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "sky-csp",
    apply: "build",
    transformIndexHtml: (html: string) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

function shortVersion() {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const [major, minor = "0", patch = "0"] = version.split(".");
  return `v${major}${patch !== "0" ? `.${minor}.${patch}` : minor !== "0" ? `.${minor}` : ""}`;
}

/**
 * The built-in proxy (server/README.md): proxy.local.json next to package.json, kept out of git —
 * { "host": "scp.example.com", "port": 443, "username": "…", "password": "…" } ("scheme": "http" only for a local test).
 * Without the file the build has no built-in proxy and the setting doesn't show.
 */
function builtinProxy() {
  try {
    const c = JSON.parse(readFileSync("proxy.local.json", "utf8")) as Record<string, unknown>;
    if (typeof c.host !== "string" || typeof c.username !== "string" || typeof c.password !== "string") return null;
    return { scheme: c.scheme === "http" ? "http" : "https", host: c.host, port: typeof c.port === "number" ? c.port : 443, username: c.username, password: c.password };
  } catch {
    return null;
  }
}

/** sc player's own server (server/README.md): server.local.json next to package.json — { "api": "https://…" }. */
function serverApi() {
  try {
    const c = JSON.parse(readFileSync("server.local.json", "utf8")) as Record<string, unknown>;
    return typeof c.api === "string" && /^https:\/\/[\w.-]+(:\d+)?$/.test(c.api) ? c.api : null;
  } catch {
    return null;
  }
}

export default defineConfig({
  main: {
    // sharp: transformers.js reads images with it; the lyrics worker only hears sound
    resolve: { alias: { ...shared, sharp: resolve("src/main/lyrics-sync/no-sharp.ts") } },
    define: { __SC_PROXY__: JSON.stringify(builtinProxy()), __SC_API__: JSON.stringify(serverApi()) },
    // the words-to-song worker is its own process (src/main/lyrics-sync); onnxruntime-node stays outside (native)
    build: { rolldownOptions: { input: { index: resolve("src/main/index.ts"), "lyrics-worker": resolve("src/main/lyrics-sync/worker.ts") } } },
  },
  preload: {
    resolve: { alias: shared },
    // sandboxed preloads can't be ES modules
    build: { rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    resolve: { alias: { ...shared, "@": resolve("src/renderer/src"), "@assets": resolve("assets") } },
    plugins: [react(), tailwindcss(), csp()],
    // the app version for the UI, as the short release name (v1, v1.1)
    define: { __APP_VERSION__: JSON.stringify(shortVersion()) },
    // electron-vite leaves the page unminified by default; a smaller bundle parses faster on a cold start
    build: { minify: true },
  },
});
