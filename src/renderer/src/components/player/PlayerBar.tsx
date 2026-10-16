import { useState, type CSSProperties } from "react";
import { artwork, type Track } from "@shared/types";
import { errorText, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useNav } from "@/state/nav";
import { call } from "@/lib/sky";
import { player, useCurrentTrack, usePlayer, usePosition, useStreamTrack } from "@/state/player";
import { useUi } from "@/state/ui";
import { useAuth } from "@/state/auth";
import { toggleLike, useLiked } from "@/state/likes";
import { IconButton } from "../ui/Buttons";
import MarkerEdge from "../deco/MarkerEdge";
import ExpandingTitle from "./ExpandingTitle";
import Icon from "../ui/Icon";
import Waveform from "./Waveform";
import SleepTimer from "./SleepTimer";

function Time() {
  const position = usePosition((s) => s.position);
  return <span className="w-12 shrink-0 text-right font-type text-xs tabular-nums text-muted">{duration(position * 1000)}</span>;
}

/** "via an upload by …" under a substituted track, and the button that switches to another upload of it. */
function SubstituteLine({ sound }: { sound: Track }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const another = () => {
    setBusy(true);
    void player
      .tryAnotherVersion()
      .then((r) => toast(r ? t.nowFromUpload(r.upload.user.username, r.at, r.of) : t.noOtherUpload))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex min-w-0 items-center gap-2 font-type text-[0.7rem]">
      <button type="button" onClick={() => void call("shell:open", sound.permalinkUrl)} title={sound.title} className="min-w-0 truncate text-glow/80 hover:text-glow hover:underline">
        {t.viaUpload(sound.user.username)}
      </button>
      <button type="button" onClick={another} disabled={busy} title={t.tryAnother} className="flex shrink-0 items-center gap-1 rounded-sm border border-glow/40 px-1.5 py-px text-glow/90 hover:border-glow hover:text-glow disabled:opacity-60">
        <Icon name="shuffle" size={12} />
        {busy ? t.findingUpload : t.anotherUpload}
      </button>
    </div>
  );
}

/** ♥ for the current track (signed in only). */
function LikeButton({ track }: { track: Track }) {
  const t = useT();
  const signedIn = useAuth((s) => s.status?.mode === "session");
  const liked = useLiked(track.id);
  if (!signedIn) return null;
  return <IconButton icon="heart" label={liked ? t.unlike : t.like} on={liked} filled={liked} aria-pressed={liked} onClick={() => void toggleLike(track)} />;
}

function PlayButton() {
  const t = useT();
  const status = usePlayer((s) => s.status);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const active = status === "playing" || status === "loading";
  return (
    <button
      type="button"
      onClick={player.toggle}
      disabled={!hasTrack}
      aria-label={active ? t.pause : t.play}
      title={active ? t.pause : t.play}
      className="sketch sketch-thin marker-fill mx-1 grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform hover:rotate-6 disabled:opacity-50"
    >
      <Icon name={active ? "pause" : "play"} size={22} />
    </button>
  );
}

function Volume() {
  const t = useT();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const shown = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1">
      <IconButton icon={muted || volume === 0 ? "mute" : "volume"} label={muted ? t.unmute : t.mute} onClick={player.toggleMute} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label={t.volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        onWheel={(e) => player.setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        className="vol-range w-24"
        style={{ "--fill": `${shown * 100}%` } as CSSProperties}
      />
    </div>
  );
}

/** The player along the bottom: what's playing, transport, the waveform seek bar, volume and the queue. */
export default function PlayerBar() {
  const t = useT();
  const track = useCurrentTrack();
  // a protected track plays from another upload: its waveform and link
  const sound = useStreamTrack(track);
  const substituted = !!track && !!sound && sound.id !== track.id;
  const go = useNav((s) => s.go);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const error = usePlayer((s) => (s.status === "error" ? s.error : null));
  const durationS = usePlayer((s) => s.duration);
  const queueOpen = useUi((s) => s.queueOpen);
  const toggleQueue = useUi((s) => s.toggleQueue);
  const lyricsOpen = useUi((s) => s.lyricsOpen);
  const toggleLyrics = useUi((s) => s.toggleLyrics);

  const repeatLabel = repeat === "off" ? t.repeatOff : repeat === "all" ? t.repeatAll : t.repeatOne;

  return (
    <footer className="panel relative z-30 grid h-[88px] grid-cols-[minmax(220px,300px)_minmax(0,1fr)_minmax(280px,320px)] items-center gap-6 px-4">
      <MarkerEdge side="top" seed="c" />
      {/* now playing */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)] shadow-[3px_4px_0_rgba(0,0,0,0.35)]">
          {track?.artworkUrl && <img src={artwork(track.artworkUrl, "t300x300") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
        </div>
        <div className="min-w-0 flex-1">
          {track ? (
            <>
              {/* keyed: a new track starts closed */}
              <ExpandingTitle key={track.id} text={track.title} />
              <button type="button" onClick={() => go({ name: "profile", userId: track.user.id })} className="mt-1 block max-w-full truncate text-sm text-muted hover:text-text hover:underline">
                {track.artist}
              </button>
              {substituted && sound && <SubstituteLine sound={sound} />}
            </>
          ) : (
            <span className="font-type text-sm text-muted">{t.nothingPlaying}</span>
          )}
        </div>
        {track && <LikeButton track={track} />}
      </div>

      {/* transport + waveform */}
      <div className="flex min-w-0 flex-col items-stretch gap-1">
        <div className="flex items-center justify-center gap-2">
          <IconButton icon="shuffle" label={t.shuffle} on={shuffle} aria-pressed={shuffle} onClick={player.toggleShuffle} />
          <IconButton icon="prev" label={t.previous} onClick={player.prev} />
          <PlayButton />
          <IconButton icon="next" label={t.next} onClick={player.next} />
          <IconButton icon={repeat === "one" ? "repeatOne" : "repeat"} label={repeatLabel} on={repeat !== "off"} onClick={player.cycleRepeat} />
        </div>
        <div className="flex items-center gap-2">
          <Time />
          <div className="min-w-0 flex-1">
            {sound ? <Waveform key={sound.id} track={sound} height={34} /> : <div className="h-[34px]" />}
          </div>
          <span className="w-12 shrink-0 font-type text-xs tabular-nums text-muted">{duration((durationS || 0) * 1000)}</span>
        </div>
      </div>

      {/* volume, queue */}
      <div className="flex items-center justify-end gap-2">
        {error && (
          <button type="button" onClick={player.retry} title={errorText(t, error)} className="max-w-[9rem] truncate rounded-md px-2 py-1 font-type text-xs text-text hover:bg-[var(--row-hover)]">
            <span className="mr-1 text-blood">✖</span>
            {t.retry}
          </button>
        )}
        <SleepTimer />
        <Volume />
        <IconButton icon="lyrics" label={t.lyrics} on={lyricsOpen} aria-pressed={lyricsOpen} onClick={toggleLyrics} />
        <IconButton icon="queue" label={t.queue} on={queueOpen} aria-pressed={queueOpen} onClick={toggleQueue} />
      </div>
    </footer>
  );
}
