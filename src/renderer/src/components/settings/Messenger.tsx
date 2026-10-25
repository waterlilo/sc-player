import { useState, type FormEvent } from "react";
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
  const shareListening = useSettings((s) => s.prefs.shareListening);
  const setPref = useSettings((s) => s.setPref);
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  // what friends see; typed here, sent with Save
  const [name, setName] = useState<string | null>(null);
  if (!status?.available) return null;
  const profile = status.profile;
  const shownName = name ?? profile?.name ?? "";

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const next = shownName.trim();
    if (!next || next === profile?.name) return;
    try {
      setStatus(await call("social:profile", { name: next }));
      setName(null);
      toast(t.saved);
    } catch {
      toast(t.serverOffline);
    }
  };

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
        <Row label={t.yourName} hint={t.yourNameHint}>
          <form onSubmit={(e) => void rename(e)} className="flex items-center gap-2">
            <label className="field sketch sketch-thin paper-fill flex rounded-md">
              <input value={shownName} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label={t.yourName} className="w-44 px-3 py-1.5 text-sm text-text" />
            </label>
            <PaperButton type="submit" disabled={!shownName.trim() || shownName.trim() === profile.name}>
              {t.save}
            </PaperButton>
          </form>
        </Row>
      )}
      {profile && (
        <Row label={t.shareNow} hint={t.shareNowHint}>
          <Toggle on={profile.shareNow} onChange={(v) => void share(v)} label={t.shareNow} />
        </Row>
      )}
      <Row label={t.socialPopups} hint={t.socialPopupsHint}>
        <Toggle on={popups} onChange={(v) => setPref("socialPopups", v)} label={t.socialPopups} />
      </Row>
      <Row label={t.shareListening} hint={t.shareListeningHint}>
        <Toggle on={shareListening} onChange={(v) => setPref("shareListening", v)} label={t.shareListening} />
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
