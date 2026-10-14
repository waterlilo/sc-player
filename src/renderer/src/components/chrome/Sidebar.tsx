import { useState, type FormEvent, type ReactNode } from "react";
import { artwork } from "@shared/types";
import { errorText, useT } from "@/i18n";
import { openLink, unsaveProfile } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useNav, type Route } from "@/state/nav";
import { useSettings } from "@/state/settings";
import Icon, { type IconName } from "../ui/Icon";
import ScribbleRing from "../ui/ScribbleRing";

function NavItem({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: IconName; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`group flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
      >
        {icon && <Icon name={icon} size={19} className={active ? "text-glow" : ""} />}
        <span className="relative min-w-0 py-0.5 font-medium">
          <span className="block truncate">{children}</span>
          {active && <ScribbleRing />}
        </span>
      </button>
    </li>
  );
}

function AddProfile({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return onDone();
    setBusy(true);
    setError(null);
    try {
      const r = await openLink(link, { saveUser: true });
      if (r.kind === "user") onDone();
      else setError(t.addProfileHint);
    } catch (err) {
      setError(errorText(t, errorCode(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="px-3 pb-2">
      <input
        autoFocus
        value={link}
        disabled={busy}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        placeholder="soundcloud.com/…"
        aria-label={t.addProfileHint}
        title={t.addProfileHint}
        className="paper-fill w-full rounded-md px-2 py-1.5 text-sm text-text outline-none placeholder:text-muted/70 focus-visible:outline-2"
      />
      {error && <p className="mt-1 font-type text-xs text-text">{error}</p>}
    </form>
  );
}

/** Sidebar: library, saved public profiles and the account. */
export default function Sidebar() {
  const t = useT();
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const profiles = useSettings((s) => s.savedProfiles);
  const status = useAuth((s) => s.status);
  const logout = useAuth((s) => s.logout);
  const [adding, setAdding] = useState(false);

  const is = (r: Route["name"]) => route.name === r;

  return (
    <nav aria-label="sky player" className="panel relative z-20 flex h-full w-[232px] flex-col overflow-hidden">
      <ul className="flex flex-col gap-0.5 px-2 pt-4">
        <NavItem icon="heart" active={is("likes")} onClick={() => go({ name: "likes" })}>
          {t.likes}
        </NavItem>
        <NavItem icon="playlists" active={is("playlists") || is("playlist")} onClick={() => go({ name: "playlists" })}>
          {t.playlists}
        </NavItem>
        <NavItem icon="history" active={is("history")} onClick={() => go({ name: "history" })}>
          {t.history}
        </NavItem>
        <NavItem icon="search" active={is("search")} onClick={() => go({ name: "search" })}>
          {t.search}
        </NavItem>
      </ul>

      <div className="mt-5 flex items-center justify-between px-5 pb-1">
        <h2 className="font-type text-xs uppercase tracking-[0.2em] text-muted">{t.profiles}</h2>
        <button type="button" aria-label={t.addProfile} title={t.addProfile} onClick={() => setAdding((a) => !a)} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:text-glow">
          <Icon name="plus" size={15} />
        </button>
      </div>
      {adding && <AddProfile onDone={() => setAdding(false)} />}
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2">
        {profiles.map((p) => (
          <li key={p.id} className="group/profile relative">
            <button
              type="button"
              onClick={() => go({ name: "profile", userId: p.id })}
              aria-current={route.name === "profile" && route.userId === p.id ? "page" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left ${route.name === "profile" && route.userId === p.id ? "text-text" : "text-muted hover:text-text"}`}
            >
              <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[var(--paper)]">
                {p.avatarUrl && <img src={artwork(p.avatarUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
              </span>
              <span className="relative min-w-0 text-sm">
                <span className="block truncate">{p.username}</span>
                {route.name === "profile" && route.userId === p.id && <ScribbleRing />}
              </span>
            </button>
            <button type="button" aria-label={`${t.removeProfile}: ${p.username}`} title={t.removeProfile} onClick={() => unsaveProfile(p.id)} className="absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-blood group-focus-within/profile:grid group-hover/profile:grid">
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex-1" />

      {status?.mode === "session" && status.user && (
        <div className="flex items-center gap-2 px-5 pb-4 text-sm text-muted">
          <span className="min-w-0 flex-1 truncate font-type text-xs">{status.user.username}</span>
          <button type="button" onClick={() => void logout()} className="font-type text-xs underline-offset-2 hover:text-text hover:underline">
            {t.logout}
          </button>
        </div>
      )}
    </nav>
  );
}
