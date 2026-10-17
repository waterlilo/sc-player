import type { CSSProperties } from "react";

/**
 * Clouds drifting slowly across the window behind everything, as on the site's night sky: feathered cloud masks
 * tinted with the theme's fog colour. Each one only moves (transform), so the mask is drawn once and the
 * compositor slides it. They stop with the other decorative loops (window in the background, adaptive quality) and
 * are left out at the lowest quality.
 */
const CLOUDS = [
  { tex: "a", top: 4, w: 46, o: 0.22, dur: 210, delay: -40, flip: false },
  { tex: "b", top: 26, w: 58, o: 0.16, dur: 260, delay: -170, flip: true },
  { tex: "a", top: 46, w: 36, o: 0.2, dur: 180, delay: -110, flip: true },
  { tex: "b", top: 62, w: 52, o: 0.17, dur: 240, delay: -20, flip: false },
  { tex: "a", top: 80, w: 44, o: 0.15, dur: 300, delay: -230, flip: false },
  { tex: "b", top: 14, w: 30, o: 0.13, dur: 340, delay: -290, flip: true },
] as const;

export default function SkyClouds() {
  return (
    <div className="sky-clouds deco absolute inset-0">
      {CLOUDS.map((c, i) => (
        <div key={i} className="sky-cloud" style={{ top: `${c.top}%`, width: `${c.w}vw`, "--drift-dur": `${c.dur}s`, "--drift-delay": `${c.delay}s`, "--drift-steps": c.dur * 12 } as CSSProperties}>
          <div className={`sky-cloud-tex tex-cloud-${c.tex}`} style={{ opacity: c.o, transform: c.flip ? "scaleX(-1)" : undefined }} />
        </div>
      ))}
    </div>
  );
}
