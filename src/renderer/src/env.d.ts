/// <reference types="vite/client" />

// hls.js ships one set of types; the light build has the same API
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
