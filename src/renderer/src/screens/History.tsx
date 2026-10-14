import TrackList from "@/components/tracks/TrackList";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useSettings } from "@/state/settings";

const SOURCE = { kind: "static" } as const;

/** What was played in this app, newest first (kept locally; SoundCloud isn't asked). */
export default function History() {
  const t = useT();
  const history = useSettings((s) => s.history);
  return (
    <Screen label={t.history}>
      <ScreenTitle>{t.history.toLowerCase()}</ScreenTitle>
      {history.length ? <TrackList tracks={history} source={SOURCE} label={t.history} /> : <EmptyState caption={t.emptyHistory} />}
    </Screen>
  );
}
