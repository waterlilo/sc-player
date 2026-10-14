/**
 * One shared clock for the slow decorative loops (portfolio lib/animClock.ts): each smooth loop advances in 1/24 s
 * steps (its own easing still shapes the motion) and every loop starts on the same 1/24 s grid, so an idle window is
 * redrawn ~24 times a second instead of at the screen's refresh rate.
 */
const TICK = 1000 / 24;
const SMOOTH = new Set(["moon-float"]);
const STEPPED = new Set(["grain", "boil", "boil-frame", "flicker", "moon-pulse"]);
const stepped = new WeakSet<Animation>();

export function alignAnimations(root?: Element) {
  const list = root ? root.getAnimations({ subtree: true }) : document.getAnimations();
  for (const a of list) {
    if (!(a instanceof CSSAnimation)) continue;
    const smooth = SMOOTH.has(a.animationName);
    if (!smooth && !STEPPED.has(a.animationName)) continue;
    const effect = a.effect;
    if (smooth && effect && !stepped.has(a)) {
      const duration = Number(effect.getTiming().duration);
      if (duration > 0) {
        effect.updateTiming({ easing: `steps(${Math.max(1, Math.round(duration / TICK))}, end)` });
        stepped.add(a);
      }
    }
    if (a.playState === "running" && a.startTime !== null) a.startTime = Math.round(Number(a.startTime) / TICK) * TICK;
  }
}

/** Re-align after load, after the window comes back (paused loops resume off the grid) and after screen changes. */
export function initAnimationClock(onActivity: (cb: () => void) => () => void) {
  let raf = 0;
  const later = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => requestAnimationFrame(() => alignAnimations()));
  };
  window.setTimeout(later, 1200);
  onActivity(later);
  const mo = new MutationObserver(later);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-quality"] });
  let t = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(t);
    t = window.setTimeout(later, 400);
  });
  return { realign: later };
}
