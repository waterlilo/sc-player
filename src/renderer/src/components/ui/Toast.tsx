import { AnimatePresence, motion } from "framer-motion";
import { useUi } from "@/state/ui";

/** A short typewriter message above the player ("Link copied"), gone after a couple of seconds. */
export default function Toast() {
  const toast = useUi((s) => s.toast);
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: -1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="paper-fill sketch sketch-thin rounded-md px-4 py-2 font-type text-sm text-text shadow-[3px_5px_0_rgba(0,0,0,0.45)]"
          >
            <span className="mr-2 text-glow">✦</span>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
