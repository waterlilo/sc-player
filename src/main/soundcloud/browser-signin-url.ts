export const PROTOCOL = "scplayer";

/**
 * Any printable token without spaces is taken: SoundCloud checks it right after (the account is asked for), and
 * some accounts' cookies are longer or carry other characters than "2-123-456-abc" — those links were refused here.
 */
export const TOKEN = /^[\x21-\x7e]{8,4096}$/;

/** The code from a friend link (`scplayer://friend/SKY-XXXXX`) among arguments, if there is one. */
export function parseFriendFromArgs(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${PROTOCOL}://friend/`)) continue;
    const code = arg.slice(`${PROTOCOL}://friend/`.length).replace(/\/+$/, "").toUpperCase();
    if (/^SKY-[2-9A-HJ-NP-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/** The token from a `scplayer://signin?token=…` link among arguments, if there is one. */
export function parseTokenFromArgs(argv: string[], onLog?: (msg: string) => void): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${PROTOCOL}://signin`)) continue;
    let token: string;
    try {
      token = (new URL(arg).searchParams.get("token") ?? "").trim().replace(/\/+$/, "");
    } catch {
      onLog?.("login: browser link that isn't a link");
      continue;
    }
    // a cookie kept percent-encoded arrives encoded once more
    if (/%[0-9a-f]{2}/i.test(token)) {
      try {
        token = decodeURIComponent(token);
      } catch {
        /* kept as it came */
      }
    }
    // a cookie value may come in quotes
    token = token.replace(/^"(.*)"$/, "$1");
    if (TOKEN.test(token)) return token;
    // what was wrong with it, never the token itself
    const odd = [...new Set(token.replace(/[\w.-]/g, ""))].map((c) => (c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e ? `U+${c.charCodeAt(0).toString(16)}` : c)).join(" ");
    onLog?.(`login: browser link without a usable token (length ${token.length}${odd ? `, other characters: ${odd}` : ""})`);
  }
  return null;
}
