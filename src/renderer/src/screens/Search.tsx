import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueSource } from "@shared/types";
import { useSearchTracks } from "@/api/queries";
import TrackList from "@/components/tracks/TrackList";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { errorText, useT } from "@/i18n";
import { looksLikeLink, openLink } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useSettings } from "@/state/settings";
import { useViewState } from "@/state/viewState";

const HISTORY = 12;

/** Track search (phase 3 adds playlists, people and suggestions). A pasted soundcloud.com link opens directly. */
export default function Search() {
  const t = useT();
  const [text, setText] = useViewState("text", "");
  const [query, setQuery] = useViewState("query", "");
  const [linkError, setLinkError] = useState<string | null>(null);
  // studio: the box is in the title bar
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  const input = useRef<HTMLInputElement>(null);
  const q = useSearchTracks(query);
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "search", query, cursor }), [query, cursor]);

  const history = useSettings((s) => s.searchHistory);
  const saveSettings = useSettings((s) => s.save);

  // a search that found something goes to the recent searches
  const found = q.isSuccess && tracks.length > 0;
  useEffect(() => {
    if (!found || query.length < 2) return;
    const { searchHistory } = useSettings.getState();
    if (searchHistory[0]?.toLowerCase() === query.toLowerCase()) return;
    saveSettings({ searchHistory: [query, ...searchHistory.filter((h) => h.toLowerCase() !== query.toLowerCase())].slice(0, HISTORY) });
  }, [found, query, saveSettings]);

  const pick = (h: string) => {
    setText(h);
    setQuery(h);
  };

  useEffect(() => {
    if (!studio) input.current?.focus();
  }, [studio]);
  useEffect(() => {
    if (looksLikeLink(text)) return;
    const timer = window.setTimeout(() => setQuery(text.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [text, setQuery]);

  const onSubmit = async () => {
    if (!looksLikeLink(text)) return setQuery(text.trim());
    setLinkError(null);
    try {
      await openLink(text);
    } catch (err) {
      setLinkError(errorText(t, errorCode(err)));
    }
  };

  return (
    <Screen label={t.search}>
      <ScreenTitle>{t.search.toLowerCase()}</ScreenTitle>
      <form
        className={`mb-6 max-w-xl items-center gap-3 ${studio ? "hidden" : "flex"}`}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <label className="field sketch sketch-thin paper-fill flex flex-1 items-center gap-2 rounded-md px-3">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-text outline-none placeholder:text-muted/70"
          />
        </label>
      </form>
      {linkError && (
        <p role="alert" className="mb-4 font-type text-sm text-text">
          <span className="mr-1 text-blood">✖</span>
          {linkError}
        </p>
      )}
      {query.length < 2 && !text.trim() && history.length > 0 ? (
        <section aria-label={t.recentSearches} className="max-w-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-type text-xs uppercase tracking-[0.2em] text-muted">{t.recentSearches}</h2>
            <button type="button" onClick={() => saveSettings({ searchHistory: [] })} className="font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
              {t.clearHistory}
            </button>
          </div>
          <ul className="flex flex-col">
            {history.map((h) => (
              <li key={h} className="group flex items-center gap-2 rounded-md hover:bg-[var(--row-hover)]">
                <button type="button" onClick={() => pick(h)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-text">
                  <Icon name="history" size={16} className="shrink-0 text-muted" />
                  <span className="truncate">{h}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${t.removeFromHistory}: ${h}`}
                  title={t.removeFromHistory}
                  onClick={() => saveSettings({ searchHistory: history.filter((x) => x !== h) })}
                  className="mr-1 grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : query.length < 2 ? (
        <EmptyState caption={t.emptySearch} />
      ) : q.isPending ? (
        <Loading />
      ) : q.isError && !tracks.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !tracks.length ? (
        <EmptyState caption={t.noResults} />
      ) : (
        <TrackList tracks={tracks} source={source} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} label={t.search} />
      )}
    </Screen>
  );
}
