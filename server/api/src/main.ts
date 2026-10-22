import { createServer } from "node:http";
import { HttpError, ipOf, limit, send } from "./http.ts";
import { route } from "./routes.ts";

/**
 * sc player's own server: the track messenger (friend codes, no accounts), the theme workshop and an anonymous count
 * of running apps. JSON over HTTP behind Caddy (TLS); data in SQLite under DATA_DIR.
 */
const PORT = Number(process.env.PORT ?? 8080);
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";

const server = createServer(async (req, res) => {
  const ip = ipOf(req, TRUST_PROXY);
  try {
    limit(`ip:${ip}`, 300, 60_000);
    await route({ req, res, ip });
  } catch (e) {
    if (res.headersSent) return void res.destroy();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(new Date().toISOString(), req.method, req.url, e);
    send(res, 500, { error: "server error" });
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(PORT, () => console.log(`sc player api on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.close(() => process.exit(0)));
