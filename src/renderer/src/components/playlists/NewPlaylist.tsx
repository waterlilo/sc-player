import { useState, type FormEvent } from "react";
import type { Playlist } from "@shared/types";
import { useT } from "@/i18n";
import { createPlaylist } from "@/lib/playlists";
import { useUi } from "@/state/ui";
import { MarkerButton } from "../ui/Buttons";

/** A name and "Create": a new playlist (with these tracks), on SoundCloud when signed in, else on this computer. */
export default function NewPlaylist({ trackIds = [], onMade, className = "" }: { trackIds?: number[]; onMade: (p: Playlist) => void; className?: string }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      onMade(await createPlaylist(name.trim() || t.newPlaylistName, trackIds));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.playlistFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className={`flex items-center gap-2 ${className}`}>
      <label className="field sketch sketch-thin paper-fill flex min-w-0 flex-1 rounded-md">
        <input
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.newPlaylistName}
          aria-label={t.playlistName}
          className="min-w-0 flex-1 px-3 py-1.5 text-sm text-text placeholder:text-muted/70"
        />
      </label>
      <MarkerButton type="submit" disabled={busy}>
        {t.create}
      </MarkerButton>
    </form>
  );
}
