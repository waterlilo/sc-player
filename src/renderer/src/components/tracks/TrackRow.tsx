import { memo, type KeyboardEvent } from "react";
import { artwork, type Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useNav } from "@/state/nav";
import { player, useSubs } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import Icon from "../ui/Icon";

export const ROW_HEIGHT = 56;

/** Yellow marker stroke at the left edge of the playing row. */
function MarkerStroke() {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 56" preserveAspectRatio="none" className="absolute left-0 top-1 h-[calc(100%-0.5rem)] w-2 text-glow">
      <path d="M4.2 2 C 3.1 14, 5 27, 3.6 40 C 3.2 46, 4.6 51, 4 54" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Props {
  track: Track;
  index: number;
  current: boolean;
  playing: boolean;
  onPlay: (index: number) => void;
}

/**
 * One track. Plain and readable — no filters here, there are thousands of these. The playing one gets the marker
 * stroke, a scratched ✦ and its title in --glow. Double-click or Enter plays; ↑/↓ move between rows.
 */
function TrackRow({ track, index, current, playing, onPlay }: Props) {
  const t = useT();
  const go = useNav((s) => s.go);
  const openMenu = useUi((s) => s.openMenu);
  // a protected track plays through another upload when substitution is on (and one exists)
  const subOn = useSettings((s) => track.playability !== "ok" && s.prefs.substitute && !s.prefs.noSubstitute.includes(track.id));
  const sub = useSubs((s) => (track.playability === "ok" ? undefined : s.byTrack[track.id]));
  const alt = subOn && sub?.state === "found" ? sub.candidates[sub.pick] : undefined;
  const unplayable = (track.playability === "blocked" || track.playability === "drm") && (!subOn || sub?.state === "none");
  const badge = track.playability === "ok" ? null : alt ? t.alt : t[track.playability];
  const preview = track.playability === "preview";
  const hint = unplayable
    ? t.unplayable
    : alt
      ? t.altHint(alt.user.username)
      : preview && (!subOn || (sub?.state === "none" && !sub.failed))
        ? t.previewOnly
        : subOn
          ? preview
            ? t.willSubstitutePreview
            : t.willSubstitute
          : undefined;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") onPlay(index);
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(r.left + 48, r.top + r.height / 2, track);
    }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const row = e.currentTarget.parentElement?.[e.key === "ArrowDown" ? "nextElementSibling" : "previousElementSibling"];
      (row?.firstElementChild as HTMLElement | null)?.focus();
    }
  };

  return (
    <div
      role="row"
      tabIndex={0}
      aria-current={current || undefined}
      aria-disabled={unplayable || undefined}
      title={hint}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, track);
      }}
      onKeyDown={onKey}
      className={`group relative grid h-full grid-cols-[2.25rem_2.75rem_minmax(0,1fr)_auto_3.5rem] items-center gap-3 rounded-md pl-3 pr-2 outline-offset-[-2px] hover:bg-[var(--row-hover)] ${unplayable ? "opacity-45" : ""}`}
    >
      {current && <MarkerStroke />}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${t.play}: ${track.title}`}
        onClick={() => onPlay(index)}
        className="grid h-8 w-8 place-items-center font-type text-xs text-muted"
      >
        {current ? (
          <span className={`text-base text-glow ${playing ? "" : "opacity-70"}`} aria-hidden="true">
            ✦
          </span>
        ) : (
          <>
            <span className="group-hover:hidden">{index + 1}</span>
            <Icon name="play" size={16} className="hidden text-text group-hover:block" />
          </>
        )}
      </button>
      <div className="h-10 w-10 overflow-hidden rounded-sm bg-[var(--paper)]">
        {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />}
      </div>
      <div className="min-w-0">
        <button type="button" tabIndex={-1} onClick={() => go({ name: "track", id: track.id })} className={`block max-w-full truncate text-left text-[0.95rem] font-medium hover:underline ${current ? "text-glow" : "text-text"}`}>
          {track.title}
        </button>
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <button type="button" tabIndex={-1} className="truncate hover:text-text hover:underline" onClick={() => go({ name: "profile", userId: track.user.id })}>
            {track.artist}
          </button>
          {badge && <span className={`shrink-0 rounded-sm border border-current px-1 font-type text-[0.65rem] uppercase leading-4 ${alt ? "text-glow" : ""}`}>{badge}</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button type="button" aria-label={t.playNext} title={t.playNext} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-text" onClick={() => player.playNext(track)}>
          <Icon name="playNext" size={18} />
        </button>
        <button type="button" aria-label={t.addToQueue} title={t.addToQueue} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-text" onClick={() => player.addToQueue(track)}>
          <Icon name="queue" size={18} />
        </button>
      </div>
      <div className="text-right font-type text-xs text-muted tabular-nums">{duration(track.durationMs)}</div>
    </div>
  );
}

export default memo(TrackRow);
