import type { CSSProperties } from "react";

/** A few still clouds in the day sky (feathered stipple masks, white-blue), placed in % of the window. */
const PUFFS: { left: number; top: number; w: number; tex: "a" | "b"; o: number; flip?: boolean }[] = [
  { left: 18, top: 6, w: 22, tex: "a", o: 0.55 },
  { left: 62, top: 14, w: 28, tex: "b", o: 0.45, flip: true },
  { left: 38, top: 48, w: 20, tex: "b", o: 0.35 },
  { left: 78, top: 62, w: 24, tex: "a", o: 0.4, flip: true },
  { left: 8, top: 72, w: 26, tex: "b", o: 0.3 },
];

/**
 * The window's backdrop, all static: near-black base (night) or a blue sky (day), the pre-rendered spray-can stipple,
 * still clouds by day, and the monochrome grain on top (~12 fps). Everything else — panels, lists, player, menus — is
 * stacked above, so the grain never lands on text or artwork.
 */
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="sky-night absolute inset-0" />
      <div className="sky-day absolute inset-0" />
      <div className="stipple-night absolute inset-0" />
      <div className="stipple-day absolute inset-0" />
      <div className="day-only absolute inset-0">
        {PUFFS.map((p, i) => (
          <div
            key={i}
            className={`tex-mask tex-feather tex-cloud-${p.tex} absolute`}
            style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.w}%`, aspectRatio: "2 / 1", opacity: p.o, background: "linear-gradient(180deg, #ffffff 30%, #c3d0fa)", transform: p.flip ? "scaleX(-1)" : undefined } as CSSProperties}
          />
        ))}
      </div>
      <div className="grain" />
    </div>
  );
}
