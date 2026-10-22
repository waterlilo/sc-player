import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PREFS_DEFAULTS, type BackgroundKind, type Look } from "@shared/ipc";
import { useT } from "@/i18n";
import { onPalette, palette, type Palette } from "@/lib/look";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import Icon from "../ui/Icon";

function Knob({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="s-knob block">
      <span className="r">
        {label}
        <b>
          {value}
          {unit}
        </b>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ "--p": `${((value - min) / (max - min)) * 100}%` } as CSSProperties} />
    </label>
  );
}

const hex = ([r, g, b]: number[]) => `rgb(${r}, ${g}, ${b})`;

function Swatches() {
  const [p, setP] = useState<Palette>(palette());
  useEffect(() => onPalette(setP), []);
  return (
    <span className="flex gap-1">
      {[p.accent, ...p.field.map((c) => c.map((v) => Math.round(v * 255)))].slice(0, 5).map((c, i) => (
        <i key={i} className="block h-3.5 w-3.5 rounded-[3px]" style={{ background: hex(c) }} />
      ))}
    </span>
  );
}

/**
 * Studio: the look at hand — background kind, its blur, dim and reaction, the panels' glass, lighter effects — next to
 * what it changes. From the sidebar's gear or the full screen player's "Background".
 */
export default function AppearancePopover() {
  const t = useT();
  const where = useUi((s) => s.appearance);
  const close = useUi((s) => s.setAppearance);
  const look = useSettings((s) => s.prefs.look);
  const setPref = useSettings((s) => s.setPref);
  const open = useNav((s) => s.open);
  const toast = useUi((s) => s.showToast);
  const box = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Look>) => setPref("look", { ...useSettings.getState().prefs.look, ...patch });

  useEffect(() => {
    if (!where) return;
    const away = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!box.current?.contains(el) && !el.closest("[data-appearance-toggle]")) close(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [where, close]);

  const pick = async () => {
    try {
      const res = await call("bg:pick");
      if (res) set({ bg: "file", bgFile: res.file, bgFileType: res.type });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const kinds: [BackgroundKind, string][] = [
    ["liquid", t.bgLiquid],
    ["cover", t.bgCover],
    ["file", t.bgFile],
    ["none", t.bgNone],
  ];

  return (
    <AnimatePresence>
      {where && (
        <motion.div
          ref={box}
          role="dialog"
          aria-label={t.secAppearance}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="s-pop s-glass w-[312px]"
          style={where === "side" ? { left: 252, bottom: 100 } : { right: 14, bottom: 58 }}
          data-keys-own
        >
          <div className="mx-2 mb-2.5 mt-1 flex items-center">
            <b className="text-[13px] font-semibold text-text">{t.secAppearance}</b>
            <span className="ml-auto text-[11px] text-[var(--s-dim)]">{kinds.find(([k]) => k === look.bg)?.[1]}</span>
          </div>
          <div className="s-lbl mx-2 mb-1.5">{t.background}</div>
          <div className="s-seg mx-2 mb-1">
            {kinds.map(([k, label]) => (
              <button key={k} type="button" className={`flex-1 ${look.bg === k ? "on" : ""}`} onClick={() => (k === "file" && !look.bgFile ? void pick() : set({ bg: k }))}>
                {label}
              </button>
            ))}
          </div>
          {look.bg === "file" && (
            <button type="button" onClick={() => void pick()} className="mx-2 mt-1 flex items-center gap-1.5 text-[11.5px] text-muted hover:text-text">
              <Icon name="image" size={13} />
              {t.bgChoose}
            </button>
          )}
          <Knob label={t.blur} value={look.bgBlur} min={0} max={40} unit="px" onChange={(v) => set({ bgBlur: v })} />
          <Knob label={t.dim} value={look.bgDim} min={0} max={100} unit="%" onChange={(v) => set({ bgDim: v })} />
          <Knob label={t.bgReact} value={look.bgReact} min={0} max={100} unit="%" onChange={(v) => set({ bgReact: v })} />
          <div className="s-lbl mx-2 mb-0.5 mt-3">{t.panels}</div>
          <Knob label={t.panelOpacity} value={look.panelOpacity} min={10} max={100} unit="%" onChange={(v) => set({ panelOpacity: v })} />
          <Knob label={t.blurBehind} value={look.panelBlur} min={0} max={60} unit="px" onChange={(v) => set({ panelBlur: v })} />
          <button type="button" role="switch" aria-checked={look.lite} onClick={() => set({ lite: !look.lite })} className="s-row mt-2.5 w-full !border-t-[var(--s-line)] !px-2 text-left">
            <Icon name="sparkle" size={17} className="text-muted" />
            <span>
              <span className="t block">{t.lighterEffects}</span>
              <span className="s block">{t.liteEffectsHint}</span>
            </span>
            <span className={`s-sw ${look.lite ? "on" : ""}`} />
          </button>
          <div className="flex items-center justify-between px-2 pb-0.5 pt-2 text-[11px] text-[var(--s-dim)]">
            <button type="button" className="hover:text-text" onClick={() => set({ ...PREFS_DEFAULTS.look, bgFile: look.bgFile, bgFileType: look.bgFileType, lite: look.lite })}>
              {t.resetToTheme}
            </button>
            <Swatches />
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-[var(--s-line)] px-2 pt-2 text-[11px] text-[var(--s-dim)]">
            <button type="button" className="hover:text-text" onClick={() => set({ design: "og" })}>
              {t.switchToOg}
            </button>
            <button
              type="button"
              className="hover:text-text"
              onClick={() => {
                close(null);
                open("settings", { name: "settings" });
              }}
            >
              {t.allSettings} →
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
