import type { ReactNode } from "react";
import { errorText, useT } from "@/i18n";
import { errorCode } from "@/lib/sky";
import { PaperButton } from "./Buttons";

/** A readable error and a retry button; SoundCloud being down or changing its API never crashes a screen. */
export function ErrorState({ error, onRetry, compact = false }: { error: unknown; onRetry: () => void; compact?: boolean }) {
  const t = useT();
  const text = errorText(t, errorCode(error));
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 text-center ${compact ? "py-4" : "py-16"}`}>
      <p className="max-w-md font-type text-sm text-text">
        <span className="mr-1.5 text-blood" aria-hidden="true">✖</span>
        {text}
      </p>
      <PaperButton onClick={onRetry}>{t.retry}</PaperButton>
    </div>
  );
}

/** Empty screens and the sign-in screen: a scratched yellow star and a short typewriter caption. */
export function EmptyState({ caption, children }: { caption: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      <svg aria-hidden="true" viewBox="0 0 40 40" width="44" height="44" className="-rotate-6 text-glow" style={{ filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--glow) 55%, transparent))" }}>
        <path d="M20.5 4 C 20 12, 20.6 26, 19.6 36 M5 19.4 C 13 20.2, 27 19.2, 35.5 20.4 M9.2 8.8 C 15 15, 25 25.6, 31 31.4 M30.6 8.4 C 24.6 14.6, 15.4 25, 9 31.8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <p className="font-type text-base tracking-wide text-muted">{caption}</p>
      {children}
    </div>
  );
}

export function Loading() {
  const t = useT();
  return <p className="py-10 text-center font-type text-sm text-muted">{t.loadingMore}</p>;
}
