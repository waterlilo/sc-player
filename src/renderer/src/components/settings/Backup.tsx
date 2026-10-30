import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { RestoreResult } from "@shared/types";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { ask } from "@/state/dialog";
import { refreshSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { PaperButton } from "../ui/Buttons";
import { Row, Section } from "./Controls";

const key = ["backup"] as const;

/**
 * Settings → Account → Backup: the transfer key of the copy kept on sc player's server (likes, own playlists and
 * lyrics, the friend code), and bringing another computer's copy here by its key.
 */
export default function Backup() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const q = useQuery({ queryKey: key, queryFn: () => call("backup:status"), refetchInterval: 60_000 });
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const s = q.data;
  if (!s?.available) return null;

  const now = async () => {
    setBusy(true);
    try {
      const r = await call("backup:now");
      client.setQueryData(key, r);
      toast(r.error ? r.error : t.backupDone);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (e: FormEvent) => {
    e.preventDefault();
    if (!typed.trim()) return;
    setBusy(true);
    try {
      let r: RestoreResult = await call("backup:restore", typed.trim(), false);
      if (r.code === "differs" && (await ask(t.backupCodeDiffers, t.backupUseTheirs, true))) r = await call("backup:restore", typed.trim(), true);
      toast(t.backupRestored(r.likes, r.playlists, r.lyrics, r.code === "restored"));
      setTyped("");
      // what came in shows everywhere: likes, playlists, lyrics, the friend code
      void client.invalidateQueries();
      void refreshSocial().catch(() => undefined);
      client.setQueryData(key, await call("backup:status"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.serverOffline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.backup}>
      <p className="px-3 pb-1 text-sm text-muted">{t.backupHint}</p>
      <Row label={t.backupKey} hint={s.key ? (s.at ? t.backupAt(new Date(s.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) : t.backupKeyHint) : t.backupNone}>
        {s.key && (
          <>
            <span className="select-all font-type text-sm tracking-wider text-text">{shown ? s.key : "••••-••••-••••-••••"}</span>
            <PaperButton onClick={() => setShown((v) => !v)}>{shown ? t.backupHide : t.backupShow}</PaperButton>
            <PaperButton onClick={() => void call("clipboard:write", s.key!).then(() => toast(t.backupKeyCopied))}>{t.backupCopy}</PaperButton>
          </>
        )}
        <PaperButton disabled={busy} onClick={() => void now()}>
          {t.backupNow}
        </PaperButton>
      </Row>
      <Row label={t.backupRestore} hint={t.backupRestoreHint} wide>
        <form onSubmit={(e) => void restore(e)} className="flex w-full items-center gap-2">
          <label className="field sketch sketch-thin paper-fill flex w-[27rem] min-w-0 max-w-full rounded-md">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label={t.backupRestore} className="min-w-0 flex-1 px-3 py-1.5 font-type text-sm tracking-wider text-text placeholder:text-muted/50" />
          </label>
          <PaperButton type="submit" disabled={busy || !typed.trim()}>
            {t.backupRestoreGo}
          </PaperButton>
        </form>
      </Row>
    </Section>
  );
}
