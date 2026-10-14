/// <reference types="vite/client" />

// hls.js ships one set of types; the light build has the same API
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}

/** the app version as the short release name (v1, v1.1), from package.json */
declare const __APP_VERSION__: string;
