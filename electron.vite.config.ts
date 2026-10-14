import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    resolve: { alias: shared },
    // sandboxed preloads can't be ES modules
    build: { rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    resolve: { alias: { ...shared, "@": resolve("src/renderer/src"), "@assets": resolve("assets") } },
    plugins: [react(), tailwindcss(), csp()],
    // electron-vite leaves the page unminified by default; a smaller bundle parses faster on a cold start
    build: { minify: true },
  },
});
