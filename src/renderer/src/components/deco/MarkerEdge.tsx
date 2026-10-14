/** Points of a long wobbly stroke along 0..1000 (across: 0..10), deterministic, so every edge looks hand-drawn the same way. */
function wobble(seed: number) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts: [number, number][] = [[-5, 5 + (r() - 0.5) * 2]];
  for (let x = 40; x <= 1040; x += 40 + Math.round(r() * 30)) pts.push([x, 5 + (r() - 0.5) * 3.2]);
  return pts;
}

const toPath = (pts: [number, number][], vertical: boolean) =>
  pts.map(([along, across], i) => `${i ? "L" : "M"} ${(vertical ? across : along).toFixed(2)} ${(vertical ? along : across).toFixed(2)}`).join(" ");

const SEEDS = { a: wobble(7), b: wobble(29), c: wobble(113) };

const POS = {
  // explicit sizes: an absolutely positioned <svg> does not stretch between left/right, it takes its viewBox ratio
  top: "left-0 -top-[5px] h-[10px] w-full",
  bottom: "left-0 -bottom-[5px] h-[10px] w-full",
  left: "top-0 -left-[5px] w-[10px] h-full",
  right: "top-0 -right-[5px] w-[10px] h-full",
} as const;

/**
 * Hand-drawn separator between blocks of the window: a dark under-stroke with a lighter violet marker line on top,
 * slightly wavy. Static SVG (no filters), stretched along the edge; the strokes keep their width.
 */
export default function MarkerEdge({ side, seed = "a" }: { side: keyof typeof POS; seed?: keyof typeof SEEDS }) {
  const vertical = side === "left" || side === "right";
  const d = toPath(SEEDS[seed], vertical);
  return (
    <svg aria-hidden="true" viewBox={vertical ? "0 0 10 1000" : "0 0 1000 10"} preserveAspectRatio="none" className={`pointer-events-none absolute z-10 overflow-visible ${POS[side]}`}>
      <path d={d} fill="none" stroke="#000" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
      <path d={d} fill="none" stroke="var(--edge)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
