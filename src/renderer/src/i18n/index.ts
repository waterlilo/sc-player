import type { ErrorCode } from "@shared/types";
import { en, type Dict } from "./en";

/** All UI strings live in en.ts; the app is English only. */
export function useT(): Dict {
  return en;
}

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
