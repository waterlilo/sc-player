import type { ReactNode } from "react";
import ScribbleRing from "./ScribbleRing";

const TILTS = [-2, 1.5, -1, 2, -1.5, 1];

/** Torn-paper chip for tabs and filters, tilted −2°…2°; the active one gets the scribbled ring. */
export default function Chip({ active, onClick, children, index = 0 }: { active: boolean; onClick: () => void; children: ReactNode; index?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="relative px-1 py-1 transition-transform hover:-translate-y-px"
      style={{ rotate: `${TILTS[index % TILTS.length]}deg` }}
    >
      <span className={`paper-fill torn block px-4 py-1.5 text-sm font-medium ${active ? "text-text" : "text-muted"}`}>{children}</span>
      {active && <ScribbleRing />}
    </button>
  );
}
