import { useEffect, useRef, type CSSProperties } from "react";

/**
 * The night sky behind the window: feathered clouds (the site's cloud masks, tinted with the theme's --cloud) in
 * three layers of depth, as on the site.
 *
 *  far  — many small, faint clouds, slow drift, barely move with scrolling
 *  mid  — medium clouds
 *  near — a few big ones, the fastest drift, follow scrolling the most
 *
 * Sideways drift is a CSS animation stepped at 12 fps on the grain's clock (moving them every frame made the window
 * recomposite 60 times a second). Scrolling a screen moves each layer up by its own share of the scroll (parallax);
 * only the scroll *movement* counts, so switching screens doesn't make the sky jump. Clouds wrap around top ↔ bottom
 * out of sight. Everything stops with the other decorative loops (window in the background, adaptive quality); the
 * lowest quality leaves the clouds out.
 */
/** the cloud masks: a, b from the site; c–h drawn by scripts/make-clouds.mjs */
type Tex = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
type Cloud = { tex: Tex; x: number; y: number; w: number; o: number; dur: number; flip: boolean; squash: number };
type Layer = { name: "far" | "mid" | "near"; factor: number; clouds: Cloud[] };

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** y spreads over SPAN (in viewport heights) so a cloud can leave the screen and come back from the other side */
const SPAN = 2;
const TOP = -0.5;

function layer(seed: number, name: Layer["name"], factor: number, count: number, texs: Tex[], w: [number, number], o: [number, number], dur: [number, number]): Layer {
  const r = rng(seed);
  const clouds = Array.from({ length: count }, (_, i): Cloud => ({
    tex: texs[i % texs.length]!,
    // evenly down the span with some jitter, so the sky has no empty stretches
    y: ((i + 0.2 + r() * 0.6) / count) * SPAN + TOP,
    x: r(),
    w: Math.round(w[0] + r() * (w[1] - w[0])),
    o: +(o[0] + r() * (o[1] - o[0])).toFixed(3),
    dur: Math.round(dur[0] + r() * (dur[1] - dur[0])),
    flip: r() > 0.5,
    // a little taller or flatter than drawn, so the same shape never looks the same twice
    squash: +(0.75 + r() * 0.45).toFixed(2),
  }));
  return { name, factor, clouds };
}

const LAYERS: Layer[] = [
  layer(11, "far", 0.04, 9, ["f", "e", "h", "a", "f", "e", "b", "h", "f"], [16, 26], [0.08, 0.13], [380, 520]),
  layer(23, "mid", 0.12, 6, ["d", "c", "b", "h", "g", "a"], [32, 46], [0.13, 0.19], [230, 320]),
  layer(37, "near", 0.26, 4, ["c", "g", "a", "d"], [58, 76], [0.1, 0.15], [150, 200]),
];

const wrapY = (y: number) => ((((y - TOP) % SPAN) + SPAN) % SPAN) + TOP;

export default function SkyClouds() {
  const rows = useRef<(HTMLDivElement | null)[][]>(LAYERS.map(() => []));

  useEffect(() => {
    const scrolled = [0, 0, 0];
    const last = new WeakMap<Element, number>();
    let frame = 0;
    const place = () => {
      frame = 0;
      const vh = window.innerHeight;
      LAYERS.forEach((l, li) => {
        l.clouds.forEach((c, ci) => {
          const el = rows.current[li]?.[ci];
          if (el) el.style.transform = `translate3d(0, ${(wrapY(c.y - scrolled[li]! / vh) * vh).toFixed(1)}px, 0)`;
        });
      });
    };
    const onScroll = (e: Event) => {
      const el = e.target;
      // the screens' own scrolling only (not the queue, lyrics or a menu)
      if (!(el instanceof Element) || !el.closest("main") || el.closest("aside, [role=menu], [role=dialog]")) return;
      const top = el.scrollTop;
      const before = last.get(el);
      last.set(el, top);
      if (before === undefined) return;
      const delta = top - before;
      if (!delta) return;
      LAYERS.forEach((l, i) => (scrolled[i]! += delta * l.factor));
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", place);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="sky-clouds deco absolute inset-0">
      {LAYERS.map((l, li) => (
        <div key={l.name} className={`sky-layer sky-layer-${l.name} absolute inset-0`}>
          {l.clouds.map((c, ci) => (
            <div
              key={ci}
              ref={(el) => {
                rows.current[li]![ci] = el;
              }}
              className="sky-cloud-row"
            >
              <div
                className="sky-cloud"
                style={{ width: `${c.w}vw`, "--drift-dur": `${c.dur}s`, "--drift-steps": c.dur * 12, "--drift-delay": `${-Math.round(c.x * c.dur)}s` } as CSSProperties}
              >
                <div className={`sky-cloud-tex tex-cloud-${c.tex}`} style={{ opacity: c.o, transform: `scale(${c.flip ? -1 : 1}, ${c.squash})` }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
