import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SteamWallpaper } from "@shared/types";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { fitTo, probe, to2K } from "@/lib/videoFit";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

const MAX_BACKGROUND = 300 * 1024 * 1024;

/**
 * A Wallpaper Engine video wallpaper as the background, by its Steam Workshop link: found where Steam keeps it (or
 * subscribed to in Steam first — the dialog waits for the download), then made into a 2K copy here.
 */
export default function SteamImport({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [link, setLink] = useState("");
  const [found, setFound] = useState<SteamWallpaper | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [original, setOriginal] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!link.trim()) return;
    try {
      setFound(await call("bg:steamFind", link.trim()));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  // subscribed in Steam: looked for again every few seconds until Steam has downloaded it
  useEffect(() => {
    if (!waiting || !found || found.found) return;
    const timer = setInterval(() => {
      void call("bg:steamFind", found.id).then((r) => {
        if (r.found || r.reason === "not-video") {
          setFound(r);
          setWaiting(false);
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, found]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && progress === null && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, progress]);

  const go = async () => {
    if (!found?.found) return;
    setProgress(0);
    try {
      const { height, duration } = await probe(found.url);
      // already 2K or less at a modest bitrate: kept as it is, a copy would only lose quality
      const light = height <= 1440 && (found.sizeMb * 8 * 1048576) / Math.max(1, duration) <= 16_000_000;
      let res: { file: string; type: "video" };
      if (original || light) res = await call("bg:keepImport", found.url);
      else {
        let video = await to2K(found.url, (p) => setProgress(p));
        if (video.byteLength > MAX_BACKGROUND) video = await fitTo(found.url, MAX_BACKGROUND, (p) => setProgress(p));
        res = await call("bg:saveVideo", video);
      }
      const { prefs, setPref } = useSettings.getState();
      setPref("look", { ...prefs.look, bg: "file", bgFile: res.file, bgFileType: res.type });
      toast(t.steamDone);
      onClose();
    } catch (err) {
      setProgress(null);
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50" onPointerDown={(e) => progress === null && !box.current?.contains(e.target as Node) && onClose()}>
      <div ref={box} role="dialog" aria-label={t.steamImport} className="s-pop w-[30rem] max-w-[92vw] rounded-[var(--r,10px)] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]" data-keys-own>
        <h2 className="text-[15px] font-semibold text-text">{t.steamImport}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t.steamImportHint}</p>
        <form onSubmit={(e) => void find(e)} className="mt-3 flex gap-2">
          <label className="field sketch sketch-thin paper-fill flex min-w-0 flex-1 rounded-md">
            <input
              autoFocus
              value={link}
              disabled={progress !== null}
              onChange={(e) => {
                setLink(e.target.value);
                setFound(null);
                setWaiting(false);
              }}
              placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
              aria-label={t.steamLink}
              className="min-w-0 flex-1 px-3 py-2 text-sm text-text placeholder:text-muted/60"
            />
          </label>
          <button type="submit" disabled={!link.trim() || progress !== null} className="s-btn">
            {t.steamFind}
          </button>
        </form>

        {found && !found.found && (
          <div className="mt-3 text-sm text-muted">
            {found.reason === "link" ? t.steamBadLink : found.reason === "not-video" ? t.steamNotVideo : waiting ? t.steamWaiting : t.steamMissing}
            {found.reason === "missing" && !waiting && (
              <div className="mt-2">
                <button
                  type="button"
                  className="s-btn"
                  onClick={() => {
                    void call("bg:steamOpen", found.id);
                    setWaiting(true);
                  }}
                >
                  {t.steamOpen}
                </button>
              </div>
            )}
          </div>
        )}

        {found?.found && (
          <div className="mt-4">
            <div className="rounded-md bg-white/[0.04] px-3 py-2">
              <div className="truncate text-sm font-semibold text-text">{found.title}</div>
              <div className="text-xs text-muted">{t.steamSize(found.sizeMb)}</div>
            </div>
            {progress === null ? (
              <>
                <label className="mt-3 flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} />
                  {t.steamKeepOriginal}
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="s-btn">
                    {t.cancel}
                  </button>
                  <button type="button" onClick={() => void go()} className="s-btn pri">
                    {t.steamImportGo}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{t.steamConverting(Math.round(progress * 100))}</p>
              </div>
            )}
          </div>
        )}
        {!found?.found && (
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="s-btn">
              {t.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
