import { artwork } from "@shared/types";

/** A friend's round initial, its colour from the code (stable, quiet). */
export function Avatar({ name, code, size = 32, live = false }: { name: string; code: string; size?: number; live?: boolean }) {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      className={`relative grid shrink-0 place-items-center rounded-full font-semibold text-white/90 ${live ? "ring-2 ring-glow ring-offset-2 ring-offset-transparent" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(140deg, hsl(${h} 32% 38%), hsl(${(h + 40) % 360} 30% 24%))` }}
    >
      {(name || code.slice(4)).charAt(0).toUpperCase()}
    </span>
  );
}

export function Cover({ url, size }: { url: string | null; size: number }) {
  const src = artwork(url, size > 90 ? "t300x300" : "large");
  return (
    <span className="block shrink-0 overflow-hidden rounded-[5px] bg-[var(--paper)]" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
    </span>
  );
}

/** "2m", "14:05", "Tue", "12 Oct" */
export function when(ms: number) {
  const d = new Date(ms);
  const ago = Date.now() - ms;
  if (ago < 60_000) return "now";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m`;
  if (new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (ago < 6 * 86_400_000) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** three little bars moving: a friend is listening right now */
export function Eq() {
  return (
    <span className="social-eq inline-flex h-[10px] items-end gap-[2px]" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
