import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";

const ScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** The scrolling area of a screen; long lists inside virtualize against it. */
export function Screen({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <ScrollContext.Provider value={ref}>
      <div ref={ref} role="region" aria-label={label} className="h-full overflow-y-auto overflow-x-hidden px-8 pb-10 pt-6" style={{ scrollbarGutter: "stable" }}>
        {children}
      </div>
    </ScrollContext.Provider>
  );
}

export function useScrollElement() {
  const ref = useContext(ScrollContext);
  if (!ref) throw new Error("useScrollElement outside <Screen>");
  return ref;
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
