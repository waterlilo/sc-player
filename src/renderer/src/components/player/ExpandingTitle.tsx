import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";

const OPEN_DELAY_MS = 120; // a pointer just passing by doesn't open it

/**
 * The player's track title. Static and cut with "…" when it doesn't fit; hovering (or focusing) it unrolls the full
 * title as a torn paper label with a bit of tape — it grows from the cut width to the full width while the words stay
 * exactly where they were, so it reads as the line unfolding. One short animation, nothing runs at rest.
 */
export default function ExpandingTitle({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);
  const [cutWidth, setCutWidth] = useState(0);
  const timer = useRef(0);
  const still = useReducedMotion() ?? false;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
      setCutWidth(el.clientWidth);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const show = () => {
    if (!overflow) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  // the label's padding: the text inside sits exactly over the cut title
  const PAD_X = 10;
  const PAD_Y = 6;

  return (
    <div className="relative min-w-0" onMouseEnter={show} onMouseLeave={hide}>
      <div ref={ref} tabIndex={overflow ? 0 : -1} onFocus={show} onBlur={hide} className="truncate rounded-sm font-medium text-text" aria-label={text}>
        {text}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute z-50"
            style={{ left: -PAD_X, top: -PAD_Y, transformOrigin: "left center" }}
            initial={still ? false : { rotate: 0, y: 0 }}
            animate={{ rotate: -1.5, y: -3 }}
            exit={still ? undefined : { rotate: 0, y: 0, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
          >
            <motion.div
              className="paper-fill sketch sketch-thin tape relative overflow-visible rounded-md shadow-[4px_6px_0_rgba(0,0,0,0.45)]"
              initial={still ? false : { width: cutWidth + PAD_X * 2 }}
              animate={{ width: "auto" }}
              exit={still ? undefined : { width: cutWidth + PAD_X * 2 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            >
              <div className="overflow-hidden" style={{ padding: `${PAD_Y}px ${PAD_X}px` }}>
                <div className="max-w-[calc(100vw-110px)] truncate font-medium text-text">
                  {text}
                  <span className="pl-2 text-[0.8em] text-glow">✦</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
