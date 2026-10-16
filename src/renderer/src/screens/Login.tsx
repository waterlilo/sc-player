import { useState, type FormEvent } from "react";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import { EmptyState } from "@/components/ui/States";
import { errorText, useT } from "@/i18n";
import { openLink } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useAuth } from "@/state/auth";

/** Not signed in: "sign in", and a way to open any public profile without an account. */
export default function Login() {
  const t = useT();
  const { login, busy } = useAuth();
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
          <MarkerButton onClick={() => void login()} disabled={busy} className="text-lg">
            {t.loginButton}
          </MarkerButton>
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
