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

/** Track search (phase 3 adds playlists, people and suggestions). A pasted soundcloud.com link opens directly. */
export default function Search() {
  const t = useT();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = useSearchTracks(query);
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "search", query, cursor }), [query, cursor]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (looksLikeLink(text)) return;
    const timer = window.setTimeout(() => setQuery(text.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

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
        className="mb-6 flex max-w-xl items-center gap-3"
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
      {query.length < 2 ? (
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
