import { AnimatePresence, motion } from "framer-motion";
import { useState, type KeyboardEvent } from "react";
import { artwork, type Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { player, usePlayer } from "@/state/player";
import { useUi } from "@/state/ui";
import { IconButton } from "../ui/Buttons";
import MarkerEdge from "../deco/MarkerEdge";
import Icon from "../ui/Icon";

const SHOWN = 200;

function Row({ track, index, dragging, over, onDragStart, onDragOver, onDrop, onDragEnd }: {
  track: Track;
  index: number;
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const t = useT();
  // keyboard: Enter plays, Alt+↑/↓ moves the item, Delete removes it
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") player.jumpTo(index);
    else if (e.key === "Delete") player.removeAt(index);
    else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      player.move(index, index + (e.key === "ArrowUp" ? -1 : 1));
    }
  };
  return (
    <li
      draggable
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onDoubleClick={() => player.jumpTo(index)}
      onKeyDown={onKey}
      className={`group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--row-hover)] ${dragging ? "opacity-40" : ""}`}
    >
      {over && <div aria-hidden="true" className="absolute inset-x-2 -top-px h-0.5 rounded bg-[var(--glow)]" />}
      <span className="cursor-grab text-muted opacity-50 group-hover:opacity-100" aria-hidden="true">
        <Icon name="grip" size={14} />
      </span>
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)]">
        {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-text">{track.title}</div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>
      <span className="font-type text-xs text-muted group-hover:hidden">{duration(track.durationMs)}</span>
      <button type="button" aria-label={`${t.remove}: ${track.title}`} title={t.remove} onClick={() => player.removeAt(index)} className="hidden h-7 w-7 place-items-center rounded-full text-muted hover:text-blood group-focus-within:grid group-hover:grid">
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}

/** Queue drawer: now playing, then what's next; drag to reorder (or Alt+↑/↓), Delete removes. */
export default function QueuePanel() {
  const t = useT();
  const open = useUi((s) => s.queueOpen);
  const close = useUi((s) => s.closeQueue);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const current = queue[index];
  const upcoming = queue.slice(index + 1, index + 1 + SHOWN);
  const more = queue.length - (index + 1) - upcoming.length;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label={t.queue}
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="panel absolute bottom-0 right-0 top-0 z-40 flex w-[360px] flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.45)]"
        >
          <MarkerEdge side="left" seed="b" />
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 className="display-heading -rotate-1 text-3xl text-text">{t.queue.toLowerCase()}</h2>
            <div className="flex items-center">
              {upcoming.length > 0 && (
                <button type="button" onClick={player.clearUpcoming} className="mr-1 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                  {t.clearQueue}
                </button>
              )}
              <IconButton icon="close" label={t.close} onClick={close} size={16} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {current && (
              <>
                <h3 className="px-2 pb-1 pt-1 font-type text-xs uppercase tracking-[0.2em] text-muted">{t.nowPlaying}</h3>
                <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                  <span className="pl-1 text-glow" aria-hidden="true">✦</span>
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)]">
                    {current.artworkUrl && <img src={artwork(current.artworkUrl, "large") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-glow">{current.title}</div>
                    <div className="truncate text-xs text-muted">{current.artist}</div>
                  </div>
                </div>
              </>
            )}
            <h3 className="px-2 pb-1 pt-4 font-type text-xs uppercase tracking-[0.2em] text-muted">{t.upNext}</h3>
            {upcoming.length ? (
              <ol>
                {upcoming.map((track, i) => {
                  const qi = index + 1 + i;
                  return (
                    <Row
                      key={`${track.id}-${qi}`}
                      track={track}
                      index={qi}
                      dragging={drag === qi}
                      over={over === qi && drag !== null && drag !== qi}
                      onDragStart={() => setDrag(qi)}
                      onDragOver={() => setOver(qi)}
                      onDrop={() => {
                        if (drag !== null) player.move(drag, qi);
                        setDrag(null);
                        setOver(null);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    />
                  );
                })}
              </ol>
            ) : (
              <p className="px-2 py-3 font-type text-sm text-muted">{t.queueEmpty}</p>
            )}
            {more > 0 && <p className="px-2 py-2 font-type text-xs text-muted">+{more}</p>}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
