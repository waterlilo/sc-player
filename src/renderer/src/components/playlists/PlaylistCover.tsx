import { artwork, type Playlist } from "@shared/types";
import { usePlaylistCover } from "@/lib/playlists";

/** a hue from the title: the same playlist keeps its colour */
function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return h % 360;
}

/**
 * A playlist's cover, filling its box: its own, else its first track's (asked once, see usePlaylistCover), else a
 * colour of its own with the title's first letter — not the same dark square for every playlist without a picture.
 */
export default function PlaylistCover({ playlist, size }: { playlist: Pick<Playlist, "id" | "title" | "artworkUrl" | "trackCount">; size: "large" | "t300x300" | "t500x500" }) {
  const src = artwork(usePlaylistCover(playlist), size);
  if (src) return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />;
  const h = hue(playlist.title || playlist.id);
  const letter = ([...playlist.title.trim()][0] ?? "♪").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="grid h-full w-full select-none place-items-center font-semibold leading-none text-white/80"
      style={{ background: `linear-gradient(140deg, hsl(${h} 42% 34%), hsl(${(h + 45) % 360} 48% 14%))`, containerType: "size" }}
    >
      <span style={{ fontSize: "46cqmin" }}>{letter}</span>
    </span>
  );
}
