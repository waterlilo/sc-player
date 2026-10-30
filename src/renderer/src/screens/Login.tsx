import { useEffect, useState, type FormEvent } from "react";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import { EmptyState } from "@/components/ui/States";
import { errorText, useT } from "@/i18n";
import { openLink } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";

/** Not signed in: "sign in", and a way to open any public profile without an account. */
export default function Login() {
  const t = useT();
  const { status, browser, loginWithBrowser, cancelBrowser } = useAuth();
  const onSignIn = useNav((s) => s.route.name === "signin");
  // the sign-in page of its own (Sidebar, Settings): once signed in, on to the account's likes
  useEffect(() => {
    if (onSignIn && status?.mode === "session") useNav.getState().open("likes", { name: "likes" });
  }, [onSignIn, status?.mode]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    setOpening(true);
    setError(null);
    try {
      await openLink(link, { saveUser: true });
    } catch (err) {
      setError(errorText(t, errorCode(err)));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-8">
      <div className="flex w-full max-w-lg flex-col items-center">
        <h1 className="display-heading -rotate-2 text-6xl text-text">{t.loginTitle}</h1>
        <EmptyState caption={t.loginHint}>
          {browser === "idle" ? (
            <MarkerButton onClick={() => void loginWithBrowser()} className="text-lg">
              {t.loginWithBrowser}
            </MarkerButton>
          ) : (
            <div role="status" className="mt-4 w-full rounded-md border border-glow/40 p-4 text-center font-type text-sm leading-relaxed text-text">
              <p>{browser === "refused" ? t.browserRefused : t.browserWaiting}</p>
              <div className="mt-3 flex justify-center gap-2">
                <PaperButton onClick={() => void loginWithBrowser()}>{t.browserAgain}</PaperButton>
                <PaperButton onClick={() => void cancelBrowser()}>{t.cancel}</PaperButton>
              </div>
            </div>
          )}
          <form onSubmit={submit} className="mt-6 flex w-full flex-col items-center gap-2">
            <label htmlFor="public-link" className="font-type text-sm text-muted">
              {t.orPaste}
            </label>
            <div className="flex w-full gap-2">
              <label className="field sketch sketch-thin paper-fill flex min-w-0 flex-1 rounded-md">
              <input
                id="public-link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://soundcloud.com/…"
                className="min-w-0 flex-1 px-3 py-2 text-text placeholder:text-muted/70"
              />
              </label>
              <PaperButton type="submit" disabled={opening}>
                {t.open}
              </PaperButton>
            </div>
            {error && (
              <p role="alert" className="font-type text-sm text-text">
                <span className="mr-1 text-blood">✖</span>
                {error}
              </p>
            )}
          </form>
          <details className="mt-6 w-full font-type text-sm text-muted">
            <summary className="cursor-pointer text-center hover:text-text">{t.loginTrouble}</summary>
            <p className="mt-2 text-left leading-relaxed">{t.loginTroubleText}</p>
          </details>
        </EmptyState>
      </div>
    </div>
  );
}
