import type { EventMap, InvokeChannel, InvokeMap } from "@shared/ipc";
import type { ErrorCode } from "@shared/types";

/** A failure from main, with the code the UI turns into a readable message. */
export class SkyError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkyError";
  }
}

/** Calls main; resolves with the data or throws SkyError. */
export async function call<K extends InvokeChannel>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<ReturnType<InvokeMap[K]>> {
  const res = await window.sky.invoke(channel, ...args);
  if (res.ok) return res.data;
  throw new SkyError(res.error.code, res.error.message);
}

export function on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void) {
  return window.sky.on(channel, listener);
}

export const errorCode = (err: unknown): ErrorCode => (err instanceof SkyError ? err.code : "unknown");
