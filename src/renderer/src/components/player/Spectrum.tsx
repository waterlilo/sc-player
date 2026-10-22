import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type CSSProperties } from "react";
import type { SpectrumLook } from "@shared/ipc";
import { analyser } from "@/audio/engine";
import { useT } from "@/i18n";
import { usePlayingLoop } from "@/lib/playingLoop";
import { useSettings } from "@/state/settings";
import { spectrum } from "./CoverRing";
import Icon from "../ui/Icon";

const BANDS = 48;
const accentRgb = () => getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim() || "200, 180, 240";

/**
 * The sound along the bottom of the full screen player: bars, thin lines or columns of dots, the lows in the middle
 * (mirrored to both sides) or on the left. At rest a row of quiet dots stays, like the reference players.
 */
export function BottomSpectrum({ look }: { look: SpectrumLook }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(BANDS));
  const buf = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const draw = (silent: boolean) => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr);
    const h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext("2d")!;
    if (!silent) {
      const node = analyser();
      buf.current ??= new Uint8Array(node.frequencyBinCount);
      spectrum(node, buf.current, levels.current);
    } else levels.current.fill(0);
    const lv = levels.current;
    g.clearRect(0, 0, w, h);
    const rgb = look.color === "white" ? "255, 255, 255" : accentRgb();
    const step = (look.style === "lines" ? 7 : 14) * dpr;
    const n = Math.max(8, Math.floor(w / step));
    const bar = look.style === "lines" ? 2 * dpr : step * 0.62;
    const dot = 4 * dpr;
    for (let i = 0; i < n; i++) {
      // which band this column shows: lows in the middle (mirrored) or on the left
      const u = look.mirror ? Math.abs((i + 0.5) / n - 0.5) * 2 : (i + 0.5) / n;
      const v = lv[Math.min(BANDS - 1, Math.floor(u * BANDS * 0.85))]!;
      const x = i * step + (step - bar) / 2;
      const len = Math.max(dot, v * v * (h - 2 * dpr));
      const alpha = 0.22 + v * 0.7;
      g.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
      if (look.style === "dots") {
        const count = Math.max(1, Math.round(len / (dot * 1.6)));
        for (let k = 0; k < count; k++) {
          g.beginPath();
          g.arc(x + bar / 2, h - dot / 2 - k * dot * 1.6, dot / 2, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        const r = Math.min(bar / 2, 6 * dpr);
        g.beginPath();
        g.roundRect(x, h - len, bar, len, r);
        g.fill();
      }
    }
  };

  usePlayingLoop(
    () => draw(false),
    () => draw(true),
    [look.style, look.color, look.mirror, look.height],
  );
  // the resting row as soon as it shows (and after a resize)
  useEffect(() => {
    draw(true);
    const ro = new ResizeObserver(() => draw(true));
    if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.style, look.color, look.mirror, look.height]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-[60px]" style={{ height: look.height }}>
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}

/** Studio, full screen: where and how the sound is drawn. */
export function SpectrumPopover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const look = useSettings((s) => s.prefs.spectrum);
  const setPref = useSettings((s) => s.setPref);
  const box = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<SpectrumLook>) => setPref("spectrum", { ...useSettings.getState().prefs.spectrum, ...patch });

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!box.current?.contains(el) && !el.closest("[data-spectrum-toggle]")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);

  const seg = <K extends keyof SpectrumLook>(key: K, options: [SpectrumLook[K], string][]) => (
    <div className="s-seg mx-2 mb-1">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={`flex-1 ${look[key] === v ? "on" : ""}`} onClick={() => set({ [key]: v } as Partial<SpectrumLook>)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={box}
          role="dialog"
          aria-label={t.spectrum}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="s-pop s-glass w-[312px]"
          style={{ right: 14, bottom: 58 }}
          data-keys-own
        >
          <div className="mx-2 mb-2.5 mt-1 flex items-center">
            <b className="text-[13px] font-semibold text-text">{t.spectrum}</b>
          </div>
          <div className="s-lbl mx-2 mb-1.5">{t.spectrumPlace}</div>
          {seg("place", [
            ["cover", t.spectrumCover],
            ["bottom", t.spectrumBottom],
            ["both", t.spectrumBoth],
            ["off", t.spectrumOff],
          ])}
          <div className="s-lbl mx-2 mb-1.5 mt-3">{t.spectrumStyle}</div>
          {seg("style", [
            ["bars", t.spectrumBars],
            ["lines", t.spectrumLines],
            ["dots", t.spectrumDots],
          ])}
          <div className="s-lbl mx-2 mb-1.5 mt-3">{t.spectrumColor}</div>
          {seg("color", [
            ["accent", t.spectrumAccent],
            ["white", t.spectrumWhite],
          ])}
          {(look.place === "bottom" || look.place === "both") && (
            <>
              <label className="s-knob mt-2 block">
                <span className="r">
                  {t.spectrumHeight}
                  <b>{look.height}px</b>
                </span>
                <input
                  type="range"
                  min={40}
                  max={240}
                  step={5}
                  value={look.height}
                  onChange={(e) => set({ height: Number(e.target.value) })}
                  style={{ "--p": `${((look.height - 40) / 200) * 100}%` } as CSSProperties}
                />
              </label>
              <button type="button" role="switch" aria-checked={look.mirror} onClick={() => set({ mirror: !look.mirror })} className="s-row mt-2 w-full !px-2 text-left">
                <Icon name="wave" size={17} className="text-muted" />
                <span>
                  <span className="t block">{t.spectrumMirror}</span>
                  <span className="s block">{t.spectrumMirrorHint}</span>
                </span>
                <span className={`s-sw ${look.mirror ? "on" : ""}`} />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
