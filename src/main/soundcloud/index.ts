import type { AuthStatus } from "@shared/ipc";
import { ClientId } from "./client-id";
import { ScError } from "./errors";
import { ScHttp } from "./http";
import { SessionAuth } from "./session-auth";
import { WebSessionProvider } from "./web-session-provider";
import { log } from "../system/log";

/** Everything SoundCloud, wired once. The rest of main only sees `provider` and `auth`. */
const clientId = new ClientId();
export const auth = new SessionAuth();
const http = new ScHttp(
  clientId,
  () => auth.token(),
  () => auth.adoptCookieToken(),
);
export const provider = new WebSessionProvider(http, () => !!auth.token());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Signed in or not. A refused token is dropped only when SoundCloud refuses it again a moment later and the session's
 * cookie has no newer one (http tries that first) — one refusal signed people out (2026-10-28). The dropped token
 * stays sealed among the old ones (store/secrets).
 */
export async function authStatus(): Promise<AuthStatus> {
  if (!auth.token()) return { mode: "public", user: null };
  for (let attempt = 0; ; attempt++) {
    try {
      return { mode: "session", user: await provider.getMe() };
    } catch (err) {
      if (!(err instanceof ScError) || err.code !== "unauthorized") {
        // offline or SoundCloud hiccup: still signed in, the user just isn't loaded yet
        return { mode: "session", user: null };
      }
      provider.reset();
      if (attempt === 0) {
        await sleep(2500);
        continue;
      }
      log("main", "login: SoundCloud refused the token twice — signed out");
      auth.forget();
      return { mode: "public", user: null, ended: true };
    }
  }
}

export { ScError, toErrorInfo } from "./errors";
export { finishBrowserSignIn, friendFromArgs, registerLinks, startBrowserSignIn, stopBrowserSignIn, tokenFromArgs, waitingForBrowser } from "./browser-signin";
export { chromeUserAgent, scSession } from "./session";
