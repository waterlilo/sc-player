import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { artwork, type Lyrics, type Track } from "@shared/types";
import { analyser, currentTime } from "@/audio/engine";
import { useT } from "@/i18n";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { duration } from "@/lib/format";
import { player, useCurrentTrack, usePlayer, usePosition, useStreamTrack } from "@/state/player";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi, type FullTab } from "@/state/ui";
import { IconButton } from "../ui/Buttons";
import Icon from "../ui/Icon";
import { WindowButtons } from "../chrome/TitleBar";
import { QueueList, useSourceLabel } from "../studio/Queue";
import { outlinePoint, spectrum } from "./CoverRing";
import { ManualSearch, useLyrics } from "./LyricsPanel";
import { LikeButton, PlayButton } from "./PlayerBar";
import Waveform from "./Waveform";

const BANDS = 48;

/** runs `fn` 30 times a second while music plays and the window is in front; `idle` once whenever it stops */
function usePlayingLoop(fn: () => void, idle: () => void, deps: unknown[]) {
  useEffect(() => {
    let timer = 0;
    const sync = () => {
      const run = usePlayer.getState().status === "playing" && getActivity() === "active";
      if (run && !timer) timer = window.setInterval(fn, 33);
      if (!run && timer) {
        window.clearInterval(timer);
        timer = 0;
        idle();
      }
    };
    sync();
    const offActivity = subscribeActivity(sync);
    const offPlayer = usePlayer.subscribe((s, prev) => s.status !== prev.status && sync());
    return () => {
      window.clearInterval(timer);
      offActivity();
      offPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * The big cover with thin spectrum lines standing out of its outline: the lows at the bottom, the highs at the top,
 * mirrored left and right; the loud ones take the accent, a faint light breathes behind.
 */
function Halo({ track, size }: { track: Track; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reach = Math.round(size * 0.25);
  const gap = Math.round(size * 0.04);
  const pad = gap + reach + 6;
  const box = size + pad * 2;
  const levels = useRef(new Float32Array(BANDS));
  const buf = useRef<Uint8Array<ArrayBuffer> | null>(null);

  usePlayingLoop(
    () => {
      const cv = canvas.current;
      if (!cv) return;
      const g = cv.getContext("2d")!;
      const s = 2;
      const node = analyser();
      buf.current ??= new Uint8Array(node.frequencyBinCount);
      spectrum(node, buf.current, levels.current);
      const lv = levels.current;
      g.clearRect(0, 0, cv.width, cv.height);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim() || "200, 180, 240";
      const bass = (lv[1]! + lv[2]! + lv[3]!) / 3;
      const c = (pad + size / 2) * s;
      const bloom = g.createRadialGradient(c, c, size * 0.3 * s, c, c, size * 0.85 * s);
      bloom.addColorStop(0, `rgba(${accent}, ${0.1 + bass * 0.08})`);
      bloom.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = bloom;
      g.fillRect(0, 0, cv.width, cv.height);
      const n = Math.round(size * 0.55);
      g.lineWidth = 1.6 * s;
      for (let i = 0; i < n; i++) {
        const m = Math.abs((((i / n) * 2 + 1) % 2) - 1);
        const v = lv[Math.min(BANDS - 1, Math.floor(m * BANDS * 0.85))]!;
        const [px, py, nx, ny] = outlinePoint(i / n, (pad - gap) * s, (pad - gap) * s, (size + gap * 2) * s, (size + gap * 2) * s, (8 + gap) * s);
        const len = Math.min(reach, 3 + v * v * reach * 0.9) * s;
        g.strokeStyle = v > 0.55 ? `rgba(${accent}, ${0.55 + v * 0.35})` : `rgba(255,255,255,${0.14 + v * 0.4})`;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + nx * len, py + ny * len);
        g.stroke();
      }
    },
    () => {
      levels.current.fill(0);
      const cv = canvas.current;
      cv?.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
    },
    [size],
  );

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <canvas ref={canvas} width={box * 2} height={box * 2} aria-hidden="true" className="pointer-events-none absolute" style={{ width: box, height: box, left: -pad, top: -pad }} />
      <div className="np-cover relative h-full w-full overflow-hidden rounded-lg bg-[var(--paper)] shadow-[0_30px_70px_rgba(0,0,0,0.55)]">
        {track.artworkUrl && <img src={artwork(track.artworkUrl, "t500x500") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
      </div>
    </div>
  );
}

function Elapsed() {
  const position = usePosition((s) => s.position);
  return <span className="font-type text-xs tabular-nums text-muted">{duration(position * 1000)}</span>;
}

function StudioPlay() {
  const t = useT();
  const status = usePlayer((s) => s.status);
  const active = status === "playing" || status === "loading";
  return (
    <button type="button" onClick={player.toggle} aria-label={active ? t.pause : t.play} title={active ? t.pause : t.play} className="s-pp h-[52px] w-[52px]">
      <Icon name={active ? "pause" : "play"} size={22} />
    </button>
  );
}

/** Cover, title, waveform and transport, sized to the space they have. */
function Stage({ track, sound, studio = false }: { track: Track; sound: Track | null; studio?: boolean }) {
  const t = useT();
  const go = useNav((s) => s.go);
  const close = useUi((s) => s.closeFull);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const durationS = usePlayer((s) => s.duration);
  const canSend = useSocial((s) => !!s.status?.profile);
  const openSend = useSocial((s) => s.openSend);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(300);

  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      // the halo needs ~0.24 of the cover on each side; title, waveform and buttons ~210 px under it
      setSize(Math.round(Math.max(150, Math.min(340, (height - 214) / 1.5, width / 1.6))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const repeatLabel = repeat === "off" ? t.repeatOff : repeat === "all" ? t.repeatAll : t.repeatOne;
  const width = Math.max(300, Math.min(440, size + 80));

  return (
    <div ref={box} className="flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center">
      <div style={{ margin: `${Math.round(size * 0.24)}px 0` }}>
        <Halo track={track} size={size} />
      </div>
      <div className="flex items-end gap-3" style={{ width }}>
        <div className="min-w-0 flex-1">
          <p className={`np-title truncate font-semibold leading-tight text-text ${studio ? "text-[22px] tracking-[-0.015em]" : "text-[1.45rem]"}`} title={track.title}>
            {track.title}
          </p>
          <button
            type="button"
            onClick={() => {
              close();
              go({ name: "profile", userId: track.user.id });
            }}
            className="mt-1 block max-w-full truncate text-sm text-muted hover:text-text hover:underline"
          >
            {track.artist}
          </button>
        </div>
        {canSend && !studio && <IconButton icon="send" label={t.sendToFriends} onClick={() => openSend(track)} />}
        <LikeButton track={track} />
      </div>
      <div className="mt-3" style={{ width }}>
        {sound ? <Waveform key={sound.id} track={sound} height={34} /> : <div className="h-[34px]" />}
        <div className="mt-1 flex justify-between">
          <Elapsed />
          <span className="font-type text-xs tabular-nums text-muted">{duration((durationS || 0) * 1000)}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between" style={{ width }}>
        <IconButton icon="shuffle" label={t.shuffle} on={shuffle} aria-pressed={shuffle} onClick={player.toggleShuffle} />
        <IconButton icon="prev" label={t.previous} onClick={player.prev} />
        {studio ? <StudioPlay /> : <PlayButton />}
        <IconButton icon="next" label={t.next} onClick={player.next} />
        <IconButton icon={repeat === "one" ? "repeatOne" : "repeat"} label={repeatLabel} on={repeat !== "off"} onClick={player.cycleRepeat} />
      </div>
    </div>
  );
}

/** how far (0..1) each word of a line has been sung: the line's time is shared out by the length of its words */
function sweep(words: string[], start: number, next: number, now: number) {
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const span = Math.min((next - start) * 0.9, Math.max(1.2, total * 0.075));
  const p = (now - start) / span;
  let at = 0;
  return words.map((w) => {
    const a = at / total;
    const b = (at + w.length) / total;
    at += w.length + 1;
    return Math.max(0, Math.min(1, (p - a) / (b - a)));
  });
}

/**
 * Synced words, big: the line being sung lights up word by word (timed by word length — the words come with line
 * times only), the lines around it soften with distance. It follows the song unless you scrolled in the last 4 s; a
 * click on a line jumps there.
 */
function SweepLines({ lines }: { lines: NonNullable<Lyrics["synced"]> }) {
  const t = useT();
  const studioWords = useSettings((s) => s.prefs.look.design === "studio");
  const box = useRef<HTMLDivElement>(null);
  const userScroll = useRef(0);
  const [at, setAt] = useState(-1);
  const words = useMemo(() => lines.map((l) => l.text.split(/\s+/).filter(Boolean)), [lines]);

  const paint = () => {
    const now = currentTime() + 0.2;
    let cur = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i]!.t <= now) cur = i;
    else break;
    setAt(cur);
    if (cur < 0) return;
    const row = box.current?.querySelector<HTMLElement>(`[data-line="${cur}"]`);
    const spans = row?.querySelectorAll<HTMLElement>(".w");
    if (!spans?.length) return;
    const k = sweep(words[cur]!, lines[cur]!.t, lines[cur + 1]?.t ?? lines[cur]!.t + 5, now);
    spans.forEach((s, i) => s.style.setProperty("--k", `${(k[i] ?? 0) * 100}%`));
  };
  usePlayingLoop(paint, paint, [lines]);
  // paused: a seek still moves the light
  useEffect(
    () => usePosition.subscribe(() => usePlayer.getState().status !== "playing" && paint()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines],
  );

  useEffect(() => {
    const el = box.current;
    if (!el || Date.now() - userScroll.current < 4000) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${Math.max(0, at)}"]`);
    if (row) el.scrollTo({ top: row.offsetTop - el.clientHeight * 0.4 + row.offsetHeight / 2, behavior: "smooth" });
  }, [at]);

  return (
    <div ref={box} onWheel={() => (userScroll.current = Date.now())} className="np-lines relative h-full overflow-y-auto pr-10" data-keys-own>
      <div className="h-[40%]" />
      {lines.map((l, i) => {
        const d = Math.abs(i - at);
        return (
          <button
            key={`${l.t}-${i}`}
            type="button"
            data-line={i}
            onClick={() => {
              userScroll.current = 0;
              player.seek(l.t);
            }}
            className={`np-line ${i === at ? "on" : d === 1 ? "near" : d > 2 ? "far" : ""}`}
          >
            {words[i]!.length ? (
              words[i]!.map((w, j) => (
                <span key={j}>
                  {j > 0 && " "}
                  <span className="w">{w}</span>
                </span>
              ))
            ) : (
              <span className="np-gap">{studioWords ? t.instrumentalShort : "♪"}</span>
            )}
          </button>
        );
      })}
      <div className="h-[55%]" />
    </div>
  );
}

/** The right side: synced words, plain words, or nothing (then the stage takes the middle). */
function Words({ track }: { track: Track }) {
  const q = useLyrics(track);
  const l = q.data;
  if (q.isPending) return <LyricsSkeleton />;
  if (l?.synced?.length) return <SweepLines lines={l.synced} />;
  if (l?.plain)
    return (
      <div className="np-lines h-full overflow-y-auto pr-10" data-keys-own>
        <p className="whitespace-pre-line py-[18vh] text-[1.35rem] font-medium leading-relaxed text-text/80">{l.plain}</p>
      </div>
    );
  return null;
}

function hasWords(l: Lyrics | null | undefined) {
  return !!(l?.synced?.length || l?.plain);
}

const TABS: { id: FullTab; icon: "lyrics" | "queue" | "wave" }[] = [
  { id: "lyrics", icon: "lyrics" },
  { id: "queue", icon: "queue" },
  { id: "visualizer", icon: "wave" },
];

/**
 * Studio: the full screen player over the whole window — its own top bar ("Playing from …", Send to friends, back,
 * window buttons), the cover with its spectrum on the left, and on the right the words, the queue or nothing but the
 * picture (Visualizer); a dock at the bottom right switches them and opens Background.
 */
/**
 * The stage keeps its width; without a right side it glides to the middle (and grows a little for Visualizer) instead
 * of jumping there, and the right side fades in and out.
 */
function StudioBody({ track, sound, right, scale, children }: { track: Track; sound: Track | null; right: boolean; scale: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => {
      const cs = getComputedStyle(el);
      setInner(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.round(Math.min(620, Math.max(360, inner * 0.45)));
  const x = right ? 0 : Math.max(0, (inner - width) / 2);
  return (
    <div ref={box} className="absolute inset-x-0 bottom-0 top-12 flex min-h-0 gap-6 pb-14 pl-6 pr-14">
      <motion.div className="flex min-h-0 shrink-0" style={{ width }} initial={false} animate={{ x, scale }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <Stage track={track} sound={sound} studio />
      </motion.div>
      <AnimatePresence initial={false}>
        {right && (
          <motion.div
            key="right"
            className="flex min-h-0 min-w-0 flex-1 justify-center pt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.15, duration: 0.4 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Waiting for the words: a few quiet lines where they will be. */
function LyricsSkeleton() {
  const t = useT();
  return (
    <div className="flex w-full flex-col justify-center gap-6 pb-[8vh]" aria-label={t.loadingMore} role="status">
      {[72, 58, 84, 46, 66].map((w, i) => (
        <span key={i} className="np-skel block h-[26px] rounded-md" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

function StudioFull() {
  const t = useT();
  const close = useUi((s) => s.closeFull);
  const tab = useUi((s) => s.fullTab);
  const setTab = useUi((s) => s.setFullTab);
  const appearance = useUi((s) => s.appearance);
  const setAppearance = useUi((s) => s.setAppearance);
  const track = useCurrentTrack();
  const sound = useStreamTrack(track);
  const from = useSourceLabel();
  const canSend = useSocial((s) => !!s.status?.profile);
  const openSend = useSocial((s) => s.openSend);
  const words = useLyrics(track);
  const hasLyrics = words.isPending || hasWords(words.data);
  // looking for the words by hand (for this track only)
  const [searchFor, setSearchFor] = useState<number | null>(null);
  const searching = !!track && searchFor === track.id;
  const right = !!track && (tab === "queue" || (tab === "lyrics" && (hasLyrics || searching)));
  const label = (id: FullTab) => (id === "lyrics" ? t.lyrics : id === "queue" ? t.queue : t.visualizer);

  return (
    <motion.section
      aria-label={t.nowPlaying}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="now-playing absolute inset-0 z-40 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[rgba(4,4,7,0.22)]" />
      <header className="s-ftb">
        {track && from && (
          <div className="s-from s-glass">
            <span className="h-5 w-5 shrink-0 overflow-hidden rounded-[3px] bg-white/10">{track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}</span>
            {t.playingFrom} <b className="truncate">{from}</b>
          </div>
        )}
        <div className="ml-auto flex h-full items-center gap-1.5">
          {canSend && track && (
            <button type="button" className="s-btn s-glass" onClick={() => openSend(track)}>
              <Icon name="send" size={14} />
              {t.sendToFriends}
            </button>
          )}
          <button type="button" className="s-ib s-glass !h-[30px] !w-[30px]" onClick={close} aria-label={t.fullPlayerClose} title={t.fullPlayerClose}>
            <Icon name="collapse" size={14} />
          </button>
          <div className="ml-1 h-full">
            <WindowButtons />
          </div>
        </div>
      </header>
      {track ? (
        <StudioBody track={track} sound={sound} right={right} scale={tab === "visualizer" ? 1.08 : 1}>
          {tab === "queue" ? (
            <div className="s-fullq min-h-0 w-full max-w-[460px] overflow-y-auto">
              <QueueList />
            </div>
          ) : searching ? (
            <div className="w-full max-w-[560px] overflow-y-auto pt-[12vh]" data-keys-own>
              <ManualSearch track={track} onDone={() => setSearchFor(null)} />
            </div>
          ) : (
            <div className="flex min-h-0 w-full max-w-[640px]">
              <Words key={track.id} track={track} />
            </div>
          )}
        </StudioBody>
      ) : (
        <p className="relative grid h-full place-items-center text-sm text-muted">{t.nothingPlaying}</p>
      )}
      {track && tab === "lyrics" && !words.isPending && (
        <p className="absolute bottom-5 left-6 flex items-center gap-1.5 text-[11px] text-[var(--s-dim)]">
          <Icon name="lyrics" size={14} />
          {searching ? (
            <button type="button" className="hover:text-text" onClick={() => setSearchFor(null)}>
              {t.cancel}
            </button>
          ) : hasWords(words.data) ? (
            <>
              {t.syncedCredit} ·
              <button type="button" className="hover:text-text" onClick={() => setSearchFor(track.id)}>
                {t.lyricsWrong}
              </button>
            </>
          ) : words.isError ? (
            <>
              {t.lyricsOffline}
              <button type="button" className="text-muted hover:text-text" onClick={() => void words.refetch()}>
                {t.tryAgain}
              </button>
            </>
          ) : (
            <>
              {t.noLyricsShort} ·
              <button type="button" className="text-muted hover:text-text" onClick={() => setSearchFor(track.id)}>
                {t.lyricsSearch}
              </button>
            </>
          )}
        </p>
      )}
      <div className="s-dock s-glass" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} size={14} />
            {label(x.id)}
          </button>
        ))}
        <button type="button" className={appearance === "full" ? "on" : ""} onClick={() => setAppearance(appearance === "full" ? null : "full")} aria-expanded={appearance === "full"} data-appearance-toggle>
          <Icon name="image" size={14} />
          {t.background}
        </button>
      </div>
    </motion.section>
  );
}

function Full() {
  const studioFull = useSettings((s) => s.prefs.look.design === "studio");
  return studioFull ? <StudioFull /> : <OgFull />;
}

function OgFull() {
  const t = useT();
  const close = useUi((s) => s.closeFull);
  const track = useCurrentTrack();
  const sound = useStreamTrack(track);
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  const words = useLyrics(track);
  const split = !!track && (words.isPending || hasWords(words.data));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);

  return (
    <motion.section
      aria-label={t.nowPlaying}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="now-playing absolute inset-x-0 bottom-0 top-10 z-40 overflow-hidden"
    >
      {studio ? (
        <div className="absolute inset-0 bg-[rgba(4,4,7,0.28)]" />
      ) : (
        <div className="absolute inset-0 overflow-hidden bg-[#070915]">
          {track?.artworkUrl && <img src={artwork(track.artworkUrl, "t300x300") ?? undefined} alt="" className="h-full w-full scale-125 object-cover opacity-45 blur-3xl" draggable={false} />}
          <div className="absolute inset-0 bg-[rgba(6,8,18,0.55)]" />
        </div>
      )}
      <div className="absolute right-4 top-3 z-10">
        <IconButton icon="collapse" label={t.fullPlayerClose} onClick={close} />
      </div>
      {track ? (
        <div className={`relative grid h-full min-h-0 gap-10 px-12 pb-8 pt-10 ${split ? "grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" : "grid-cols-1"}`}>
          <Stage track={track} sound={sound} />
          {split && (
            <div className="flex min-h-0 min-w-0">
              <Words key={track.id} track={track} />
            </div>
          )}
        </div>
      ) : (
        <p className="relative grid h-full place-items-center font-type text-sm text-muted">{t.nothingPlaying}</p>
      )}
      {split && <p className="absolute bottom-3 left-5 font-type text-[0.65rem] text-muted/60">{t.lyricsCredit}</p>}
    </motion.section>
  );
}

/** The player over the whole window (under the title bar): opens from the player bar's cover or its ⤢ button. */
export default function NowPlaying() {
  const open = useUi((s) => s.fullOpen);
  return <AnimatePresence>{open && <Full />}</AnimatePresence>;
}
