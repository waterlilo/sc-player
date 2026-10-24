import { store } from "../store";
import { reportNetTrouble } from "../system/net-trouble";
import { ScError } from "./errors";
import { chromeUserAgent, scSession } from "./session";

const MAX_AGE = 3 * 24 * 3600 * 1000;
const ID = /^[a-zA-Z0-9]{32}$/;

/**
 * api-v2 wants the website's public client_id on every request. It isn't documented: it lives in the site's JS
 * bundles and changes from time to time. Kept in settings.json (it's public, not a secret); found again when older
 * than a few days or when api-v2 rejects it. The login window also reports the id the site itself uses (learn()).
 */
export class ClientId {
  private pending: Promise<string> | null = null;

  async get(): Promise<string> {
    const saved = store().get().clientId;
    if (saved && Date.now() - saved.at < MAX_AGE) return saved.value;
    return this.refresh();
  }

  /** Forget the current id and find it again (one search at a time). */
  refresh(): Promise<string> {
    this.pending ??= this.scrape().finally(() => (this.pending = null));
    return this.pending;
  }

  /**
   * After api-v2 rejected a request: search again, unless the id was found only minutes ago (a 403 can also mean a
   * private resource, which must not send us to soundcloud.com every time). Returns whether the id changed.
   */
  async recheck(): Promise<boolean> {
    const saved = store().get().clientId;
    if (saved && Date.now() - saved.at < 10 * 60 * 1000) return false;
    return (await this.refresh()) !== saved?.value;
  }

  learn(id: string) {
    if (ID.test(id) && store().get().clientId?.value !== id) store().patch({ clientId: { value: id, at: Date.now() } });
  }

  private async text(url: string) {
    let res: Response;
    try {
      res = await scSession().fetch(url, { headers: { "User-Agent": chromeUserAgent() } });
    } catch (err) {
      void reportNetTrouble();
      throw new ScError("offline", `soundcloud.com unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ScError("unknown", `soundcloud.com answered ${res.status}`);
    return res.text();
  }

  private async scrape(): Promise<string> {
    const html = await this.text("https://soundcloud.com/");
    const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    if (!scripts.length) throw new ScError("api_changed", "no app scripts found on soundcloud.com");
    // the id sits in one of the last bundles
    for (const src of scripts.reverse()) {
      const js = await this.text(src);
      const id = js.match(/[{,\s]client_id\s*:\s*"([a-zA-Z0-9]{32})"/)?.[1] ?? js.match(/client_id=([a-zA-Z0-9]{32})/)?.[1];
      if (id) {
        store().patch({ clientId: { value: id, at: Date.now() } });
        return id;
      }
    }
    throw new ScError("api_changed", "client_id not found in soundcloud.com scripts");
  }
}
