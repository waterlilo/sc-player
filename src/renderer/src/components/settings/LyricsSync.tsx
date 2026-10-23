import { Row, Section, Toggle } from "@/components/settings/Controls";
import { PaperButton } from "@/components/ui/Buttons";
import { useT } from "@/i18n";
import { useLyricsSync } from "@/lib/lyricsSync";
import { call } from "@/lib/sky";
import { useSettings } from "@/state/settings";

/** Settings → Lyrics: matching plain words to the song on this computer, and the model it needs. */
export default function LyricsSync() {
  const t = useT();
  const on = useSettings((s) => s.prefs.autoSyncLyrics);
  const setPref = useSettings((s) => s.setPref);
  const status = useLyricsSync((s) => s.status);
  const accurate = useSettings((s) => s.prefs.accurateSync);
  const download = () => void call("lyricsSync:download").then((s) => useLyricsSync.setState({ status: s }));

  const state =
    status?.model === "downloading" ? (
      t.syncDownloading(Math.round(status.progress * 100))
    ) : status?.model === "ready" ? (
      t.syncReady
    ) : status?.model === "error" ? (
      <>
        {t.syncFailed(status.error)}{" "}
        <button type="button" className="text-text underline underline-offset-2" onClick={download}>
          {t.tryAgain}
        </button>
      </>
    ) : null;

  return (
    <Section title={t.secLyrics}>
      <Row
        label={t.autoSync}
        hint={
          <>
            {t.autoSyncHint(status?.sizeMb ?? 77)}
            {on && state && <span className="mt-1 block text-text/80">{state}</span>}
          </>
        }
      >
        <Toggle
          on={on}
          label={t.autoSync}
          onChange={(v) => {
            setPref("autoSyncLyrics", v);
            if (v && status?.model !== "ready") download();
          }}
        />
      </Row>
      {on && (
        <Row label={t.accurateSync} hint={t.accurateSyncHint}>
          <Toggle
            on={accurate}
            label={t.accurateSync}
            onChange={(v) => {
              setPref("accurateSync", v);
              // the settings reach main first: then the status (and the download) is of the model just chosen
              download();
            }}
          />
        </Row>
      )}
      {!on && status?.model === "ready" && (
        <Row label={t.syncRemove}>
          <PaperButton onClick={() => void call("lyricsSync:deleteModel").then((s) => useLyricsSync.setState({ status: s }))}>{t.syncRemove}</PaperButton>
        </Row>
      )}
    </Section>
  );
}
