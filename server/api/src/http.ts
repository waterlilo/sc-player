import type { IncomingMessage, ServerResponse } from "node:http";

/** An error with an HTTP status; its message goes to the client as { error }. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(text);
}

/** The whole request body, refused past `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) return reject(new HttpError(413, "too large"));
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "too large"));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    const v: unknown = JSON.parse(raw.toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* falls through */
  }
  return fail(400, "bad json");
}

// ---- input checks -------------------------------------------------------------------------------------------------

/** A trimmed one-line string of 1..max characters (control characters removed). */
export function text(v: unknown, max: number, field: string, required = true): string {
  if (v === undefined || v === null || v === "") {
    if (required) fail(400, `${field} missing`);
    return "";
  }
  if (typeof v !== "string") return fail(400, `${field} must be text`);
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (required && !s) fail(400, `${field} missing`);
  if ([...s].length > max) fail(400, `${field} too long`);
  return s;
}

export function int(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return fail(400, `${field} out of range`);
  return v;
}

export function url(v: unknown, hosts: RegExp, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > 500) return fail(400, `${field} bad`);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return fail(400, `${field} bad`);
  }
  if (u.protocol !== "https:" || !hosts.test(u.hostname) || u.username || u.password) fail(400, `${field} not allowed`);
  return u.toString();
}

// ---- rate limits --------------------------------------------------------------------------------------------------

const buckets = new Map<string, { n: number; reset: number }>();

/** At most `max` hits per `windowMs` for this key (an IP or a device); a 429 past that. */
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) fail(429, "slow down");
}

// forget expired windows now and then, so the map doesn't grow without end
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60_000).unref();

/** The client's address: Caddy in front sets X-Forwarded-For; the direct peer otherwise. */
export function ipOf(req: IncomingMessage, trustProxy: boolean): string {
  const fwd = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "";
  return fwd || req.socket.remoteAddress || "?";
}
