import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getScroll, routeKey, setScroll } from "@/state/viewState";

/**
 * The scrolling element is handed down as state, not a ref: when a page comes back with its data already cached, the
 * list mounts in the same commit as the page, before a ref would be attached — the virtual list then saw no scroller
 * and drew nothing. With state, the list renders again once the element exists.
 */
const ScrollContext = createContext<HTMLDivElement | null | undefined>(undefined);

/**
 * The scrolling area of a screen; long lists inside virtualize against it. Its scroll position is remembered per page
 * (and per `part`, e.g. a profile's tab) and restored when you come back — retried for a moment while the content
 * is still growing to that height, and given up as soon as you scroll yourself.
 */
export function Screen({ children, label, part = "" }: { children: ReactNode; label: string; part?: string }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el) return;
    const key = `${routeKey()}|${part}`;
    const target = getScroll(key);
    let raf = 0;
    let tries = 0;
    let restoring = target > 0;
    // the list inside may still move the scroller on its first frames (the virtualizer settles its own offset), so
    // the position is held for a few frames after it first sticks, and kept trying while the content grows
    let held = 0;
    const restore = () => {
      if (!restoring) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) held++;
      if (held >= 12 || ++tries > 90) restoring = false;
      else raf = requestAnimationFrame(restore);
    };
    if (restoring) restore();
    // only scrolling you do is remembered: when a tab swaps the content, the browser clamps the position, and that
    // must not overwrite what the previous tab remembered
    let userUntil = 0;
    const byUser = () => {
      restoring = false;
      userUntil = performance.now() + 1000;
    };
    const onScroll = () => {
      if (performance.now() < userUntil) setScroll(key, el.scrollTop);
    };
    const inputs = ["wheel", "pointerdown", "keydown", "touchmove"] as const;
    for (const ev of inputs) el.addEventListener(ev, byUser, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      for (const ev of inputs) el.removeEventListener(ev, byUser);
      el.removeEventListener("scroll", onScroll);
    };
  }, [el, part]);

  return (
    <ScrollContext.Provider value={el}>
      <div ref={setEl} role="region" aria-label={label} className="h-full overflow-y-auto overflow-x-hidden px-8 pb-10 pt-6" style={{ scrollbarGutter: "stable" }}>
        {children}
      </div>
    </ScrollContext.Provider>
  );
}

/** The screen's scroller (null for the first render). */
export function useScrollElement() {
  const el = useContext(ScrollContext);
  if (el === undefined) throw new Error("useScrollElement outside <Screen>");
  return el;
}

/** Screen title in the display font with its dirty glow, and an optional line of typewriter meta. */
export function ScreenTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end gap-4">
      <h1 className="display-heading -rotate-1 text-5xl leading-none text-text">{children}</h1>
      {meta && <span className="pb-1 font-type text-sm uppercase tracking-wider text-muted">{meta}</span>}
    </header>
  );
}
