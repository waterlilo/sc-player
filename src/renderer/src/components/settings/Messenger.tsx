import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { ask } from "@/state/dialog";
import { call } from "@/lib/sky";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { PaperButton } from "../ui/Buttons";
import { Row, Section, Toggle } from "./Controls";
import LyricsReview, { useLyricsQueue } from "./LyricsReview";

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
    if (!(await ask(t.leaveConfirm, t.leaveMessenger, true))) return;
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
      <ModeratorKey />
    </Section>
  );
}

/** The moderator's queue of lyrics people sent. */
function LyricsQueueRow() {
  const t = useT();
  const q = useLyricsQueue();
  const [open, setOpen] = useState(false);
  return (
    <Row label={t.lyricsReview} hint={q.data ? t.lyricsWaiting(q.data.length) : undefined}>
      <PaperButton onClick={() => setOpen(true)}>{t.lyricsReviewOpen}</PaperButton>
      {open && <LyricsReview onClose={() => setOpen(false)} />}
    </Row>
  );
}

/** The workshop moderator's key: folded away behind a quiet link, as nobody else needs it. */
function ModeratorKey() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const on = useQuery({ queryKey: ["ws-moderator"], queryFn: () => call("ws:moderator"), staleTime: Infinity }).data === true;
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      client.setQueryData(["ws-moderator"], await call("ws:setModerator", value));
      setKey("");
      setOpen(false);
      toast(t.saved);
    } catch (e) {
      toast((e as { code?: string }).code === "not_found" ? t.moderatorWrong : t.serverOffline);
    } finally {
      setBusy(false);
    }
  };

  if (on)
    return (
      <>
        <Row label={t.moderatorKey} hint={t.moderatorOn}>
          <PaperButton disabled={busy} onClick={() => void save(null)}>
            {t.removeKey}
          </PaperButton>
        </Row>
        <LyricsQueueRow />
      </>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-3 mt-1 font-type text-xs text-muted/70 hover:text-text">
        {t.moderatorOpen}
      </button>
    );
  return (
    <Row label={t.moderatorKey} hint={t.moderatorKeyHint}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save(key.trim());
        }}
        className="flex items-center gap-2"
      >
        <label className="field sketch sketch-thin paper-fill flex rounded-md">
          <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} aria-label={t.moderatorKey} className="w-44 px-3 py-1.5 text-sm text-text" />
        </label>
        <PaperButton type="submit" disabled={busy || !key.trim()}>
          {t.save}
        </PaperButton>
      </form>
    </Row>
  );
}
