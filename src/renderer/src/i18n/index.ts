import type { Language } from "@shared/ipc";
import type { ErrorCode } from "@shared/types";
import { useSettings } from "@/state/settings";
import { en, type Dict } from "./en";
import { ru } from "./ru";

/**
 * The UI's strings: English (en.ts) or Russian (ru.ts, the same keys — the compiler checks none is missing).
 * Settings → App → Language picks one; "auto" follows the system.
 */
export type Lang = "en" | "ru";

const DICTS: Record<Lang, Dict> = { en, ru };

export function langOf(pref: Language | undefined): Lang {
  if (pref === "en" || pref === "ru") return pref;
  return /^ru\b/i.test(navigator.language) ? "ru" : "en";
}

/** the language now (outside React) */
export const lang = (): Lang => langOf(useSettings.getState().prefs.language);

/** The strings in the chosen language; a component using them draws again when the language changes. */
export function useT(): Dict {
  return DICTS[useSettings((s) => langOf(s.prefs.language))];
}

/** The strings for code outside components (stores, keyboard handlers): always the language chosen now. */
export const tr: Dict = new Proxy({} as Dict, { get: (_, key) => DICTS[lang()][key as keyof Dict] });

/** dates and times in the chosen language */
export const dateLocale = () => (lang() === "ru" ? "ru-RU" : "en-GB");
/** numbers ("12,345" / "12 345") in the chosen language */
export const numberLocale = () => (lang() === "ru" ? "ru-RU" : "en-US");

// the page's own language, for spell-checking and screen readers
const markPage = () => document.documentElement.setAttribute("lang", lang());
markPage();
useSettings.subscribe((s, before) => {
  if (s.prefs.language !== before.prefs.language) markPage();
});

export function errorText(t: Dict, code: ErrorCode) {
  const map: Record<ErrorCode, string> = {
    offline: t.errOffline,
    unauthorized: t.errUnauthorized,
    rate_limited: t.errRateLimited,
    api_changed: t.errApiChanged,
    not_found: t.errNotFound,
    unavailable: t.errUnavailable,
    verify: t.errVerify,
    unknown: t.errUnknown,
  };
  return map[code];
}

export type { Dict };
