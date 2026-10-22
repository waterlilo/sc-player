import { useState } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { PaperButton } from "../ui/Buttons";
import { Row, Section, Toggle } from "./Controls";

/** Settings → Messenger: what friends see, pop-ups, the anonymous count, deleting the code. */
export default function Messenger() {
  const t = useT();
  const status = useSocial((s) => s.status);
  const setStatus = useSocial((s) => s.setStatus);
  const popups = useSettings((s) => s.prefs.socialPopups);
  const countMe = useSettings((s) => s.prefs.countMe);
  const setPref = useSettings((s) => s.setPref);
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  if (!status?.available) return null;
  const profile = status.profile;

  const share = async (on: boolean) => {
    try {
      setStatus(await call("social:profile", { shareNow: on }));
    } catch {
      toast(t.serverOffline);
    }
  };
  const leave = async () => {
    if (!window.confirm(t.leaveConfirm)) return;
    setBusy(true);
    try {
      setStatus(await call("social:leave"));
      useSocial.setState({ friends: null, unread: {}, now: {}, arrived: [], open: null });
    } catch {
      toast(t.serverOffline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.messengerSettings}>
      {profile && (
        <Row label={t.shareNow} hint={t.shareNowHint}>
          <Toggle on={profile.shareNow} onChange={(v) => void share(v)} label={t.shareNow} />
        </Row>
      )}
      <Row label={t.socialPopups} hint={t.socialPopupsHint}>
        <Toggle on={popups} onChange={(v) => setPref("socialPopups", v)} label={t.socialPopups} />
      </Row>
      <Row label={t.countMe} hint={t.countMeHint}>
        <Toggle on={countMe} onChange={(v) => setPref("countMe", v)} label={t.countMe} />
      </Row>
      {profile && (
        <Row label={`${t.leaveMessenger} (${profile.code})`} hint={t.leaveMessengerHint}>
          <PaperButton disabled={busy} onClick={() => void leave()}>
            {t.delete}
          </PaperButton>
        </Row>
      )}
    </Section>
  );
}
