import { useEffect, useRef, type CSSProperties } from "react";
import { listen } from "@/lib/reactive";

/**
 * Scratched yellow stars on the night sky, as on the site (a lopsided cross, an "x" or a dash). At rest they glimmer
 * faintly; with "Sound-reactive sky" each one lights up with the music's top end (hi-hats, cymbals) by its own
 * amount, so they twinkle unevenly rather than all at once. Only their opacity changes.
 */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const r = rng(1313);
const j = (amt: number) => (r() - 0.5) * amt;

function scratch(kind: number) {
  const line = (a: number, len1: number, len2: number) => {
    const t = (a * Math.PI) / 180;
    return `M${(12 - Math.cos(t) * len1).toFixed(1)} ${(12 - Math.sin(t) * len1).toFixed(1)}L${(12 + j(3)).toFixed(1)} ${(12 + j(3)).toFixed(1)}L${(12 + Math.cos(t) * len2).toFixed(1)} ${(12 + Math.sin(t) * len2).toFixed(1)}`;
  };
  const tilt = j(24);
  if (kind === 0) return line(tilt, 9 + j(4), 8 + j(4)) + line(90 + tilt + j(14), 7 + j(4), 9 + j(4));
  if (kind === 1) return line(45 + tilt, 8 + j(4), 7 + j(4)) + line(135 + tilt + j(14), 8 + j(4), 6 + j(4));
  return line(tilt - 20, 10 + j(3), 9 + j(3));
}

const STARS = Array.from({ length: 22 }, (_, i) => ({
  x: +(3 + r() * 94).toFixed(2),
  y: +(3 + r() * 90).toFixed(2),
  size: Math.round(9 + r() * r() * 22),
  stroke: +(1.5 + r() * 1.8).toFixed(2),
  d: scratch(i % 5 === 4 ? 2 : Math.floor(r() * 2.6)),
  rest: +(0.16 + r() * 0.22).toFixed(2),
  // how much the top end lights it: a few react strongly, most a little
  k: +(r() < 0.35 ? 0.7 + r() * 0.3 : 0.2 + r() * 0.35).toFixed(2),
}));

export default function SkyStars() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => listen(box.current), []);
  return (
    <div ref={box} className="sky-stars absolute inset-0">
      {STARS.map((s, i) => (
        <span key={i} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, "--rest": s.rest, "--k": s.k } as CSSProperties}>
          {/* the halo: a soft round glow around the star that swells with it */}
          <span className="sky-star-halo" />
          <svg viewBox="0 0 24 24" className="sky-star absolute inset-0 h-full w-full">
            <path d={s.d} fill="none" stroke="currentColor" strokeWidth={s.stroke} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ))}
    </div>
  );
}
