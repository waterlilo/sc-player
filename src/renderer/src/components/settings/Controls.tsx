import type { CSSProperties, ReactNode } from "react";

/**
 * A settings group: a heading and its rows on a dark card, so they stay readable over the stipple and the drifting
 * clouds. The card is plain (no blur behind it: that would be redrawn under every moving cloud).
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mb-9 max-w-3xl">
      <h2 className="display-heading mb-3 -rotate-1 text-3xl text-text">{title.toLowerCase()}</h2>
      <div className="settings-card flex flex-col gap-1 rounded-lg border border-[var(--card-edge)] bg-[var(--card)] p-2 shadow-[4px_6px_0_rgba(0,0,0,0.35)]">{children}</div>
    </section>
  );
}

/** One setting: label and hint on the left, the control on the right — or, `wide` (many choices), under them. */
export function Row({ label, hint, children, htmlFor, wide = false }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; wide?: boolean }) {
  return (
    <div className={`flex rounded-md px-3 py-2.5 hover:bg-[var(--row-hover)] ${wide ? "flex-col items-start gap-2.5" : "items-center gap-6"}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block font-medium text-text">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-sm text-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A hand-drawn switch: paper track, a marker-yellow knob when on. */
export function Toggle({ on, onChange, label, disabled = false, id }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`sketch sketch-thin relative h-7 w-13 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "marker-fill" : "paper-fill"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-[var(--ink)] transition-[left] duration-150 ${on ? "left-[calc(100%-1.4rem)] bg-[var(--on-glow)]" : "left-1 bg-[var(--muted)]"}`}
      />
    </button>
  );
}

/** Pick one of a few: torn paper chips (the active one glows). */
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`torn px-3 py-1 text-sm transition-colors ${value === v ? "marker-fill font-semibold" : "paper-fill text-muted hover:text-text"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A marker line slider (same look as the volume). */
export function Slider({ value, min, max, step, onChange, label, width = "w-40", id }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; width?: string; id?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`vol-range ${width}`}
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}
