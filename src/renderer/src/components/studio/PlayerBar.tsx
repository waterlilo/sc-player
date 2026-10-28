import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isLocalTrack, artwork, type Track } from "@shared/types";
import { errorText, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { toggleLike, useLiked } from "@/state/likes";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer, usePosition, useStreamTrack } from "@/state/player";
import { useRoom, useRoomSheet } from "@/state/room";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import CoverRing from "../player/CoverRing";
import SleepTimer from "../player/SleepTimer";
import Waveform from "../player/Waveform";
import Icon, { type IconName } from "../ui/Icon";

function Btn({ icon, label, on = false, onClick, size = 17, disabled = false }: { icon: IconName; label: string; on?: boolean; onClick: () => void; size?: number; disabled?: boolean }) {
  return (
    <button type="button" className={`s-ib !h-8 !w-8 ${on ? "on" : ""}`} aria-label={label} title={label} aria-pressed={on || undefined} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={size} />
      {on && <span aria-hidden="true" className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

function Like({ track }: { track: Track }) {
  const t = useT();
  const signedIn = useAuth((s) => s.status?.mode === "session");
  const liked = useLiked(track.id);
  if (!signedIn || isLocalTrack(track.id)) return null;
  return (
    <button type="button" onClick={() => void toggleLike(track)} aria-pressed={liked} aria-label={liked ? t.unlike : t.like} title={liked ? t.unlike : t.like} className={`ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md ${liked ? "text-[var(--accent)]" : "text-muted hover:text-text"}`}>
      <Icon name="heart" size={15} filled={liked} />
    </button>
  );
}

function Elapsed() {
  const position = usePosition((s) => s.position);
  return <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--s-dim)]">{duration(position * 1000)}</span>;
}

/** Where the sound goes: the system default or one of the audio outputs. */
function Device() {
  const t = useT();
  const current = useSettings((s) => s.prefs.outputDevice);
  const setPref = useSettings((s) => s.setPref);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "audiooutput" && x.deviceId !== "default" && x.deviceId !== "communications")));
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const options = [{ id: "", label: t.systemDefault }, ...devices.map((d, i) => ({ id: d.deviceId, label: d.label || `${t.outputDevice} ${i + 1}` }))];
  return (
    <div ref={box} className="relative">
      <Btn icon="device" label={t.outputDevice} on={!!current} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="s-pop s-glass !absolute bottom-11 right-0 w-72">
          <div className="s-lbl mx-2 mb-1.5 mt-1">{t.outputDevice}</div>
          {options.map((o) => (
            <button
              key={o.id || "default"}
              type="button"
              className={`s-opt ${o.id === current ? "on" : ""}`}
              onClick={() => {
                setPref("outputDevice", o.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.id === current && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Volume() {
  const t = useT();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const shown = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1">
      <Btn icon={muted || volume === 0 ? "mute" : "volume"} label={muted ? t.unmute : t.mute} onClick={player.toggleMute} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label={t.volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        onWheel={(e) => player.setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        className="s-vol"
        style={{ "--fill": `${shown * 100}%` } as CSSProperties}
      />
    </div>
  );
}

/** Studio player: the cover with its spectrum, transport over the waveform, and the side controls. */
export default function StudioPlayerBar() {
  const t = useT();
  const track = useCurrentTrack();
  const sound = useStreamTrack(track);
  const go = useNav((s) => s.go);
  const status = usePlayer((s) => s.status);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const error = usePlayer((s) => (s.status === "error" ? s.error : null));
  const total = usePlayer((s) => s.duration);
  const sideQueue = useUi((s) => s.sideQueue);
  const toggleSideQueue = useUi((s) => s.toggleSideQueue);
  const openFull = useUi((s) => s.openFull);
  const setFullTab = useUi((s) => s.setFullTab);
  const canSend = useSocial((s) => !!s.status?.profile);
  const openSend = useSocial((s) => s.openSend);
  // listening rooms: with sc player's server in this build
  const rooms = useSocial((s) => !!s.status?.available);
  const inRoom = useRoom((s) => !!s.room);
  const roomMember = useRoom((s) => !!s.room && s.room.host !== s.me);
  const active = status === "playing" || status === "loading";
  const repeatLabel = repeat === "off" ? t.repeatOff : repeat === "all" ? t.repeatAll : t.repeatOne;

  return (
    <footer className="s-player s-glass">
      <div className="flex min-w-0 items-center gap-[22px] pl-1.5">
        <button type="button" onClick={openFull} disabled={!track} aria-label={t.fullPlayer} title={t.fullPlayer} className="relative h-[52px] w-[52px] shrink-0 enabled:cursor-zoom-in">
          {track && <CoverRing size={52} />}
          <span className="block h-full w-full overflow-hidden rounded-[5px] bg-white/[0.06]">
            {track?.artworkUrl && <img src={artwork(track.artworkUrl, "t300x300") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
          </span>
        </button>
        <div className="min-w-0">
          {track ? (
            <>
              <div className="truncate text-[13.5px] font-semibold text-text" title={track.title}>
                {track.title}
              </div>
              <button type="button" onClick={() => go({ name: "profile", userId: track.user.id })} className="mt-0.5 block max-w-full truncate text-[12px] text-muted hover:text-text hover:underline">
                {track.artist}
              </button>
            </>
          ) : (
            <span className="text-[12px] text-[var(--s-dim)]">{t.nothingPlaying}</span>
          )}
        </div>
        {track && <Like track={track} />}
      </div>

      <div className="flex min-w-0 flex-col items-center gap-1">
        <div className="flex items-center gap-[18px]">
          {/* in a listening room: no shuffle or repeat (the host's queue), tracks changed by the host only */}
          <Btn icon="shuffle" label={t.shuffle} on={shuffle && !inRoom} onClick={player.toggleShuffle} size={15} disabled={inRoom} />
          <Btn icon="prev" label={t.previous} onClick={player.prev} disabled={roomMember} />
          <button type="button" onClick={player.toggle} disabled={!hasTrack} aria-label={active ? t.pause : t.play} title={active ? t.pause : t.play} className="s-pp h-[34px] w-[34px]">
            <Icon name={active ? "pause" : "play"} size={15} />
          </button>
          <Btn icon="next" label={t.next} onClick={player.next} disabled={roomMember} />
          <Btn icon={repeat === "one" ? "repeatOne" : "repeat"} label={repeatLabel} on={repeat !== "off" && !inRoom} onClick={player.cycleRepeat} size={15} disabled={inRoom} />
        </div>
        <div className="flex w-full max-w-[560px] items-center gap-2.5">
          <Elapsed />
          <div className="min-w-0 flex-1">{sound ? <Waveform key={sound.id} track={sound} height={24} /> : <div className="h-6" />}</div>
          <span className="w-9 shrink-0 text-[10.5px] tabular-nums text-[var(--s-dim)]">{duration((total || 0) * 1000)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1">
        {error && (
          <button type="button" onClick={player.retry} title={errorText(t, error)} className="s-btn mr-1 !h-7 !px-2 text-[11px]">
            {t.retry}
          </button>
        )}
        {canSend && track && !isLocalTrack(track.id) && <Btn icon="send" label={t.sendToFriends} onClick={() => openSend(track)} />}
        {rooms && <Btn icon="users" label={t.listenTogether} on={inRoom} onClick={() => (inRoom ? !sideQueue && toggleSideQueue() : useRoomSheet.setState({ open: true }))} />}
        <Btn
          icon="lyrics"
          label={t.lyrics}
          disabled={!track}
          onClick={() => {
            setFullTab("lyrics");
            openFull();
          }}
        />
        <Btn icon="queue" label={t.queue} on={sideQueue} onClick={toggleSideQueue} />
        <SleepTimer />
        <Device />
        <Volume />
        <Btn icon="expand" label={t.fullPlayer} onClick={openFull} disabled={!track} />
      </div>
    </footer>
  );
}
