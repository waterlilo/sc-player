import { useEffect, useRef, useState } from "react";
import logo from "../../../../../assets/app-icon-small.svg";
import { errorText, useT } from "@/i18n";
import { looksLikeLink, openLink } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useUi } from "@/state/ui";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { unreadTotal, useSocial } from "@/state/social";
import { getViewValue, setViewValue, subscribeView } from "@/state/viewState";
import { WindowButtons } from "../chrome/TitleBar";
import Icon from "../ui/Icon";

const SEARCH_ROUTE = JSON.stringify({ name: "search" });

/**
 * The search box in the title bar: typing goes to Search with the words (Search keeps them as its own); Ctrl+K or
 * Ctrl+F puts the cursor here; Esc leaves it.
 */
function SearchBox() {
  const t = useT();
  const open = useNav((s) => s.open);
  const onSearch = useNav((s) => s.route.name === "search");
  const toast = useUi((s) => s.showToast);
  const box = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => String(getViewValue(SEARCH_ROUTE, "text") ?? ""));

  // what Search itself shows (its own box, a recent search picked there) comes back here
  useEffect(
    () =>
      subscribeView(() => {
        if (document.activeElement !== box.current) setText(String(getViewValue(SEARCH_ROUTE, "text") ?? ""));
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        box.current?.focus();
        box.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const change = (v: string) => {
    setText(v);
    setViewValue(SEARCH_ROUTE, "text", v);
    if (!onSearch) open("search", { name: "search" });
  };

  return (
    <label className="s-search s-glass" data-titlebar-search>
      <Icon name="search" size={14} />
      <input
        ref={box}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") box.current?.blur();
          // a pasted soundcloud.com link opens directly
          if (e.key === "Enter" && looksLikeLink(text)) void openLink(text).catch((err) => toast(errorText(t, errorCode(err))));
        }}
        placeholder={t.searchEverywhere}
        aria-label={t.search}
        data-keys-own
      />
      <kbd>Ctrl K</kbd>
    </label>
  );
}

function Status() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const open = useNav((s) => s.open);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const signedIn = status?.mode === "session";
  const kind = !online ? "bad" : signedIn ? "" : "off";
  return (
    <button type="button" onClick={() => !signedIn && open("likes", { name: "likes" })} className={`s-stat s-glass ${kind}`} title={signedIn && status.user ? t.signedInAs(status.user.username) : undefined}>
      <i />
      {!online ? t.offline : signedIn ? t.connected : t.notSignedIn}
    </button>
  );
}

/** Studio title bar: the mark, back / forward, search, the connection, the inbox bell, the window buttons. */
export default function StudioTitleBar() {
  const t = useT();
  const canBack = useNav((s) => s.stack.length > 0);
  const canForward = useNav((s) => s.ahead.length > 0);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  const open = useNav((s) => s.open);
  const social = useSocial((s) => !!s.status?.available);
  const unread = useSocial((s) => unreadTotal(s.unread) + (s.friends?.incoming.length ?? 0));
  return (
    <header className="s-tb">
      <div className="s-brand">
        <img src={logo} alt="" draggable={false} />
        {t.appName}
      </div>
      <div className="s-hist">
        <button type="button" className="s-ib" onClick={back} disabled={!canBack} aria-label={t.back} title={t.back}>
          <Icon name="back" size={14} />
        </button>
        <button type="button" className="s-ib" onClick={forward} disabled={!canForward} aria-label={t.forward} title={t.forward}>
          <Icon name="forward" size={14} />
        </button>
      </div>
      <SearchBox />
      <div className="ml-auto flex h-full items-center gap-1.5">
        <Status />
        {social && (
          <button type="button" className="s-ib s-glass !h-[30px] !w-[30px]" onClick={() => open("inbox", { name: "inbox" })} aria-label={t.inbox} title={t.inbox}>
            <Icon name="bell" size={14} />
            {unread > 0 && <span className="dot" />}
          </button>
        )}
        <div className="ml-1 h-full">
          <WindowButtons />
        </div>
      </div>
    </header>
  );
}
