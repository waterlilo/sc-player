import { useState, type CSSProperties, type ReactNode } from "react";

type HSL = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function toHsl(hex: string): HSL {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [260, 40, 50];
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, Math.round(l * 100)];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

function toHex([h, s, l]: HSL): string {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const css = ([h, s, l]: HSL) => `hsl(${h} ${s}% ${l}%)`;

/** One line of the picker: its name, a range whose track shows the colours it goes through, the value. */
function Line({
  label,
  value,
  min,
  max,
  track,
  onChange,
  shown,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  track: string;
  onChange: (v: number) => void;
  shown: string;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-sm text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="color-range min-w-0 flex-1"
        style={{ "--track": track } as CSSProperties}
      />
      <span className="w-10 shrink-0 text-right font-type text-xs tabular-nums text-muted">{shown}</span>
    </label>
  );
}

/**
 * A colour in the app's own controls (not the system's picker): hue, saturation and lightness ranges whose tracks
 * show the colours they go through, the colour's code, and a few ready ones. `maxLight` keeps it dark (the interface
 * colour); the hue is kept while the colour is grey, so moving saturation up again finds it.
 */
export function ColorPicker({
  value,
  onChange,
  presets,
  maxLight = 100,
  sample,
  labels,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets: string[];
  maxLight?: number;
  /** the preview: white text on it (the interface colour), or the colour glowing (the accent) */
  sample: "text" | "glow";
  labels: { hue: string; saturation: string; lightness: string; code: string };
}) {
  // a colour saved before the limit (or a theme's) shows at the limit, as it is applied
  const within = (c: HSL): HSL => [c[0], c[1], Math.min(c[2], maxLight)];
  const [hsl, setHsl] = useState<HSL>(() => within(toHsl(value)));
  const [code, setCode] = useState<string | null>(null);
  // the colour changed from outside (a preset, a reset, a theme): follow it
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (toHex(hsl) !== value.toLowerCase()) setHsl(within(toHsl(value)));
  }
  const [h, s, l] = hsl;
  const set = (next: HSL) => {
    const fixed: HSL = [next[0], next[1], clamp(next[2], 0, maxLight)];
    setHsl(fixed);
    setCode(null);
    const hex = toHex(fixed);
    setSeen(hex);
    onChange(hex);
  };

  return (
    <div className="flex gap-4 px-3 pb-3 pt-1">
      {/* the colour, big: as text sits on it, or as it glows */}
      <div
        aria-hidden="true"
        className="relative flex w-28 shrink-0 flex-col justify-end overflow-hidden rounded-[var(--r,10px)] border border-white/20 p-3"
        style={{
          background: `linear-gradient(160deg, rgba(255, 255, 255, 0.1), transparent 45%), ${css(hsl)}`,
          boxShadow: sample === "glow" ? `0 0 22px ${css([h, s, l])}66` : "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        }}
      >
        {sample === "text" && (
          <>
            <span className="text-2xl font-semibold leading-none text-white">Aa</span>
            <span className="mt-1.5 text-[11px] text-white/60">sc player</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <label className="field sketch sketch-thin paper-fill flex rounded-md">
            <input
              value={code ?? toHex(hsl)}
              maxLength={7}
              spellCheck={false}
              aria-label={labels.code}
              onChange={(e) => {
                const v = e.target.value.trim();
                setCode(v);
                if (/^#[0-9a-f]{6}$/i.test(v)) set(toHsl(v));
              }}
              onBlur={() => setCode(null)}
              className="w-24 px-3 py-1.5 font-type text-sm uppercase text-text"
            />
          </label>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={p}
                title={p}
                onClick={() => set(toHsl(p))}
                className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${toHex(hsl) === p.toLowerCase() ? "border-white" : "border-white/15"}`}
                style={{ background: p }}
              />
            ))}
          </div>
        </div>
        <Line
          label={labels.hue}
          value={h}
          min={0}
          max={359}
          shown={`${h}°`}
          track="linear-gradient(90deg, hsl(0 80% 55%), hsl(60 80% 55%), hsl(120 80% 55%), hsl(180 80% 55%), hsl(240 80% 55%), hsl(300 80% 55%), hsl(359 80% 55%))"
          onChange={(v) => set([v, s, l])}
        />
        <Line
          label={labels.saturation}
          value={s}
          min={0}
          max={100}
          shown={`${s}%`}
          track={`linear-gradient(90deg, ${css([h, 0, Math.max(l, 25)])}, ${css([h, 100, Math.max(l, 25)])})`}
          onChange={(v) => set([h, v, l])}
        />
        <Line
          label={labels.lightness}
          value={l}
          min={0}
          max={maxLight}
          shown={`${l}%`}
          track={`linear-gradient(90deg, ${css([h, s, 0])}, ${css([h, s, maxLight / 2])}, ${css([h, s, maxLight])})`}
          onChange={(v) => set([h, s, v])}
        />
      </div>
    </div>
  );
}

/** Opens and closes smoothly under a row (height from 0 to its content); closed, its controls can't be reached. */
export function Unfold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
