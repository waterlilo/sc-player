import { Fragment, useState, type KeyboardEvent } from "react";
import type { Playlist, QueueSource, Track } from "@shared/types";
import { artwork } from "@shared/types";
import { queryClient } from "@/api/queries";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { player, usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import Icon from "../ui/Icon";

const SHOWN = 200;

/** "Playing from …": the list the queue came from, in words. */
export function useSourceLabel(): string | null {
  const t = useT();
  const source = usePlayer((s) => s.source);
  return sourceLabel(source, t);
}

export function sourceLabel(source: QueueSource, t: ReturnType<typeof useT>): string | null {
  switch (source.kind) {
    case "likes":
      return source.userId === "me" ? t.sourceLikes : t.likes;
    case "playlist":
      return queryClient.getQueryData<Playlist>(["playlist", source.playlistId])?.title ?? useSettings.getState().pinnedPlaylists.find((p) => p.id === source.playlistId)?.title ?? t.playlist;
    case "feed":
      return t.sourceFeed;
    case "search":
      return t.sourceSearch(source.query);
    case "userTracks":
      return t.tracksTab;
    default:
      return null;
  }
}

function Cover({ url, size }: { url: string | null; size: number }) {
  return (
    <span className="block shrink-0 overflow-hidden rounded-[4px] bg-white/[0.06]" style={{ width: size, height: size }}>
      {url && <img src={artwork(url, size > 40 ? "t300x300" : "large") ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />}
    </span>
  );
}

function Item({ track, index, alt, dragging, over, drag }: { track: Track; index: number; alt: boolean; dragging: boolean; over: boolean; drag: { start: () => void; over: () => void; drop: () => void; end: () => void } }) {
  const t = useT();
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
        drag.start();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        drag.over();
      }}
      onDrop={(e) => {
        e.preventDefault();
        drag.drop();
      }}
      onDragEnd={drag.end}
      onDoubleClick={() => player.jumpTo(index)}
      onKeyDown={onKey}
      className={`s-qi group relative cursor-default ${dragging ? "opacity-40" : ""}`}
    >
      {over && <span aria-hidden="true" className="absolute inset-x-2 -top-px h-0.5 rounded bg-[var(--accent)]" />}
      <Cover url={track.artworkUrl} size={28} />
      <span className="min-w-0 flex-1">
        <span className="t flex items-center">
          <span className="truncate">{track.title}</span>
          {alt && <span className="s-tag shrink-0">ALT</span>}
        </span>
        <span className="s block">{track.artist}</span>
      </span>
      <span className="d group-hover:hidden">{duration(track.durationMs)}</span>
      <button type="button" aria-label={`${t.remove}: ${track.title}`} title={t.remove} onClick={() => player.removeAt(index)} className="ml-auto hidden h-6 w-6 place-items-center rounded-md text-[var(--s-dim)] hover:text-text group-focus-within:grid group-hover:grid">
        <Icon name="close" size={12} />
      </button>
    </li>
  );
}

/** What is playing and what comes next; drag to reorder (or Alt+↑/↓), Delete removes, double-click plays. */
export function QueueList() {
  const t = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const pending = usePlayer((s) => s.pending.length);
  const autoFrom = usePlayer((s) => s.autoFrom);
  const substitute = useSettings((s) => s.prefs.substitute);
  const from = useSourceLabel();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const current = queue[index];
  const upcoming = queue.slice(index + 1, index + 1 + SHOWN);
  const more = queue.length - (index + 1) + pending;

  return (
    <>
      {current && (
        <div className="s-np">
          <Cover url={current.artworkUrl} size={44} />
          <div className="min-w-0">
            {from && <div className="s-lbl mb-[3px] truncate">{from}</div>}
            <div className="truncate text-[13px] font-semibold text-text">{current.title}</div>
            <div className="truncate text-[11.5px] text-[var(--s-dim)]">{current.artist}</div>
          </div>
        </div>
      )}
      <div className="s-lbl mx-1.5 mb-1 mt-4 flex">
        {t.upNext}
        {more > 0 && <span className="ml-auto normal-case tracking-normal text-[11px]">{t.moreCount(more)}</span>}
      </div>
      {upcoming.length ? (
        <ol>
          {upcoming.map((track, i) => {
            const qi = index + 1 + i;
            return (
              <Fragment key={`${track.id}-${qi}`}>
                {qi === autoFrom && <div className="s-lbl mx-1.5 mb-1 mt-3">{t.autopilotHeading}</div>}
                <Item
                  track={track}
                  index={qi}
                  alt={substitute && track.playability !== "ok"}
                  dragging={drag === qi}
                  over={over === qi && drag !== null && drag !== qi}
                  drag={{
                    start: () => setDrag(qi),
                    over: () => setOver(qi),
                    drop: () => {
                      if (drag !== null) player.move(drag, qi);
                      setDrag(null);
                      setOver(null);
                    },
                    end: () => {
                      setDrag(null);
                      setOver(null);
                    },
                  }}
                />
              </Fragment>
            );
          })}
        </ol>
      ) : (
        <p className="px-1.5 py-2 text-[12px] text-[var(--s-dim)]">{t.queueEmpty}</p>
      )}
    </>
  );
}

function History() {
  const t = useT();
  const history = useSettings((s) => s.history);
  if (!history.length) return <p className="px-1.5 py-2 text-[12px] text-[var(--s-dim)]">{t.emptyHistory}</p>;
  return (
    <ol>
      {history.slice(0, 100).map((track, i) => (
        <li key={`${track.id}-${i}`}>
          <button type="button" onDoubleClick={() => player.playFrom(history, i, { kind: "static" })} onKeyDown={(e) => e.key === "Enter" && player.playFrom(history, i, { kind: "static" })} className="s-qi">
            <Cover url={track.artworkUrl} size={28} />
            <span className="min-w-0 flex-1">
              <span className="t block">{track.title}</span>
              <span className="s block">{track.artist}</span>
            </span>
            <span className="d">{duration(track.durationMs)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Studio: the queue on the right of the window, next to the page. */
export default function StudioQueue() {
  const t = useT();
  const [tab, setTab] = useState<"next" | "history">("next");
  const autopilot = useSettings((s) => s.prefs.autopilot);
  const setPref = useSettings((s) => s.setPref);
  const hasUpcoming = usePlayer((s) => s.queue.length > s.index + 1);

  return (
    <aside aria-label={t.queue} className="s-queue s-glass">
      <div className="mx-1 mb-2.5 flex items-center">
        <b className="text-[13px] font-semibold text-text">{t.queue}</b>
        {tab === "next" && hasUpcoming && (
          <button type="button" onClick={player.clearUpcoming} className="ml-3 text-[11px] text-[var(--s-dim)] hover:text-text">
            {t.clearQueue}
          </button>
        )}
        <div className="s-seg ml-auto" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "next"} className={tab === "next" ? "on" : ""} onClick={() => setTab("next")}>
            {t.next}
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
            {t.history}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === "next" ? <QueueList /> : <History />}</div>
      <button type="button" role="switch" aria-checked={autopilot} onClick={() => setPref("autopilot", !autopilot)} className="s-row mt-2 w-full text-left">
        <Icon name="radio" size={17} className="text-muted" />
        <span>
          <span className="t block">{t.autopilot}</span>
          <span className="s block">{t.autopilotShort}</span>
        </span>
        <span className={`s-sw ${autopilot ? "on" : ""}`} />
      </button>
    </aside>
  );
}
