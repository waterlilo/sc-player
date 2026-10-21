/**
 * A loop scribbled around the active item with the glow marker (site: active filter chips). Static SVG stretched to
 * the item; the stroke keeps its width at any size.
 */
export default function ScribbleRing({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className={`scribble-ring pointer-events-none absolute -left-3 -top-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+1.5rem)] overflow-visible text-glow ${className}`}
      style={{ filter: "drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 55%, transparent))" }}
    >
      <path
        d="M 9 23 C 6 9, 38 3, 62 4 C 87 5, 99 12, 96 22 C 93 33, 63 38, 41 37 C 17 36, 2 30, 5 19 C 7 11, 21 6, 35 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
