import { memo, useState } from "react";
import { artwork, type Playlist } from "@shared/types";
import { useT } from "@/i18n";
import { useNav } from "@/state/nav";

const TILTS = [-1.6, 1.2, -0.8, 1.8, -1.2, 0.6];

/**
 * Paper card with a thick uneven outline, a slight alternating tilt and tape on some corners (site: Work cards).
 * Hovering plays a short grainy glitch on the frame; the cover itself stays clean.
 */
function PlaylistCard({ playlist, index }: { playlist: Playlist; index: number }) {
  const t = useT();
  const go = useNav((s) => s.go);
  const [glitch, setGlitch] = useState(0);
  const tape = index % 3 === 0 ? "tape" : index % 5 === 2 ? "tape tape-right" : "";
  const cover = artwork(playlist.artworkUrl, "t300x300");

  return (
    <button
      type="button"
      onClick={() => go({ name: "playlist", id: playlist.id })}
      onMouseEnter={() => setGlitch((g) => g + 1)}
      className={`paper-fill relative flex flex-col gap-2 rounded-md p-2.5 pb-3 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:rotate-0 ${tape}`}
      style={{ rotate: `${TILTS[index % TILTS.length]}deg` }}
    >
      <div key={glitch} className={`card-frame ${glitch ? "rgb-glitch" : ""}`} aria-hidden="true" />
      <div className="aspect-square w-full overflow-hidden rounded-sm bg-[var(--sky)]">
        {cover ? (
          <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <div className="stipple-night h-full w-full" />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <div className="line-clamp-2 text-[0.95rem] font-medium leading-snug text-text">{playlist.title}</div>
        <div className="mt-1 truncate font-type text-xs text-muted">
          {playlist.isAlbum ? `${t.album} · ` : ""}
          {playlist.user.username} · {t.tracks(playlist.trackCount)}
        </div>
      </div>
    </button>
  );
}

export default memo(PlaylistCard);
