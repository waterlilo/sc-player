import type { AppErrorInfo, ErrorCode } from "@shared/types";

/** Every failure that leaves src/main/soundcloud is one of these; the UI turns the code into a readable message. */
export class ScError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScError";
  }
}

export function toErrorInfo(err: unknown): AppErrorInfo {
  if (err instanceof ScError) return { code: err.code, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  return { code: "unknown", message };
}

/** SoundCloud changed something we rely on: a field is missing or has another type. */
export function apiChanged(what: string): never {
  throw new ScError("api_changed", `unexpected SoundCloud response: ${what}`);
}
