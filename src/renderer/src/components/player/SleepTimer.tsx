import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { sleep, useSleep } from "@/state/sleep";
import { IconButton } from "../ui/Buttons";

const CHOICES = [15, 30, 45, 60, 90, 120];

/** Minutes left, refreshed every 15 s while the timer runs (no per-second re-renders). */
function useMinutesLeft(endsAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [endsAt]);
  return endsAt ? Math.max(1, Math.ceil((endsAt - now) / 60_000)) : null;
}

/** The moon in the player bar: pause the music after a while, or at the end of the track. */
export default function SleepTimer() {
  const t = useT();
  const { endsAt, endOfTrack } = useSleep();
  const left = useMinutesLeft(endsAt);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = !!endsAt || endOfTrack;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = endOfTrack ? t.sleepEndOfTrackOn : left ? t.sleepIn(left) : t.sleepTimer;
  const pick = (run: () => void) => {
    run();
    setOpen(false);
  };
  const item = "block w-full px-3 py-1.5 text-left text-sm text-text outline-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)]";

  return (
    <div ref={ref} className="relative flex items-center">
      <IconButton icon="moon" label={label} on={active} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {active && <span className="pointer-events-none -ml-1 mr-1 font-type text-[0.65rem] text-glow">{endOfTrack ? "♪" : `${left}m`}</span>}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={t.sleepTimer}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.12 }}
            className="float-card paper-fill sketch sketch-thin absolute bottom-11 right-0 z-[60] w-48 rounded-md py-1.5 shadow-[4px_6px_0_rgba(0,0,0,0.5)]"
          >
            <div className="px-3 pb-1 pt-0.5 font-type text-xs text-muted">{t.sleepTimer}</div>
            {CHOICES.map((m) => (
              <button key={m} type="button" role="menuitem" className={item} onClick={() => pick(() => sleep.inMinutes(m))}>
                {t.sleepMinutes(m)}
              </button>
            ))}
            <button type="button" role="menuitem" className={item} onClick={() => pick(sleep.endOfTrack)}>
              {t.sleepEndOfTrack}
            </button>
            {active && (
              <button type="button" role="menuitem" className={`${item} text-muted`} onClick={() => pick(sleep.off)}>
                {t.sleepOff}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
