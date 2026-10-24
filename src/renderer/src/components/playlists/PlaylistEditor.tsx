import { useEffect, useEffectEvent, useState } from "react";
import { artwork, type Playlist, type Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { renamePlaylist, setTracks } from "@/lib/playlists";
import { call } from "@/lib/sky";
import { useUi } from "@/state/ui";
import { MarkerButton, PaperButton } from "../ui/Buttons";
import Icon from "../ui/Icon";
import { EmptyState, Loading } from "../ui/States";

/** a row of the list being edited: the track, or only its id when SoundCloud doesn't give it any more */
interface Row {
  id: number;
  track: Track | null;
}

/**
 * An own playlist's name and tracks, changed in place: drag a row to move it, × to take it out, then Save. Works on
 * the whole list of ids — a track SoundCloud can't give right now is a row too, so saving never drops it unasked.
 */
export default function PlaylistEditor({ playlist, onDone }: { playlist: Playlist; onDone: () => void }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [first, setFirst] = useState<number[]>([]);
  const [title, setTitle] = useState(playlist.title);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // loading failed: say so and leave the editor (not a dependency of the load: it changes on every render)
  const failed = useEffectEvent(() => {
    toast(t.playlistFailed);
    onDone();
  });
  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const ids = await call("data:sourceIds", { kind: "playlist", playlistId: playlist.id, cursor: null });
        const known = new Map<number, Track>();
        for (let i = 0; i < ids.length; i += 200) for (const tr of await call("data:tracks", ids.slice(i, i + 200))) known.set(tr.id, tr);
        if (gone) return;
        setFirst(ids);
        setRows(ids.map((id) => ({ id, track: known.get(id) ?? null })));
      } catch {
        if (!gone) failed();
      }
    })();
    return () => {
      gone = true;
    };
  }, [playlist.id]);

  const move = (from: number, to: number) =>
    setRows((list) => {
      if (!list || from === to) return list;
      const next = [...list];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it!);
      return next;
    });

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      const name = title.trim();
      if (name && name !== playlist.title) await renamePlaylist(playlist.id, name);
      const ids = rows.map((r) => r.id);
      if (ids.length !== first.length || ids.some((id, i) => id !== first[i])) await setTracks(playlist.id, ids);
      onDone();
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.playlistFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={t.editPlaylist}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="field sketch sketch-thin paper-fill flex min-w-[14rem] flex-1 rounded-md">
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} aria-label={t.playlistName} className="min-w-0 flex-1 px-3 py-2 text-text" />
        </label>
        <MarkerButton disabled={!rows || saving} onClick={() => void save()}>
          {t.save}
        </MarkerButton>
        <PaperButton disabled={saving} onClick={onDone}>
          {t.cancel}
        </PaperButton>
      </div>
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState caption={t.playlistEmpty} />
      ) : (
        <>
          <p className="mb-2 font-type text-xs text-muted">{t.editPlaylistHint}</p>
          <ol>
            {rows.map((r, i) => (
              <li
                key={r.id}
                draggable
                onDragStart={(e) => {
                  setDragged(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragged === null) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged !== null) move(dragged, i);
                  setDragged(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
                className={`group relative flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--row-hover)] ${dragged === i ? "opacity-40" : ""}`}
              >
                {over === i && dragged !== null && dragged !== i && <span aria-hidden="true" className={`absolute inset-x-2 h-0.5 rounded bg-[var(--accent,var(--glow))] ${dragged > i ? "-top-px" : "-bottom-px"}`} />}
                <span className="cursor-grab text-muted" aria-hidden="true">
                  <Icon name="grip" size={16} />
                </span>
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)]">
                  {r.track?.artworkUrl && <img src={artwork(r.track.artworkUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{r.track?.title ?? t.trackUnavailable}</span>
                  <span className="block truncate text-xs text-muted">{r.track?.artist ?? ""}</span>
                </span>
                <span className="font-type text-xs tabular-nums text-muted">{r.track ? duration(r.track.durationMs) : ""}</span>
                {/* keyboard: move up/down without dragging */}
                <button type="button" aria-label={t.moveUp} title={t.moveUp} disabled={i === 0} onClick={() => move(i, i - 1)} className="grid h-7 w-7 place-items-center rounded-md text-muted opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:invisible">
                  <Icon name="back" size={14} className="rotate-90" />
                </button>
                <button type="button" aria-label={t.removeFromPlaylist} title={t.removeFromPlaylist} onClick={() => setRows((list) => list?.filter((x) => x.id !== r.id) ?? list)} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:text-text">
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
