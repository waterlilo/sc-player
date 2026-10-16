import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

type Base = ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode };

/** Felt-tip filled button with a hand-drawn outline (site: View work). */
export function MarkerButton({ className = "", children, ...rest }: Base) {
  return (
    <button type="button" className={`sketch marker-fill inline-flex items-center gap-2 rounded-md px-5 py-2 font-semibold transition-transform hover:-rotate-1 disabled:opacity-60 ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Paper button with a thin hand-drawn outline. */
export function PaperButton({ className = "", children, ...rest }: Base) {
  return (
    <button type="button" className={`sketch sketch-thin paper-fill inline-flex items-center gap-2 rounded-md px-4 py-2 font-medium text-text transition-transform hover:rotate-1 disabled:opacity-60 ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Bare icon button; `label` is its accessible name and tooltip. `on` lights it in the glow colour. */
export function IconButton({ icon, label, on = false, filled = false, size = 20, className = "", ...rest }: Base & { icon: IconName; label: string; on?: boolean; filled?: boolean; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={rest["aria-pressed"]}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${on ? "text-glow" : "text-muted hover:text-text"} ${className}`}
      style={on ? { filter: "drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent))" } : undefined}
      {...rest}
    >
      <Icon name={icon} size={size} filled={filled} />
    </button>
  );
}
