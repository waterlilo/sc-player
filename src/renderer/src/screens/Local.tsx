import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import type { QueueSource } from "@shared/types";
import ListFilter, { useListFilter } from "@/components/tracks/ListFilter";
import TrackList from "@/components/tracks/TrackList";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { player } from "@/state/player";
import { useUi } from "@/state/ui";

const SOURCE: QueueSource = { kind: "static" };
export const localKey = ["local-tracks"] as const;

/**
 * Music from this computer: files added here (or dropped onto the page) play like any track and go into playlists,
 * but only here — friends, rooms and SoundCloud never get them.
 */
export default function Local() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const q = useQuery({ queryKey: localKey, queryFn: () => call("local:list") });
  const tracks = q.data ?? [];
  const f = useListFilter("local", tracks, SOURCE, { hasMore: false, loadingMore: false });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const added = async (run: () => Promise<number>) => {
    setBusy(true);
    try {
      const n = await run();
      if (n) {
        toast(t.localAdded(n));
        await client.invalidateQueries({ queryKey: localKey });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((file) => window.sky.pathOf(file)).filter(Boolean);
    if (paths.length) void added(() => call("local:addPaths", paths));
  };

  return (
    <Screen label={t.localMusic}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
        onDrop={drop}
        className={`min-h-[60vh] rounded-md transition-colors ${over ? "bg-white/[0.04] outline-dashed outline-1 outline-white/25" : ""}`}
      >
        <ScreenTitle meta={tracks.length ? t.tracks(tracks.length) : undefined}>{t.localMusic.toLowerCase()}</ScreenTitle>
        <p className="-mt-2 mb-4 max-w-xl text-sm text-muted">{t.localHint}</p>
        <div className="mb-5 flex flex-wrap gap-3">
          <MarkerButton disabled={!f.tracks.length} onClick={() => player.playFrom(f.tracks, 0, SOURCE)}>
            <Icon name="play" size={18} /> {t.playAll}
          </MarkerButton>
          <PaperButton disabled={!f.tracks.length} onClick={() => player.shuffleFrom(f.tracks, SOURCE)}>
            <Icon name="shuffle" size={18} /> {t.shuffleAll}
          </PaperButton>
          <PaperButton disabled={busy} onClick={() => void added(() => call("local:add", false))}>
            <Icon name="plus" size={16} /> {t.localAddFiles}
          </PaperButton>
          <PaperButton disabled={busy} onClick={() => void added(() => call("local:add", true))}>
            {t.localAddFolder}
          </PaperButton>
        </div>
        {q.isPending ? (
          <Loading />
        ) : !tracks.length ? (
          <EmptyState caption={t.localEmpty} />
        ) : (
          <>
            <ListFilter f={f} count={f.tracks.length} />
            {f.tracks.length ? <TrackList tracks={f.tracks} source={f.source} label={t.localMusic} /> : <EmptyState caption={t.nothingFound} />}
          </>
        )}
      </div>
    </Screen>
  );
}
