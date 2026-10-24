/** The built-in proxy (proxy.local.json at build time, not in git); null when the build has none. */
/** sc player's own server (server.local.json at build time, not in git; SC_API in development); null without one. */
declare const __SC_API__: string | null;

declare const __SC_PROXY__: { scheme: "https" | "http"; host: string; port: number; username: string; password: string; secret: string | null } | null;
