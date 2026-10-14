import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Track } from "@shared/types";
import { useWaveform } from "@/api/queries";
import { currentTime } from "@/audio/engine";
import { useT } from "@/i18n";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { duration as fmt } from "@/lib/format";
import { player, usePlayer, usePosition } from "@/state/player";

const BAR = 3; // css px
const GAP = 1;
const FRAME_MS = 1000 / 30; // never more than 30 redraws a second
const MAIN = 0.74; // bars take the top 74%, a faint reflection the rest

/** Deterministic noise, so a track's rough edges look the same on every redraw. */
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

/** Rough bars: every bar is a polygon whose top corners and sides wobble a little, as if drawn by hand. */
function paintBars(ctx: CanvasRenderingContext2D, peaks: number[], w: number, h: number, dpr: number, color: string, seed: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const step = (BAR + GAP) * dpr;
  const count = Math.max(1, Math.floor(w / step));
  const base = h * MAIN;
  const r = rand(seed);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i / count) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let peak = 0;
    for (let k = from; k < to; k++) peak = Math.max(peak, peaks[k] ?? 0);
    const amp = Math.max(0.04, peak);
    const x0 = i * step + (r() - 0.5) * 0.6 * dpr;
    const x1 = x0 + BAR * dpr + (r() - 0.5) * 0.8 * dpr;
    const top = base - amp * base * 0.96;
    const jl = (r() - 0.5) * 2.2 * dpr;
    const jr = (r() - 0.5) * 2.2 * dpr;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + (r() - 0.5) * 0.5 * dpr, base);
    ctx.lineTo(x0, top + jl);
    ctx.lineTo((x0 + x1) / 2, top + Math.min(jl, jr) - r() * 1.2 * dpr);
    ctx.lineTo(x1, top + jr);
    ctx.lineTo(x1 + (r() - 0.5) * 0.5 * dpr, base);
    ctx.closePath();
    ctx.fill();
    // reflection
    ctx.globalAlpha = 0.32;
    const refl = (h - base) * amp * 0.9;
    ctx.fillRect(x0, base + 1 * dpr, x1 - x0, refl);
  }
  ctx.globalAlpha = 1;
}

/** The "dirty" playhead glow: a speckle of dots, dense in the middle (stipple, not a smooth circle). Drawn once. */
function paintStipple(color: string, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  const r = rand(7);
  const R = size / 2;
  for (let i = 0; i < size * size * 0.22; i++) {
    const x = r() * size;
    const y = r() * size;
    const d = Math.hypot(x - R, y - R) / R;
    if (d < 1 && r() > d * 1.15) ctx.fillRect(Math.round(x), Math.round(y), 1 + Math.round(r() * 0.7), 1 + Math.round(r() * 0.7));
  }
  return c;
}

/**
 * Seek bar drawn from the track's waveform_url: played part in --glow, the rest in --sky-shade, a stippled glow at the
 * playhead, the time under the pointer on hover. Cheap by design: both colourings are painted once into offscreen
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
    let stipple: HTMLCanvasElement | null = null;
    let dpr = 1;
    let w = 0;
    let h = 0;
    let lastX = -1;
    let lastFrame = 0;
    let raf = 0;
    let timer = 0;
    let visible = true;
    let recolorUntil = 0;
    let dirty = true;
    let glow = "";

    const paint = () => {
      dpr = window.devicePixelRatio || 1;
      w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      h = Math.max(1, Math.round(height * dpr));
      canvas.width = played.width = rest.width = w;
      canvas.height = played.height = rest.height = h;
      glow = cssColor("--glow");
      paintBars(played.getContext("2d")!, peaks, w, h, dpr, glow, track.id);
      paintBars(rest.getContext("2d")!, peaks, w, h, dpr, cssColor("--sky-shade"), track.id);
      stipple = paintStipple(glow, Math.round((big ? 46 : 30) * dpr));
      dirty = true;
    };

    const frame = (now: number) => {
      raf = 0;
      const { playing: moving, durationS: total } = live.current;
      if (now < recolorUntil) paint();
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
          if (stipple && x > 0) {
            const s = stipple.width;
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.85;
            ctx.drawImage(stipple, x - s / 2, h * MAIN * 0.5 - s / 2);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = glow;
            ctx.fillRect(x - dpr, 0, 2 * dpr, h * MAIN);
          }
        }
      }
      // dragging or recolouring: every frame; playing: wake up when the playhead has moved by about a pixel
      if (drag.current !== null || now < recolorUntil) schedule();
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
    // theme switch: the colours crossfade for 1.2 s, repaint along
    const mo = new MutationObserver(() => {
      recolorUntil = performance.now() + 1300;
      schedule();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
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
          <div aria-hidden="true" className="pointer-events-none absolute top-0 w-px bg-text/50" style={{ left: hoverLeft, height: `${MAIN * 100}%` }} />
          <div aria-hidden="true" className="paper-fill pointer-events-none absolute -top-7 -translate-x-1/2 rounded px-1.5 py-0.5 font-type text-xs text-text shadow" style={{ left: hoverLeft }}>
            {fmt(hover * 1000)}
          </div>
        </>
      )}
    </div>
  );
}
