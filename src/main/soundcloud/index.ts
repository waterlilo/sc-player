import type { AuthStatus } from "@shared/ipc";
import { ClientId } from "./client-id";
import { ScError } from "./errors";
import { ScHttp } from "./http";
import { SessionAuth } from "./session-auth";
import { WebSessionProvider } from "./web-session-provider";

/** Everything SoundCloud, wired once. The rest of main only sees `provider` and `auth`. */
const clientId = new ClientId();
export const auth = new SessionAuth(clientId);
const http = new ScHttp(clientId, () => auth.token());
export const provider = new WebSessionProvider(http, () => !!auth.token());

export async function authStatus(): Promise<AuthStatus> {
  if (!auth.token()) return { mode: "public", user: null };
  try {
    return { mode: "session", user: await provider.getMe() };
  } catch (err) {
    // an expired session: forget the token so the UI offers to sign in again
    if (err instanceof ScError && err.code === "unauthorized") {
      auth.forget();
      provider.reset();
      return { mode: "public", user: null };
    }
    // offline or SoundCloud hiccup: still signed in, the user just isn't loaded yet
    return { mode: "session", user: null };
  }
}

export { ScError, toErrorInfo } from "./errors";
export { finishBrowserSignIn, startBrowserSignIn, stopBrowserSignIn, tokenFromArgs, waitingForBrowser } from "./browser-signin";
export { chromeUserAgent, scSession } from "./session";
