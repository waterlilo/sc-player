import type { CSSProperties } from "react";
import { EQ_BANDS } from "@shared/ipc";
import { useT } from "@/i18n";
import { useSettings } from "@/state/settings";
import { Choice, Toggle } from "./Controls";

/** Presets in dB for the 10 bands (32 Hz … 16 kHz). */
export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  rock: [4, 3, 2, 0, -1, 0, 2, 3, 4, 4],
  electronic: [5, 4, 2, 0, -2, 0, 1, 2, 4, 5],
  hiphop: [5, 5, 3, 1, -1, -1, 1, 0, 2, 3],
  night: [4, 3, 1, 0, 0, 0, 0, 1, 2, 3],
};

const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** The equalizer: on/off, presets, and a vertical marker slider per band (±12 dB). */
export default function Equalizer() {
  const t = useT();
  const eq = useSettings((s) => s.prefs.eq);
  const setPref = useSettings((s) => s.setPref);
  const presetNames = [...Object.keys(EQ_PRESETS), ...(eq.preset === "custom" ? ["custom"] : [])];

  return (
    <div className="rounded-md px-3 py-2.5">
      <div className="flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text">{t.equalizer}</div>
          <div className="mt-0.5 text-sm text-muted">{t.eqHint}</div>
        </div>
        <Toggle on={eq.enabled} onChange={(enabled) => setPref("eq", { ...eq, enabled })} label={t.equalizer} />
      </div>
      <div className={`mt-3 transition-opacity ${eq.enabled ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!eq.enabled}>
        <Choice
          label={t.presets.flat ?? "Presets"}
          value={eq.preset}
          options={presetNames.map((n) => [n, t.presets[n] ?? n])}
          onChange={(preset) => {
            const gains = EQ_PRESETS[preset];
            if (gains) setPref("eq", { ...eq, preset, gains: [...gains] });
          }}
        />
        <div className="mt-4 flex items-end justify-between gap-1 px-1">
          {EQ_BANDS.map((hz, i) => {
            const v = eq.gains[i] ?? 0;
            return (
              <label key={hz} className="flex flex-col items-center gap-1.5">
                <span className="w-8 text-center font-type text-[0.7rem] tabular-nums text-muted">{v > 0 ? `+${v}` : v}</span>
                {/* a regular slider turned upright: drags and keys behave as on any slider */}
                <span className="relative block h-28 w-6">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={v}
                    aria-label={`${label(hz)} Hz`}
                    aria-orientation="vertical"
                    onChange={(e) => {
                      const gains = [...eq.gains];
                      gains[i] = Number(e.target.value);
                      setPref("eq", { ...eq, preset: "custom", gains });
                    }}
                    className="vol-range absolute left-1/2 top-1/2 w-28"
                    style={{ "--fill": `${((v + 12) / 24) * 100}%`, transform: "translate(-50%, -50%) rotate(-90deg)" } as CSSProperties}
                  />
                </span>
                <span className="font-type text-[0.7rem] text-muted">{label(hz)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
