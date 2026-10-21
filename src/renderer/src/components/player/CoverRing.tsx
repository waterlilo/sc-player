import { useEffect, useRef } from "react";
import { analyser } from "@/audio/engine";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { usePlayer } from "@/state/player";

const BANDS = 48;
const LINES = 64;

/** a point on a rounded square's outline at 0..1 of the way round, with its outward normal */
export function outlinePoint(u: number, x: number, y: number, w: number, h: number, r: number): [number, number, number, number] {
  const sw = w - 2 * r;
  const sh = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  let d = u * (2 * sw + 2 * sh + 4 * arc);
  const corner = (cx: number, cy: number, a0: number, s: number): [number, number, number, number] => {
    const a = a0 + s / r;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)];
  };
  const parts: [number, (s: number) => [number, number, number, number]][] = [
    [sw, (s) => [x + r + s, y, 0, -1]],
    [arc, (s) => corner(x + w - r, y + r, -Math.PI / 2, s)],
    [sh, (s) => [x + w, y + r + s, 1, 0]],
    [arc, (s) => corner(x + w - r, y + h - r, 0, s)],
    [sw, (s) => [x + w - r - s, y + h, 0, 1]],
    [arc, (s) => corner(x + r, y + h - r, Math.PI / 2, s)],
    [sh, (s) => [x, y + h - r - s, -1, 0]],
    [arc, (s) => corner(x + r, y + r, Math.PI, s)],
  ];
  for (const [len, at] of parts) {
    if (d <= len) return at(d);
    d -= len;
  }
  return parts[0]![1](0);
}

/** the spectrum in BANDS log-spaced bands (40 Hz – 14 kHz), each 0..1 */
export function spectrum(node: AnalyserNode, buf: Uint8Array<ArrayBuffer>, out: Float32Array) {
  node.getByteFrequencyData(buf);
  const hz = node.context.sampleRate / node.fftSize;
  for (let i = 0; i < out.length; i++) {
    const lo = 40 * Math.pow(14000 / 40, i / out.length);
    const hi = 40 * Math.pow(14000 / 40, (i + 1) / out.length);
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.max(a, Math.min(buf.length - 1, Math.ceil(hi / hz)));
    let sum = 0;
    for (let j = a; j <= b; j++) sum += buf[j]!;
    const v = Math.min(1, (sum / (b - a + 1) / 255) * 1.25);
    // quick up, slower down
    out[i] = v > out[i]! ? v : out[i]! + (v - out[i]!) * 0.25;
  }
}

/**
 * Thin spectrum lines standing out of the small cover's outline in the player bar (studio design): the lows at the
 * bottom, the highs at the top, the same on both sides; the loud ones take the accent. 30 frames a second, only while
 * music plays and the window is in front; otherwise it is cleared.
 */
export default function CoverRing({ size }: { size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current!;
    const g = cv.getContext("2d")!;
    const levels = new Float32Array(BANDS);
    let buf: Uint8Array<ArrayBuffer> | null = null;
    let timer = 0;
    const pad = 22;
    const scale = 2;
    const draw = () => {
      const node = analyser();
      buf ??= new Uint8Array(node.frequencyBinCount);
      spectrum(node, buf, levels);
      g.clearRect(0, 0, cv.width, cv.height);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim() || "200, 180, 240";
      g.lineWidth = 1.4 * scale;
      for (let i = 0; i < LINES; i++) {
        const m = Math.abs(((i / LINES) * 2 + 1) % 2 - 1);
        const v = levels[Math.min(BANDS - 1, Math.floor(m * BANDS * 0.8))]!;
        const [px, py, nx, ny] = outlinePoint(i / LINES, (pad - 4) * scale, (pad - 4) * scale, (size + 8) * scale, (size + 8) * scale, 8 * scale);
        const len = Math.min(9, 1 + v * v * 8) * scale;
        g.strokeStyle = v > 0.55 ? `rgba(${accent}, 0.9)` : `rgba(255,255,255,${0.12 + v * 0.35})`;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + nx * len, py + ny * len);
        g.stroke();
      }
    };
    const sync = () => {
      const run = usePlayer.getState().status === "playing" && getActivity() === "active";
      if (run && !timer) timer = window.setInterval(draw, 33);
      if (!run && timer) {
        window.clearInterval(timer);
        timer = 0;
        levels.fill(0);
        g.clearRect(0, 0, cv.width, cv.height);
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
  }, [size]);
  const box = size + 44;
  return <canvas ref={canvas} width={box * 2} height={box * 2} aria-hidden="true" className="pointer-events-none absolute" style={{ width: box, height: box, left: -22, top: -22 }} />;
}
