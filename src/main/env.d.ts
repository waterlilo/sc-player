/** The built-in proxy (proxy.local.json at build time, not in git); null when the build has none. */
declare const __SC_PROXY__: { scheme: "https" | "http"; host: string; port: number; username: string; password: string } | null;
