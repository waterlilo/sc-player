import { useEffect, useState, type FormEvent } from "react";
import { PREFS_DEFAULTS, type AppInfo, type HotkeyAction, type NetCheck } from "@shared/ipc";
import Appearance from "@/components/settings/Appearance";
import Equalizer from "@/components/settings/Equalizer";
import HotkeyRecorder from "@/components/settings/HotkeyRecorder";
import Messenger from "@/components/settings/Messenger";
import { Choice, Row, Section, Slider, Toggle } from "@/components/settings/Controls";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { shortVersion } from "@/lib/format";
import { call } from "@/lib/sky";
import { useSystem } from "@/lib/system";
import { useAuth } from "@/state/auth";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

const RELEASES = "https://github.com/waterlilo/sc-player/releases/latest";

function OutputDevice() {
  const t = useT();
  const value = useSettings((s) => s.prefs.outputDevice);
  const setPref = useSettings((s) => s.setPref);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // the list is read when the pointer or focus reaches the field (or at once when a device is already chosen, to show
  // its name): reading it starts Chromium's media device service (~60 MB) and it stays for the rest of the session
  const [wanted, setWanted] = useState(value !== "");
  useEffect(() => {
    if (!wanted) return;
    const load = () => void navigator.mediaDevices.enumerateDevices().then((all) => setDevices(all.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")));
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, [wanted]);
  const want = () => setWanted(true);
  return (
    <Row label={t.outputDevice} htmlFor="output-device">
      <select id="output-device" value={value} onChange={(e) => setPref("outputDevice", e.target.value)} onPointerEnter={want} onFocus={want} className="paper-fill sketch-select max-w-72 truncate rounded-md px-3 py-1.5 text-sm text-text">
        <option value="">{t.systemDefault}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${t.outputDevice} ${i + 1}`}
          </option>
        ))}
      </select>
    </Row>
  );
}

function Keywords() {
  const t = useT();
  const words = useSettings((s) => s.prefs.hiddenKeywords);
  const setPref = useSettings((s) => s.setPref);
  const [text, setText] = useState("");
  const add = (e: FormEvent) => {
    e.preventDefault();
    const w = text.trim();
    if (w && !words.some((x) => x.toLowerCase() === w.toLowerCase())) setPref("hiddenKeywords", [...words, w]);
    setText("");
  };
  return (
    <div className="rounded-md px-3 py-2.5">
      <div className="font-medium text-text">{t.hiddenKeywords}</div>
      <div className="mt-0.5 text-sm text-muted">{t.hiddenKeywordsHint}</div>
      <form onSubmit={add} className="mt-2 flex max-w-md gap-2">
        <label className="field sketch sketch-thin paper-fill flex flex-1 rounded-md">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.addKeyword} aria-label={t.addKeyword} className="min-w-0 flex-1 px-3 py-1.5 text-sm text-text placeholder:text-muted/70" />
        </label>
        <PaperButton type="submit">{t.add}</PaperButton>
      </form>
      {words.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {words.map((w) => (
            <span key={w} className="paper-fill torn flex items-center gap-1.5 py-1 pl-3 pr-1.5 text-sm text-text">
              {w}
              <button type="button" aria-label={`${t.remove}: ${w}`} onClick={() => setPref("hiddenKeywords", words.filter((x) => x !== w))} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:text-blood">
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Updates({ info }: { info: AppInfo | null }) {
  const t = useT();
  const update = useSystem((s) => s.update);
  const auto = useSettings((s) => s.prefs.checkUpdates);
  const setPref = useSettings((s) => s.setPref);
  let line: string;
  switch (update.state) {
    case "checking":
      line = t.upChecking;
      break;
    case "none":
      line = t.upNone;
      break;
    case "available":
      line = t.upAvailable(update.version);
      break;
    case "downloading":
      line = t.upDownloading(update.percent);
      break;
    case "ready":
      line = t.upReady(update.version);
      break;
    case "error":
      line = t.upError;
      break;
    default:
      line = "";
  }
  return (
    <>
      <Row label={t.versionLine(info ? shortVersion(info.version) : __APP_VERSION__)} hint={info && !info.packaged ? t.upDev : line}>
        {update.state === "available" && !update.portable && <MarkerButton onClick={() => void call("update:download")}>{t.upDownload}</MarkerButton>}
        {update.state === "ready" && <MarkerButton onClick={() => void call("update:install")}>{t.upRestart}</MarkerButton>}
        {update.state !== "available" && update.state !== "ready" && update.state !== "downloading" && (
          <PaperButton disabled={!info?.packaged || update.state === "checking"} onClick={() => void call("update:check").then((s) => useSystem.setState({ update: s }))}>
            {t.checkNow}
          </PaperButton>
        )}
      </Row>
      {update.state === "available" && update.portable && (
        <Row label={t.upPortable}>
          <PaperButton onClick={() => void call("shell:open", RELEASES)}>
            <Icon name="external" size={16} /> {t.upOpenRelease}
          </PaperButton>
        </Row>
      )}
      <Row label={t.checkUpdatesAuto}>
        <Toggle on={auto} onChange={(v) => setPref("checkUpdates", v)} label={t.checkUpdatesAuto} />
      </Row>
    </>
  );
}

const ZAPRET_GUIDE = "https://github.com/Flowseal/zapret-discord-youtube/issues/7449";
const REPO = "https://github.com/waterlilo/sc-player";
const PROXY_RE = /^(?:(https?|socks[45]?):\/\/)?(?:[^@/\s]*@)?([\w.-]+|\[[0-9a-f:]+\]):(\d{1,5})\/?$/i;

/** Proxy: Windows settings / none / an address; an HTTP proxy's username and password (kept encrypted by main). */
function Proxy() {
  const t = useT();
  const proxy = useSettings((s) => s.prefs.proxy);
  const setPref = useSettings((s) => s.setPref);
  const toast = useUi((s) => s.showToast);
  const [url, setUrl] = useState(proxy.url);
  const [user, setUser] = useState(proxy.username);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  // sc player's own proxy is offered only when the build carries one
  const [builtin, setBuiltin] = useState(false);
  useEffect(() => {
    void call("proxy:hasPassword").then(setHasPassword);
    void call("app:info").then((i) => setBuiltin(i.builtinProxy));
  }, []);
  const valid = PROXY_RE.test(url.trim());
  const socks = /^socks/i.test(url.trim());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (password) setHasPassword(await call("proxy:setPassword", password));
    setPassword("");
    setPref("proxy", { mode: "custom", url: url.trim(), username: user.trim() });
    toast(t.saved);
  };

  return (
    <>
      <Row label={t.proxy} hint={t.proxyHint}>
        <Choice
          label={t.proxy}
          value={proxy.mode}
          options={[
            ["system", t.proxySystem],
            ["direct", t.proxyDirect],
            ...(builtin || proxy.mode === "builtin" ? [["builtin", t.proxyBuiltin] as ["builtin", string]] : []),
            ["custom", t.proxyCustom],
          ]}
          onChange={(mode) => setPref("proxy", { ...proxy, mode })}
        />
      </Row>
      {proxy.mode === "builtin" && <p className="px-3 pb-2 text-sm text-muted">{t.proxyBuiltinHint}</p>}
      {proxy.mode === "custom" && (
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2 rounded-md px-3 py-2.5">
          <label className="text-sm text-muted" htmlFor="proxy-url">
            {t.proxyAddress} <span className="font-type text-xs">({t.proxyAddressHint})</span>
          </label>
          <div className="field sketch sketch-thin paper-fill flex max-w-md rounded-md">
            <input id="proxy-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="socks5://127.0.0.1:1080" spellCheck={false} className="min-w-0 flex-1 px-3 py-1.5 font-type text-sm text-text placeholder:text-muted/60" />
          </div>
          {url.trim() && !valid && <p className="font-type text-xs text-blood">{t.proxyBad}</p>}
          {!socks && (
            <div className="flex max-w-md gap-2">
              <div className="field sketch sketch-thin paper-fill flex flex-1 rounded-md">
                <input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t.proxyUser} aria-label={t.proxyUser} spellCheck={false} className="min-w-0 flex-1 px-3 py-1.5 text-sm text-text placeholder:text-muted/60" />
              </div>
              <div className="field sketch sketch-thin paper-fill flex flex-1 rounded-md">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={hasPassword ? t.proxyPasswordSaved : t.proxyPassword} aria-label={t.proxyPassword} className="min-w-0 flex-1 px-3 py-1.5 text-sm text-text placeholder:text-muted/60" />
              </div>
            </div>
          )}
          {socks && <p className="text-xs text-muted">{t.proxyNoSocksAuth}</p>}
          <div>
            <MarkerButton type="submit" disabled={!valid}>
              {t.save}
            </MarkerButton>
          </div>
        </form>
      )}
      <div className="px-3 py-1">
        <button type="button" onClick={() => void call("shell:open", ZAPRET_GUIDE)} className="inline-flex items-center gap-1.5 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
          <Icon name="external" size={13} /> {t.zapretGuide}
        </button>
      </div>
    </>
  );
}

function Diagnostics() {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [results, setResults] = useState<NetCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResults(await call("diag:netcheck"));
    } finally {
      setBusy(false);
    }
  };
  const report = () =>
    (results ?? []).map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.name}: ${r.ms !== null ? `${r.ms} ms, ` : ""}${r.detail}`).join("\n");
  return (
    <>
      <div className="rounded-md px-3 py-2.5">
        <div className="flex flex-wrap gap-2">
          <PaperButton disabled={busy} onClick={() => void run()}>
            {busy ? t.netChecking : t.netCheck}
          </PaperButton>
          {results && (
            <PaperButton onClick={() => void call("clipboard:write", report()).then(() => toast(t.reportCopied))}>
              <Icon name="link" size={16} /> {t.copyReport}
            </PaperButton>
          )}
          <PaperButton onClick={() => void call("diag:openLogs")}>{t.openLogs}</PaperButton>
          <PaperButton onClick={() => void call("diag:clearCache").then(() => toast(t.cacheCleared))}>{t.clearCache}</PaperButton>
        </div>
        {results && (
          <ul className="mt-3 flex flex-col gap-1 font-type text-sm">
            {results.map((r) => (
              <li key={r.name} className="flex gap-3">
                <span className={r.ok ? "text-glow" : "text-blood"} aria-hidden="true">
                  {r.ok ? "✦" : "✖"}
                </span>
                <span className="text-text">{r.name}</span>
                <span className="text-muted">{r.ms !== null ? `${r.ms} ms · ${r.detail}` : r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Settings. Everything is saved at once; main applies what it is responsible for (tray, autostart, shortcuts). */
export default function Settings() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.setPref);
  const failed = useSystem((s) => s.hotkeysFailed);
  const status = useAuth((s) => s.status);
  const logout = useAuth((s) => s.logout);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void call("app:info").then(setInfo);
  }, []);
  const autostartOk = !!info?.packaged && !info.portable;

  const hotkeyRows: [HotkeyAction, string][] = [
    ["playPause", t.hkPlayPause],
    ["next", t.hkNext],
    ["previous", t.hkPrevious],
    ["showWindow", t.hkShowWindow],
  ];

  return (
    <Screen label={t.settings}>
      <ScreenTitle meta={`${t.version} ${__APP_VERSION__}`}>{t.settings.toLowerCase()}</ScreenTitle>

      <Section title={t.secPlayback}>
        <Row label={t.substitute} hint={t.substituteHint}>
          <Toggle on={prefs.substitute} onChange={(v) => setPref("substitute", v)} label={t.substitute} />
        </Row>
        {prefs.substitute && (
          <Row label={t.substituteTolerance}>
            <Choice
              label={t.substituteTolerance}
              value={String(prefs.substituteTolerance)}
              options={[
                ["2", t.strict(2)],
                ["3", t.strict(3)],
                ["5", t.strict(5)],
              ]}
              onChange={(v) => setPref("substituteTolerance", Number(v))}
            />
          </Row>
        )}
        <Row label={t.autopilot} hint={t.autopilotHint}>
          <Toggle on={prefs.autopilot} onChange={(v) => setPref("autopilot", v)} label={t.autopilot} />
        </Row>
        <Row label={t.crossfade} hint={t.crossfadeHint}>
          <span className="w-12 text-right font-type text-sm text-muted">{prefs.crossfade ? t.seconds(prefs.crossfade) : t.off}</span>
          <Slider value={prefs.crossfade} min={0} max={12} step={1} onChange={(v) => setPref("crossfade", v)} label={t.crossfade} />
        </Row>
        <Row label={t.streamQuality} hint={t.streamQualityHint}>
          <Choice
            label={t.streamQuality}
            value={prefs.streamQuality}
            options={[
              ["high", t.qualityHigh],
              ["low", t.qualityLow],
            ]}
            onChange={(v) => setPref("streamQuality", v)}
          />
        </Row>
      </Section>

      <Section title={t.secSound}>
        <Equalizer />
        <OutputDevice />
      </Section>

      <Appearance />

      <Section title={t.secWindow}>
        <Row label={t.closeButton} hint={t.closeHint}>
          <Choice
            label={t.closeButton}
            value={prefs.closeToTray ? "tray" : "quit"}
            options={[
              ["tray", t.closeToTray],
              ["quit", t.closeQuits],
            ]}
            onChange={(v) => setPref("closeToTray", v === "tray")}
          />
        </Row>
        <Row label={t.startWithWindows} hint={autostartOk ? undefined : t.autostartUnavailable}>
          <Toggle on={prefs.startWithWindows} disabled={!autostartOk} onChange={(v) => setPref("startWithWindows", v)} label={t.startWithWindows} />
        </Row>
        <Row label={t.startMinimized}>
          <Toggle on={prefs.startMinimized} disabled={!prefs.startWithWindows} onChange={(v) => setPref("startMinimized", v)} label={t.startMinimized} />
        </Row>
        <Row label={t.notifications} hint={t.notificationsHint}>
          <Toggle on={prefs.notifications} onChange={(v) => setPref("notifications", v)} label={t.notifications} />
        </Row>
        <Row label={t.trackPopup} hint={t.trackPopupHint}>
          <Toggle on={prefs.trackPopup} onChange={(v) => setPref("trackPopup", v)} label={t.trackPopup} />
        </Row>
        <Row label={t.popupCorner}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Choice
              value={prefs.popupCorner}
              label={t.popupCorner}
              onChange={(v) => setPref("popupCorner", v)}
              options={[
                ["bottom-right", t.cornerBottomRight],
                ["top-right", t.cornerTopRight],
                ["bottom-left", t.cornerBottomLeft],
                ["top-left", t.cornerTopLeft],
              ]}
            />
            <PaperButton onClick={() => void call("popup:preview")}>{t.showPopup}</PaperButton>
          </div>
        </Row>
      </Section>

      <Section title={t.secHotkeys}>
        <p className="px-3 pb-1 text-sm text-muted">{t.hkHint}</p>
        {hotkeyRows.map(([action, label]) => (
          <Row key={action} label={label}>
            <HotkeyRecorder label={label} value={prefs.hotkeys[action]} taken={failed.includes(action)} onChange={(accel) => setPref("hotkeys", { ...prefs.hotkeys, [action]: accel })} />
          </Row>
        ))}
        <div className="px-3 pt-1">
          <button type="button" onClick={() => setPref("hotkeys", PREFS_DEFAULTS.hotkeys)} className="font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
            {t.hkReset}
          </button>
        </div>
      </Section>

      <Section title={t.secHidden}>
        <div className="rounded-md px-3 py-2.5">
          <div className="font-medium text-text">{t.blockedArtists}</div>
          {prefs.blockedArtists.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {prefs.blockedArtists.map((a) => (
                <li key={a.id} className="paper-fill torn flex items-center gap-1.5 py-1 pl-3 pr-1.5 text-sm text-text">
                  {a.username}
                  <button
                    type="button"
                    aria-label={`${t.unblock}: ${a.username}`}
                    title={t.unblock}
                    onClick={() => setPref("blockedArtists", prefs.blockedArtists.filter((x) => x.id !== a.id))}
                    className="grid h-5 w-5 place-items-center rounded-full text-muted hover:text-glow"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-0.5 text-sm text-muted">{t.blockedNone}</div>
          )}
        </div>
        <Keywords />
      </Section>

      <Messenger />

      <Section title={t.secUpdates}>
        <Updates info={info} />
      </Section>

      <Section title={t.secDiagnostics}>
        <Diagnostics />
      </Section>

      <Section title={t.secNetwork}>
        <Proxy />
      </Section>

      <Section title={t.secAbout}>
        <p className="px-3 text-sm text-muted">{t.unofficial}</p>
        <div className="px-3 pt-2">
          <button type="button" onClick={() => void call("shell:open", REPO)} className="inline-flex items-center gap-1.5 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
            <Icon name="external" size={13} /> {t.sourceCode}
          </button>
        </div>
      </Section>

      <Section title={t.secAccount}>
        <Row label={status?.user ? t.signedInAs(status.user.username) : t.notSignedIn}>
          {status?.mode === "session" && <PaperButton onClick={() => void logout()}>{t.logout}</PaperButton>}
        </Row>
      </Section>
    </Screen>
  );
}
