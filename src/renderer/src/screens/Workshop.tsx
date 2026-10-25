import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { WsSort, WsTheme } from "@shared/social";
import Tabs from "@/components/ui/Tabs";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";

type Tab = WsSort | "mine";

function Modal({ label, onClose, children, width = "w-[44rem]" }: { label: string; onClose: () => void; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      onPointerDown={(e) => !ref.current?.contains(e.target as Node) && onClose()}
    >
      <div ref={ref} role="dialog" aria-label={label} className={`float-card paper-fill sketch sketch-thin max-h-full max-w-full overflow-y-auto rounded-md shadow-[0_30px_80px_rgba(0,0,0,0.55)] ${width}`} data-keys-own>
        {children}
      </div>
    </motion.div>
  );
}

function Card({ theme, onOpen }: { theme: WsTheme; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen} className="group min-w-0 text-left">
      <span className="ws-preview relative block aspect-[16/10] overflow-hidden rounded-md bg-white/[0.04] shadow-[0_10px_26px_rgba(0,0,0,0.35)]">
        <img src={theme.previewUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        {theme.background.startsWith("video/") && <span className="absolute left-2 top-2 rounded-[4px] bg-black/60 px-1.5 py-0.5 font-type text-[0.6rem] uppercase tracking-wider text-white/90">{t.video}</span>}
        {theme.hidden && <span className="absolute right-2 top-2 rounded-[4px] bg-blood/80 px-1.5 py-0.5 font-type text-[0.6rem] uppercase tracking-wider text-white">{t.hidden}</span>}
      </span>
      <span className="mt-2 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{theme.name}</span>
        <span className={`flex items-center gap-1 font-type text-xs ${theme.liked ? "text-glow" : "text-muted"}`}>
          <Icon name="heart" size={12} filled={theme.liked} />
          {theme.likes}
        </span>
      </span>
      <span className="block truncate text-xs text-muted">{t.byAuthor(theme.author || t.someone)}</span>
    </button>
  );
}

function ThemeDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const setPref = useSettings((s) => s.setPref);
  const joined = useSocial((s) => !!s.status?.profile);
  const q = useQuery({ queryKey: ["ws-theme", id], queryFn: () => call("ws:get", id) });
  const [busy, setBusy] = useState("");
  const theme = q.data;
  const [liked, setLiked] = useState<{ likes: number; liked: boolean } | null>(null);

  const apply = async () => {
    setBusy("apply");
    try {
      setPref("look", await call("ws:install", id));
      toast(t.themeApplied(theme?.name ?? ""));
      onClose();
    } catch {
      toast(t.themeFailed);
    } finally {
      setBusy("");
    }
  };
  const like = async () => {
    try {
      setLiked(await call("ws:like", id));
      void client.invalidateQueries({ queryKey: ["ws"] });
    } catch {
      toast(t.serverOffline);
    }
  };
  const report = async () => {
    const reason = window.prompt(t.reportWhy);
    if (reason === null) return;
    await call("ws:report", id, reason).then(
      () => toast(t.reported),
      () => toast(t.serverOffline),
    );
    onClose();
  };
  const remove = async () => {
    if (!window.confirm(t.deleteThemeConfirm)) return;
    await call("ws:delete", id).then(
      () => void client.invalidateQueries({ queryKey: ["ws"] }),
      () => toast(t.serverOffline),
    );
    onClose();
  };

  const mine = !!theme?.mine;
  const likes = liked?.likes ?? theme?.likes ?? 0;
  const isLiked = liked?.liked ?? theme?.liked ?? false;

  return (
    <Modal label={theme?.name ?? t.workshop} onClose={onClose}>
      {q.isPending ? (
        <div className="p-10">
          <Loading />
        </div>
      ) : !theme ? (
        <p className="p-8 text-sm text-muted">{t.themeGone}</p>
      ) : (
        <>
          <img src={theme.previewUrl} alt="" className="aspect-[16/10] w-full object-cover" draggable={false} />
          <div className="flex items-start gap-4 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-text">{theme.name}</h2>
              <p className="mt-0.5 text-xs text-muted">
                {t.byAuthor(theme.author || t.someone)} · {t.installs(theme.installs)}
              </p>
              {theme.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text/85">{theme.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5 font-type text-[0.65rem] uppercase tracking-wider text-muted">
                <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5">{theme.look.design === "og" ? "og" : "studio"}</span>
                <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5">{theme.background ? (theme.background.startsWith("video/") ? t.video : t.bgImage) : t.bgKind[theme.look.bg]}</span>
                {theme.look.accent && (
                  <span className="flex items-center gap-1 rounded-[4px] bg-white/[0.06] px-1.5 py-0.5">
                    <i className="inline-block h-2 w-2 rounded-full" style={{ background: theme.look.accent }} />
                    {theme.look.accent}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button type="button" disabled={!!busy} onClick={() => void apply()} className="marker-fill sketch sketch-thin rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60">
                {busy === "apply" ? t.applying : t.applyTheme}
              </button>
              <div className="flex items-center gap-1">
                {joined && (
                  <button type="button" onClick={() => void like()} className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm ${isLiked ? "text-glow" : "text-muted hover:text-text"}`} aria-pressed={isLiked}>
                    <Icon name="heart" size={15} filled={isLiked} />
                    {likes}
                  </button>
                )}
                {joined && !mine && (
                  <button type="button" onClick={() => void report()} className="rounded-md px-2 py-1 text-xs text-muted hover:text-text">
                    {t.report}
                  </button>
                )}
                {mine && (
                  <button type="button" onClick={() => void remove()} className="rounded-md px-2 py-1 text-xs text-muted hover:text-blood">
                    {t.delete}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function PublishDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const look = useSettings((s) => s.prefs.look);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [withBackground, setWithBackground] = useState(true);
  const hasOwnBg = look.bg === "file" && !!look.bgFile;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // the preview is a picture of the window: the dialog leaves first
    onClose();
    toast(t.publishing);
    await new Promise((r) => setTimeout(r, 450));
    try {
      await call("ws:publish", { name: name.trim(), description: description.trim(), withBackground: hasOwnBg && withBackground });
      toast(t.published);
      void client.invalidateQueries({ queryKey: ["ws"] });
    } catch (err) {
      toast(err instanceof Error && err.message && !/^HTTP/.test(err.message) ? err.message : t.serverOffline);
    }
  };

  return (
    <Modal label={t.publishLook} onClose={onClose} width="w-[30rem]">
      <form onSubmit={submit} className="p-5">
        <h2 className="text-lg font-semibold text-text">{t.publishLook}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t.publishHint}</p>
        <label className="field sketch sketch-thin paper-fill mt-4 flex rounded-md">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t.themeName} aria-label={t.themeName} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted/70" />
        </label>
        <label className="field sketch sketch-thin paper-fill mt-2 flex rounded-md">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} placeholder={t.themeDescription} aria-label={t.themeDescription} className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted/70" />
        </label>
        {hasOwnBg && (
          <label className="mt-3 flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={withBackground} onChange={(e) => setWithBackground(e.target.checked)} />
            {t.includeBackground}
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
            {t.cancel}
          </button>
          <button type="submit" disabled={!name.trim()} className="marker-fill sketch sketch-thin rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
            {t.publish}
          </button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted/80">{t.publishRules}</p>
      </form>
    </Modal>
  );
}

function Grid({ tab, q, onOpen }: { tab: Tab; q: string; onOpen: (id: string) => void }) {
  const t = useT();
  const query = useInfiniteQuery({
    queryKey: ["ws", tab, q],
    queryFn: ({ pageParam }) => call("ws:list", tab === "mine" ? "new" : tab, pageParam, q, tab === "mine"),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.more ? all.length : undefined),
    staleTime: 60_000,
  });
  const themes = query.data?.pages.flatMap((p) => p.themes) ?? [];
  if (query.isPending) return <Loading />;
  if (query.isError && !themes.length) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!themes.length) return <EmptyState caption={tab === "mine" ? t.noOwnThemes : q ? t.nothingFound : t.noThemes} />;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-5 gap-y-7">
        {themes.map((th) => (
          <Card key={th.id} theme={th} onOpen={() => onOpen(th.id)} />
        ))}
      </div>
      {query.hasNextPage && (
        <div className="mt-8 text-center">
          <button type="button" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage} className="sketch sketch-thin rounded-md px-4 py-1.5 text-sm text-text">
            {query.isFetchingNextPage ? t.loadingMore : t.showMore}
          </button>
        </div>
      )}
    </>
  );
}

/** Themes people made and shared, like wallpapers: open one, apply it; publish your own look. */
export default function Workshop() {
  const t = useT();
  const status = useSocial((s) => s.status);
  const open = useNav((s) => s.open);
  const [tab, setTab] = useState<Tab>("top");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  if (!status) return null;
  if (!status.available) return <EmptyState caption={t.inboxUnavailable} />;
  const joined = !!status.profile;
  const tabs: [Tab, string][] = [
    ["top", t.wsTop],
    ["new", t.wsNew],
    ...(joined ? ([["mine", t.wsMine]] as [Tab, string][]) : []),
  ];

  return (
    <Screen label={t.workshop}>
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="display-heading text-5xl leading-none text-text">{t.workshop.toLowerCase()}</h1>
          <p className="mt-2 text-sm text-muted">{t.workshopHint}</p>
        </div>
        <button
          type="button"
          onClick={() => (joined ? setPublishing(true) : open("inbox", { name: "inbox" }))}
          title={joined ? undefined : t.publishNeedsCode}
          className="marker-fill sketch sketch-thin flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold"
        >
          <Icon name="brush" size={15} />
          {t.publishLook}
        </button>
      </header>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Tabs options={tabs} value={tab} onChange={setTab} />
        <label className="field sketch sketch-thin paper-fill ml-auto flex w-60 items-center rounded-md" data-keys-own>
          <Icon name="search" size={15} className="ml-2.5 text-muted" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.searchThemes} aria-label={t.searchThemes} className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-muted/70" />
        </label>
      </div>
      <Grid tab={tab} q={tab === "mine" ? "" : q} onOpen={setOpened} />
      <AnimatePresence>
        {opened && <ThemeDialog key={opened} id={opened} onClose={() => setOpened(null)} />}
        {publishing && <PublishDialog key="publish" onClose={() => setPublishing(false)} />}
      </AnimatePresence>
    </Screen>
  );
}
