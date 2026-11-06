import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SyncStatus } from "@shared/types";
import { dateLocale, useT } from "@/i18n";
import { call, errorCode, on, SkyError } from "@/lib/sky";
import { ask } from "@/state/dialog";
import { useUi } from "@/state/ui";
import { PaperButton } from "../ui/Buttons";
import { Row, Section } from "./Controls";

/**
 * Settings → Account → sc player account and sync: likes, own playlists and lyrics the same on every device. Signed
 * out, the transfer key still syncs (as the backup did); an account replaces it with a login and a password, and the
 * key becomes its recovery code — which signing up makes the person write down (two groups typed back).
 */

const statusKey = ["sync-status"] as const;
const devicesKey = ["account-devices"] as const;

// mirrors main/sync/crypto: the page checks before anything is sent
const RESERVED = new Set(["admin", "root", "support", "moderator", "sc", "scplayer", "sky", "system", "api"]);
/** the most guessed passwords of 10+ characters (the full list of 100 000 is still to come) */
const COMMON = new Set(["1234567890", "0123456789", "0987654321", "qwertyuiop", "1q2w3e4r5t", "1qaz2wsx3edc", "password12", "password123", "qwerty1234", "1234qwerty", "123456789a", "iloveyou12", "1111111111", "abcdefghij", "qwertyuiop123", "йцукенгшщз", "1234567890q", "q1w2e3r4t5", "zaq12wsxcde", "aaaaaaaaaa"]);
const cleanLogin = (s: string) => s.trim().toLowerCase();
const loginOk = (l: string) => /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(l) && !RESERVED.has(l);
/** a code's letters as typed: Crockford's look-alikes read as meant */
const cleanCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

type View = "home" | "register" | "signin" | "recover" | "password" | "delete";

export default function SyncAccount() {
  const t = useT();
  const client = useQueryClient();
  const q = useQuery({ queryKey: statusKey, queryFn: () => call("sync:status") });
  const [view, setView] = useState<View>("home");
  const [prefill, setPrefill] = useState("");
  useEffect(() => on("sync:status", (s) => client.setQueryData(statusKey, s)), [client]);
  const s = q.data;
  if (!s?.available) return null;
  const back = () => setView("home");

  return (
    <Section title={t.syncTitle}>
      {view === "home" && <Home s={s} go={setView} signInAs={(l) => (setPrefill(l), setView("signin"))} />}
      {view === "register" && <Register done={back} />}
      {view === "signin" && <SignIn login={prefill} done={back} forgot={() => setView("recover")} />}
      {view === "recover" && <Recover done={back} />}
      {view === "password" && <ChangePassword done={back} />}
      {view === "delete" && <DeleteAccount done={back} />}
    </Section>
  );
}

// ---- the overview ------------------------------------------------------------------------------------------------

function Home({ s, go, signInAs }: { s: SyncStatus; go: (v: View) => void; signInAs: (login: string) => void }) {
  const t = useT();
  const toast = useUi((x) => x.showToast);
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const time = (at: number) => new Date(at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  const line = s.state === "syncing" ? t.syncing : s.state === "offline" ? t.syncOffline : s.state === "error" && s.error ? t.syncError(s.error) : s.at ? t.syncAt(time(s.at)) : t.syncNever;

  const connectKey = async (e: FormEvent) => {
    e.preventDefault();
    if (cleanCode(typed).length !== 32) return toast(t.accBadCode);
    setBusy(true);
    try {
      await call("sync:useKey", typed.trim());
      toast(t.syncUsedKey);
      setTyped("");
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.serverOffline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="px-3 pb-1 text-sm text-muted">{t.syncHint}</p>
      {s.signedOut && <Note>{t.syncSignedOut}</Note>}
      {s.accountLogin && (
        <Note>
          {t.syncHasAccount(s.accountLogin)} <PaperButton onClick={() => signInAs(s.accountLogin!)}>{t.accSignIn}</PaperButton>
        </Note>
      )}
      {s.needsUpdate && <Note>{t.syncNeedsUpdate}</Note>}
      {s.brought && <Note>{t.syncBrought(s.brought.likes, s.brought.playlists, s.brought.lyrics)}</Note>}

      {s.mode === "account" ? (
        <>
          <Row label={t.accSignedIn(s.login ?? "")} hint={line}>
            <PaperButton disabled={s.state === "syncing"} onClick={() => void call("sync:now")}>
              {t.syncNow}
            </PaperButton>
            <PaperButton
              onClick={() =>
                void ask(t.accSignOutAsk, t.accSignOut).then((yes) => {
                  if (yes) void call("account:signOut");
                })
              }
            >
              {t.accSignOut}
            </PaperButton>
          </Row>
          <Devices />
          <Row label={t.accChangePassword}>
            <PaperButton onClick={() => go("password")}>{t.accChangePassword}</PaperButton>
          </Row>
          <Row label={t.accDelete} hint={t.accDeleteHint}>
            <PaperButton onClick={() => go("delete")}>{t.accDelete}</PaperButton>
          </Row>
        </>
      ) : (
        <>
          <Row label={t.syncAccount} hint={t.syncNudge}>
            <PaperButton onClick={() => go("register")}>{t.accCreate}</PaperButton>
            <PaperButton onClick={() => go("signin")}>{t.accSignIn}</PaperButton>
          </Row>
          <Row label={t.backupKey} hint={s.key ? line : t.backupNone}>
            {s.key && (
              <>
                <span className="select-all font-type text-sm tracking-wider text-text">{shown ? s.key : "••••-••••-••••-••••"}</span>
                <PaperButton onClick={() => setShown((v) => !v)}>{shown ? t.backupHide : t.backupShow}</PaperButton>
                <PaperButton onClick={() => void call("clipboard:write", s.key!).then(() => toast(t.backupKeyCopied))}>{t.backupCopy}</PaperButton>
                <PaperButton disabled={s.state === "syncing"} onClick={() => void call("sync:now")}>
                  {t.syncNow}
                </PaperButton>
              </>
            )}
          </Row>
          <Row label={t.syncUseKey} hint={t.syncUseKeyHint} wide>
            <form onSubmit={(e) => void connectKey(e)} className="flex w-full items-center gap-2">
              <Field value={typed} onChange={setTyped} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" label={t.syncUseKey} mono wide />
              <PaperButton type="submit" disabled={busy || !typed.trim()}>
                {t.syncUseKeyGo}
              </PaperButton>
            </form>
          </Row>
        </>
      )}
    </>
  );
}

function Devices() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((x) => x.showToast);
  const q = useQuery({ queryKey: devicesKey, queryFn: () => call("account:devices") });
  const revoke = async (id: number | null) => {
    try {
      await call("account:revoke", id);
      void client.invalidateQueries({ queryKey: devicesKey });
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.serverOffline);
    }
  };
  const list = q.data ?? [];
  return (
    <Row
      label={t.accDevices}
      wide
      hint={
        <ul className="mt-1 flex flex-col gap-1">
          {list.map((d) => (
            <li key={d.id} className="flex items-center gap-3">
              <span className="text-text">{d.name || d.platform}</span>
              <span className="text-xs">{d.current ? t.accThisDevice : t.accLastSeen(new Date(d.seen).toLocaleDateString(dateLocale()))}</span>
              {!d.current && (
                <button type="button" onClick={() => void revoke(d.id)} className="font-type text-xs underline-offset-2 hover:text-text hover:underline">
                  {t.accDisconnect}
                </button>
              )}
            </li>
          ))}
        </ul>
      }
    >
      {list.length > 1 && <PaperButton onClick={() => void revoke(null)}>{t.accDisconnectAll}</PaperButton>}
    </Row>
  );
}

// ---- pieces ------------------------------------------------------------------------------------------------------

function Note({ children }: { children: ReactNode }) {
  return <div className="mx-3 my-1 flex flex-wrap items-center gap-2 rounded-md border border-[var(--card-edge)] px-3 py-2 text-sm text-text">{children}</div>;
}

function Field({ value, onChange, placeholder, label, type = "text", mono = false, wide = false, auto }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; type?: string; mono?: boolean; wide?: boolean; auto?: string }) {
  return (
    <label className={`field sketch sketch-thin paper-fill flex min-w-0 max-w-full rounded-md ${wide ? "w-[27rem]" : "w-[18rem]"}`}>
      <input
        type={type}
        value={value}
        autoComplete={auto ?? "off"}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        aria-label={label}
        className={`min-w-0 flex-1 px-3 py-1.5 text-sm text-text placeholder:text-muted/50 ${mono ? "font-type tracking-wider" : ""}`}
      />
    </label>
  );
}

function Form({ title, hint, children, onSubmit, submit, busy, cancel, error }: { title: string; hint?: string; children: ReactNode; onSubmit: () => void; submit: string; busy: boolean; cancel: () => void; error: string }) {
  const t = useT();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit();
      }}
      className="flex flex-col gap-2.5 px-3 py-2.5"
    >
      <div className="font-medium text-text">{title}</div>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="text-sm text-[var(--danger,#ff8a7a)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <PaperButton type="submit" disabled={busy}>
          {busy ? t.accWorking : submit}
        </PaperButton>
        <PaperButton type="button" onClick={cancel}>
          {t.cancel}
        </PaperButton>
      </div>
    </form>
  );
}

/** The page's own password rules (NIST-style: long, not the login, not a common one); "" when fine. */
function passwordProblem(t: ReturnType<typeof useT>, pw: string, again: string, login: string): string {
  if ([...pw].length < 10) return t.errPwShort;
  if (login && pw.trim().toLowerCase() === login) return t.errPwLogin;
  if (COMMON.has(pw.toLowerCase())) return t.errPwCommon;
  if (pw !== again) return t.errPwMismatch;
  return "";
}

/** An error from main as the sentence to show. */
function message(t: ReturnType<typeof useT>, err: unknown): string {
  const code = errorCode(err);
  const text = err instanceof SkyError ? err.message : "";
  if (code === "rate_limited") return t.accTooMany(Math.max(1, Math.ceil(Number(text.replace("retry:", "")) / 60) || 1));
  if (code === "unauthorized") return t.accWrong;
  if (code === "offline" || code === "unavailable") return t.serverOffline;
  if (text === "login_taken") return t.errLoginTaken;
  if (text === "no_account") return t.accNoAccount;
  if (text === "vault_bound") return t.accKeyBound;
  return text || t.serverOffline;
}

// ---- sign-up -----------------------------------------------------------------------------------------------------

function Register({ done }: { done: () => void }) {
  const t = useT();
  const toast = useUi((x) => x.showToast);
  const [step, setStep] = useState<"form" | "code" | "confirm">("form");
  const [login, setLogin] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState<{ code: string; existing: boolean } | null>(null);
  const [groups] = useState(() => {
    const a = Math.floor(Math.random() * 8);
    const b = (a + 1 + Math.floor(Math.random() * 7)) % 8;
    return [Math.min(a, b), Math.max(a, b)] as [number, number];
  });
  const [typed, setTyped] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toCode = async () => {
    const l = cleanLogin(login);
    if (!loginOk(l)) return setError(RESERVED.has(l) ? t.errLoginReserved : t.errLogin);
    const p = passwordProblem(t, pw, again, l);
    if (p) return setError(p);
    setBusy(true);
    setError("");
    try {
      if (!(await call("account:available", l))) return setError(t.errLoginTaken);
      setCode(await call("account:newCode"));
      setStep("code");
    } catch (err) {
      setError(message(t, err));
    } finally {
      setBusy(false);
    }
  };

  const parts = code ? cleanCode(code.code).match(/.{4}/g)! : [];
  const matches = typed.every((g, i) => cleanCode(g) === parts[groups[i]!]);

  const create = async () => {
    if (!code || !matches) return;
    setBusy(true);
    setError("");
    try {
      await call("account:register", cleanLogin(login), pw, code.code);
      toast(t.accCreated);
      done();
    } catch (err) {
      const m = message(t, err);
      setError(m);
      // a login taken meanwhile: back to choosing one, the password kept
      if (m === t.errLoginTaken) setStep("form");
    } finally {
      setBusy(false);
    }
  };

  if (step === "form")
    return (
      <Form title={t.accCreate} hint={t.accLoginHint} onSubmit={() => void toCode()} submit={t.accNext} busy={busy} cancel={done} error={error}>
        <Field value={login} onChange={setLogin} label={t.accLogin} auto="username" />
        <Field value={pw} onChange={setPw} label={t.accPassword} type="password" auto="new-password" />
        <Field value={again} onChange={setAgain} label={t.accPasswordAgain} type="password" auto="new-password" />
        <p className="text-sm text-muted">{t.accPasswordHint}</p>
      </Form>
    );

  if (step === "code" && code)
    return (
      <Form title={t.accCodeTitle} hint={code.existing ? `${t.accCodeExisting} ${t.accCodeWarn}` : t.accCodeWarn} onSubmit={() => setStep("confirm")} submit={t.accNext} busy={false} cancel={done} error="">
        <div className="select-all font-type text-lg tracking-wider text-text">{code.code}</div>
        <div className="flex gap-2">
          <PaperButton type="button" onClick={() => void call("clipboard:write", code.code).then(() => toast(t.accCopied))}>
            {t.accCopy}
          </PaperButton>
          <PaperButton type="button" onClick={() => void call("account:saveCode", code.code).then((ok) => ok && toast(t.accSaved))}>
            {t.accSaveFile}
          </PaperButton>
        </div>
      </Form>
    );

  return (
    <Form title={t.accConfirmTitle(groups[0] + 1, groups[1] + 1)} hint={t.accConfirmHint} onSubmit={() => void create()} submit={t.accCreate} busy={busy || !matches} cancel={done} error={error}>
      <div className="flex gap-2">
        {groups.map((g, i) => (
          <label key={g} className="field sketch sketch-thin paper-fill flex w-[7rem] rounded-md">
            <input
              value={typed[i]}
              maxLength={4}
              autoFocus={i === 0}
              onChange={(e) => setTyped((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={t.accGroup(g + 1)}
              aria-label={t.accGroup(g + 1)}
              className="min-w-0 flex-1 px-3 py-1.5 font-type text-sm uppercase tracking-wider text-text placeholder:normal-case placeholder:text-muted/50"
            />
          </label>
        ))}
      </div>
      <button type="button" onClick={() => setStep("code")} className="self-start font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
        {t.accShowCodeAgain}
      </button>
    </Form>
  );
}

// ---- sign-in, recovery, password, deletion ------------------------------------------------------------------------

function useSubmit(done: () => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (ok) useUi.getState().showToast(ok);
      done();
    } catch (err) {
      setError(message(t, err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function SignIn({ login: initial, done, forgot }: { login: string; done: () => void; forgot: () => void }) {
  const t = useT();
  const [login, setLogin] = useState(initial);
  const [pw, setPw] = useState("");
  const f = useSubmit(done);
  return (
    <Form title={t.accSignIn} onSubmit={() => void f.run(() => call("account:signIn", cleanLogin(login), pw))} submit={t.accSignIn} busy={f.busy} cancel={done} error={f.error}>
      <Field value={login} onChange={setLogin} label={t.accLogin} auto="username" />
      <Field value={pw} onChange={setPw} label={t.accPassword} type="password" auto="current-password" />
      <button type="button" onClick={forgot} className="self-start font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
        {t.accForgot}
      </button>
    </Form>
  );
}

function Recover({ done }: { done: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const f = useSubmit(done);
  const go = () => {
    if (cleanCode(code).length !== 32) return f.setError(t.accBadCode);
    const p = passwordProblem(t, pw, again, "");
    if (p) return f.setError(p);
    void f.run(async () => useUi.getState().showToast(t.accRecovered(await call("account:recover", code.trim(), pw))));
  };
  return (
    <Form title={t.accForgot} hint={t.accRecoverHint} onSubmit={go} submit={t.accNext} busy={f.busy} cancel={done} error={f.error}>
      <Field value={code} onChange={setCode} label={t.accRecoveryCode} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" mono wide />
      <Field value={pw} onChange={setPw} label={t.accNewPassword} type="password" auto="new-password" />
      <Field value={again} onChange={setAgain} label={t.accPasswordAgain} type="password" auto="new-password" />
    </Form>
  );
}

function ChangePassword({ done }: { done: () => void }) {
  const t = useT();
  const login = useQueryClient().getQueryData<SyncStatus>(statusKey)?.login ?? "";
  const [old, setOld] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [others, setOthers] = useState(true);
  const f = useSubmit(done);
  const go = () => {
    const p = passwordProblem(t, pw, again, login);
    if (p) return f.setError(p);
    void f.run(() => call("account:password", old, pw, others), t.accPasswordChanged);
  };
  return (
    <Form title={t.accChangePassword} onSubmit={go} submit={t.accChangePassword} busy={f.busy} cancel={done} error={f.error}>
      <Field value={old} onChange={setOld} label={t.accOldPassword} type="password" auto="current-password" />
      <Field value={pw} onChange={setPw} label={t.accNewPassword} type="password" auto="new-password" />
      <Field value={again} onChange={setAgain} label={t.accPasswordAgain} type="password" auto="new-password" />
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> {t.accSignOutOthers}
      </label>
    </Form>
  );
}

function DeleteAccount({ done }: { done: () => void }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const f = useSubmit(done);
  return (
    <Form title={t.accDelete} hint={t.accDeleteHint} onSubmit={() => void f.run(() => call("account:delete", pw), t.accDeleted)} submit={t.accDelete} busy={f.busy || !pw} cancel={done} error={f.error}>
      <Field value={pw} onChange={setPw} label={t.accDeleteConfirm} type="password" auto="current-password" />
    </Form>
  );
}
