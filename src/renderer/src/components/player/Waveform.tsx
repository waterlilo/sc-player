import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Track } from "@shared/types";
import { useWaveform } from "@/api/queries";
import { currentTime } from "@/audio/engine";
import { useT } from "@/i18n";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { duration as fmt } from "@/lib/format";
import { player, usePlayer, usePosition } from "@/state/player";

const FRAME_MS = 1000 / 30; // never more than 30 redraws a second

/** Deterministic noise, so a track's bars wobble the same way on every redraw. */
function rand(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** No waveform from SoundCloud: a calm made-up one, so the seek bar still reads as one. */
function placeholder(id: number) {
  const r = rand(id);
  return Array.from({ length: 400 }, (_, i) => 0.25 + 0.2 * Math.sin(i / 9) * Math.sin(i / 31) + r() * 0.12);
}

function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#f2dc1a";
}

interface Style {
  color: string;
  alpha: number;
  /** soft halo around the bars (the played part glows a little) */
  halo: string | null;
}

/**
 * Bars mirrored around the middle line, with clear gaps; the ends wobble very slightly so they look drawn rather than
 * printed. Painted once per size/track into an offscreen canvas.
 */
function paintBars(ctx: CanvasRenderingContext2D, peaks: number[], w: number, h: number, dpr: number, style: Style, seed: number, bar: number, gap: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = style.color;
  ctx.globalAlpha = style.alpha;
  if (style.halo) {
    ctx.shadowColor = style.halo;
    ctx.shadowBlur = 5 * dpr;
  }
  const step = (bar + gap) * dpr;
  const count = Math.max(1, Math.floor(w / step));
  const mid = h / 2;
  const half = h / 2 - 3 * dpr; // room for the halo
  const r = rand(seed);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i / count) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let peak = 0;
    for (let k = from; k < to; k++) peak = Math.max(peak, peaks[k] ?? 0);
    bars.push(peak);
  }
  // loud masters sit near the top everywhere: stretch the track's own range (quiet 5% … loudest) so its shape shows
  const sorted = [...bars].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const hi = sorted[sorted.length - 1] ?? 1;
  const span = Math.max(0.05, hi - lo);
  for (let i = 0; i < count; i++) {
    const level = Math.max(0, Math.min(1, ((bars[i] ?? 0) - lo) / span));
    const amp = Math.max(1.5 * dpr, (0.12 + 0.88 * Math.pow(level, 1.6)) * half);
    const x = i * step;
    const bw = bar * dpr;
    const up = amp + (r() - 0.5) * 0.9 * dpr;
    const down = amp + (r() - 0.5) * 0.9 * dpr;
    ctx.beginPath();
    ctx.roundRect(x, mid - up, bw, up + down, Math.min(bw / 2, 1.2 * dpr));
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.globalAlpha = 1;
}

/**
 * Seek bar drawn from the track's waveform_url: played part in --glow with a soft halo, the rest a muted violet, a thin
 * glowing playhead line, the time under the pointer on hover. Cheap by design: both colourings are painted once into offscreen
 * canvases; a frame only stacks them and is drawn only when the playhead moves by a device pixel, at most 30 times
 * a second, only while visible — nothing at all while the window is hidden.
 */
export default function Waveform({ track, height = 44, big = false }: { track: Track; height?: number; big?: boolean }) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data } = useWaveform(track.waveformUrl);
  const durationS = usePlayer((s) => s.duration) || track.durationMs / 1000;
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const position = usePosition((s) => s.position);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const kick = useRef<() => void>(() => {});
  // read by the drawing loop without restarting it
  const live = useRef({ playing, durationS });
  useLayoutEffect(() => {
    live.current = { playing, durationS };
  }, [playing, durationS]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;
    const peaks = data ?? placeholder(track.id);
    const played = document.createElement("canvas");
    const rest = document.createElement("canvas");
    let dpr = 1;
    let w = 0;
    let h = 0;
    let lastX = -1;
    let lastFrame = 0;
    let raf = 0;
    let timer = 0;
    let visible = true;
    let dirty = true;
    let glow = "";

    const paint = () => {
      dpr = window.devicePixelRatio || 1;
      w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      h = Math.max(1, Math.round(height * dpr));
      canvas.width = played.width = rest.width = w;
      canvas.height = played.height = rest.height = h;
      glow = cssColor("--glow");
      const bar = big ? 3 : 2;
      const gap = 2;
      paintBars(played.getContext("2d")!, peaks, w, h, dpr, { color: glow, alpha: 1, halo: "rgba(242, 220, 26, 0.45)" }, track.id, bar, gap);
      paintBars(rest.getContext("2d")!, peaks, w, h, dpr, { color: "#6b55c8", alpha: 0.55, halo: null }, track.id, bar, gap);
      dirty = true;
    };

    const frame = (now: number) => {
      raf = 0;
      const { playing: moving, durationS: total } = live.current;
      if (now - lastFrame >= FRAME_MS || dirty) {
        const time = drag.current ?? currentTime();
        const x = Math.round(total > 0 ? (Math.min(time, total) / total) * w : 0);
        if (x !== lastX || dirty) {
          lastX = x;
          lastFrame = now;
          dirty = false;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(rest, 0, 0);
          if (x > 0) ctx.drawImage(played, 0, 0, x, h, 0, 0, x, h);
          if (x > 0) {
            // playhead: a thin glowing line across the whole height
            ctx.shadowColor = "rgba(242, 220, 26, 0.8)";
            ctx.shadowBlur = 6 * dpr;
            ctx.fillStyle = glow;
            ctx.fillRect(x - dpr, 0, 2 * dpr, h);
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
        }
      }
      // dragging: every frame; playing: wake up when the playhead has moved by about a pixel
      if (drag.current !== null) schedule();
      else if (moving) later(total > 0 ? Math.max(FRAME_MS, (total * 1000) / w) : 250);
    };

    const later = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        schedule();
      }, ms);
    };

    const schedule = () => {
      if (raf || !visible || getActivity() === "hidden") return;
      raf = requestAnimationFrame(frame);
    };
    kick.current = () => {
      dirty = true;
      window.clearTimeout(timer);
      schedule();
    };

    paint();
    schedule();

    const ro = new ResizeObserver(() => {
      paint();
      schedule();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) kick.current();
    });
    io.observe(wrap);
    const offActivity = subscribeActivity(() => kick.current());

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      offActivity();
    };
  }, [data, track.id, height, big]);

  // play/pause, a seek or a new duration: redraw (and keep going while playing)
  useEffect(() => kick.current(), [position, playing, durationS]);

  const timeAt = (clientX: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * durationS;
  };

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = timeAt(e.clientX);
    kick.current();
  };
  const onPointerMove = (e: PointerEvent) => {
    const at = timeAt(e.clientX);
    setHover(at);
    if (drag.current !== null) {
      drag.current = at;
      kick.current();
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (drag.current === null) return;
    player.seek(timeAt(e.clientX));
    drag.current = null;
    kick.current();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      player.seekBy(e.key === "ArrowLeft" ? -5 : 5);
    }
  };

  const hoverLeft = hover !== null && durationS > 0 ? `${(hover / durationS) * 100}%` : "0";

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={0}
      aria-label={t.seek}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationS)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${fmt(position * 1000)} / ${fmt(durationS * 1000)}`}
      className="group relative w-full cursor-pointer touch-none rounded-sm"
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {hover !== null && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute top-0 w-px bg-text/50" style={{ left: hoverLeft, height: "100%" }} />
          <div aria-hidden="true" className="paper-fill pointer-events-none absolute -top-7 -translate-x-1/2 rounded px-1.5 py-0.5 font-type text-xs text-text shadow" style={{ left: hoverLeft }}>
            {fmt(hover * 1000)}
          </div>
        </>
      )}
    </div>
  );
}
