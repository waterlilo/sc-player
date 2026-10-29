import { useState } from "react";
import { PREFS_DEFAULTS, type BackgroundKind, type Look } from "@shared/ipc";
import { PaperButton } from "@/components/ui/Buttons";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { ColorPicker, Unfold } from "./ColorPicker";
import { Choice, Row, Section, Slider, Toggle } from "./Controls";
import SteamImport from "./SteamImport";

/** dark ones for the interface, bright ones for the accent */
const SURFACES = ["#0e0e11", "#1c1730", "#14213d", "#0f2a24", "#2a1220", "#2b1d0e", "#1b1b1b", "#0b1a2e"];
const ACCENTS = ["#b2a0e6", "#7aa2f7", "#5ad1c8", "#9ece6a", "#f2dc1a", "#ff9e64", "#f7768e", "#e8e8ec"];

/**
 * Settings → Appearance: the design (studio or the og night sky) and, for studio, the background (living colours,
 * the cover, your own image / GIF / video, or none) with its blur, dim and reaction to sound, and the glass panels'
 * opacity and blur. Every change shows at once; "Reset" brings back the defaults.
 */
export default function Appearance() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.setPref);
  const toast = useUi((s) => s.showToast);
  const look = prefs.look;
  const set = (patch: Partial<Look>) => setPref("look", { ...useSettings.getState().prefs.look, ...patch });
  const colorLabels = { hue: t.colorHue, saturation: t.colorSaturation, lightness: t.colorLightness, code: t.colorCode };
  const [steam, setSteam] = useState(false);

  const pick = async () => {
    try {
      const res = await call("bg:pick");
      if (res) set({ bg: "file", bgFile: res.file, bgFileType: res.type });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section title={t.secAppearance}>
      <Row label={t.background} hint={look.bg === "file" ? (look.bgFile ? `${look.bgFileType === "video" ? t.bgVideo : t.bgImage}` : t.bgFileNone) : t.backgroundHint}>
        <Choice<BackgroundKind>
          value={look.bg}
          onChange={(v) => (v === "file" && !look.bgFile ? void pick() : set({ bg: v }))}
          label={t.background}
          options={[["liquid", t.bgLiquid], ["cover", t.bgCover], ["file", t.bgFile], ["none", t.bgNone]]}
        />
        {look.bg === "file" && <PaperButton onClick={() => void pick()}>{t.bgChoose}</PaperButton>}
        <PaperButton onClick={() => setSteam(true)} title={t.steamImport}>
          {t.bgSteam}
        </PaperButton>
        {steam && <SteamImport onClose={() => setSteam(false)} />}
      </Row>
      <Row label={t.bgBlur} hint={`${look.bgBlur} px`}>
        <Slider value={look.bgBlur} min={0} max={40} step={1} onChange={(v) => set({ bgBlur: v })} label={t.bgBlur} />
      </Row>
      <Row label={t.bgDim} hint={`${look.bgDim}%`}>
        <Slider value={look.bgDim} min={0} max={100} step={1} onChange={(v) => set({ bgDim: v })} label={t.bgDim} />
      </Row>
      <Row label={t.bgReact} hint={look.bgReact ? `${look.bgReact}%` : t.bgReactOff}>
        <Slider value={look.bgReact} min={0} max={100} step={1} onChange={(v) => set({ bgReact: v })} label={t.bgReact} />
      </Row>
      <Row label={t.surface} hint={t.surfaceHint}>
        <Choice<"default" | "own">
          value={look.surface ? "own" : "default"}
          onChange={(v) => set({ surface: v === "default" ? "" : look.surface || "#1c1730" })}
          label={t.surface}
          options={[["default", t.surfaceDefault], ["own", t.surfaceCustom]]}
        />
      </Row>
      <Unfold open={!!look.surface}>
        <ColorPicker value={look.surface || "#1c1730"} onChange={(surface) => set({ surface })} presets={SURFACES} maxLight={20} sample="text" labels={colorLabels} />
      </Unfold>
      <Row label={t.accent} hint={look.accent ? undefined : t.accentAuto}>
        <Choice<"auto" | "fixed"> value={look.accent ? "fixed" : "auto"} onChange={(v) => set({ accent: v === "auto" ? "" : look.accent || "#b2a0e6" })} label={t.accent} options={[["auto", t.accentFromPicture], ["fixed", t.accentFixed]]} />
      </Row>
      <Unfold open={!!look.accent}>
        <ColorPicker value={look.accent || "#b2a0e6"} onChange={(accent) => set({ accent })} presets={ACCENTS} sample="glow" labels={colorLabels} />
      </Unfold>
      <Row label={t.panelOpacity} hint={`${look.panelOpacity}%`}>
        <Slider value={look.panelOpacity} min={10} max={100} step={1} onChange={(v) => set({ panelOpacity: v })} label={t.panelOpacity} />
      </Row>
      <Row label={t.panelBlur} hint={look.lite ? t.panelBlurLite : `${look.panelBlur} px`}>
        <Slider value={look.panelBlur} min={0} max={60} step={1} onChange={(v) => set({ panelBlur: v })} label={t.panelBlur} />
      </Row>
      <Row label={t.restingPlayer} hint={t.restingPlayerHint}>
        <Toggle on={prefs.restingPlayer} onChange={(v) => setPref("restingPlayer", v)} label={t.restingPlayer} />
      </Row>
      <Row label={t.liteEffects} hint={t.liteEffectsHint}>
        <Toggle on={look.lite} onChange={(v) => set({ lite: v })} label={t.liteEffects} />
      </Row>
      <Row label={t.lookReset} hint={t.lookResetHint}>
        <PaperButton onClick={() => set({ ...PREFS_DEFAULTS.look, design: "studio", bg: look.bg, bgFile: look.bgFile, bgFileType: look.bgFileType })}>{t.reset}</PaperButton>
      </Row>
    </Section>
  );
}
