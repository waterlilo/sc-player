import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/States";
import { useT } from "@/i18n";

/** Settings — a placeholder for now; the options come next. */
export default function Settings() {
  const t = useT();
  return (
    <Screen label={t.settings}>
      <ScreenTitle meta={`${t.version} ${__APP_VERSION__}`}>{t.settings.toLowerCase()}</ScreenTitle>
      <EmptyState caption={t.settingsSoon} />
    </Screen>
  );
}
