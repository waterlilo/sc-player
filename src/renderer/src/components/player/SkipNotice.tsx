import { AnimatePresence, motion } from "framer-motion";
import { artwork } from "@shared/types";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { useUi } from "@/state/ui";
import Icon from "../ui/Icon";

/**
 * A protected track with no other upload was skipped: a small card above the player says which, with a link to it on
 * SoundCloud (the site and the official app play it). Gone after a few seconds.
 */
export default function SkipNotice() {
  const t = useT();
  const track = useUi((s) => s.skipped);
  const clear = useUi((s) => s.clearSkipped);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-[104px] right-4 z-50">
      <AnimatePresence>
        {track && (
          <motion.div
            key={track.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="skip-notice pointer-events-auto flex w-[340px] items-center gap-3 rounded-[var(--r,10px)] p-2.5 pr-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          >
            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-[5px] bg-white/[0.06]">
              {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{t.skippedTitle}</span>
              <span className="block truncate text-[13px] font-semibold text-text" title={track.title}>
                {track.title}
              </span>
              <span className="block truncate text-[11px] text-muted">{t.skippedHint}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                void call("shell:open", track.permalinkUrl);
                clear();
              }}
              className="shrink-0 rounded-md bg-text px-2.5 py-1.5 text-xs font-semibold text-[#0b0b0d] hover:bg-white"
            >
              {t.open}
            </button>
            <button type="button" onClick={clear} aria-label={t.close} title={t.close} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:text-text">
              <Icon name="close" size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
