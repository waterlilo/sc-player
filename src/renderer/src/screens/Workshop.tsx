import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { WsReported, WsReporter, WsSort, WsTheme } from "@shared/social";
import Tabs from "@/components/ui/Tabs";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { dateLocale, useT } from "@/i18n";
import { ask, askText } from "@/state/dialog";
import { useModRoles } from "@/lib/moderation";
import { call, errorCode } from "@/lib/sky";
import { fitTo } from "@/lib/videoFit";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";

type Tab = WsSort | "mine" | "reports";

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
    } catch (err) {
      toast(err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : t.themeFailed);
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
    const reason = await askText(t.reportWhy, t.report, t.reportReason, 300);
    if (reason === null) return;
    await call("ws:report", id, reason).then(
      () => toast(t.reported),
      () => toast(t.serverOffline),
    );
    onClose();
  };
  const remove = async () => {
    const asModerator = !theme?.mine;
    if (!(await ask(asModerator ? t.deleteOthersThemeConfirm(theme?.author || t.someone) : t.deleteThemeConfirm, t.delete, true))) return;
    await call("ws:delete", id, asModerator).then(
      () => void client.invalidateQueries({ queryKey: ["ws"] }),
      () => toast(t.serverOffline),
    );
    onClose();
  };

  const mine = !!theme?.mine;
  const moderator = useModRoles().workshop;
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
                {(mine || moderator) && (
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

const WORKSHOP_MAX = 25 * 1024 * 1024;

function PublishDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const look = useSettings((s) => s.prefs.look);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [withBackground, setWithBackground] = useState(true);
  const hasOwnBg = look.bg === "file" && !!look.bgFile;
  // a video over the workshop's 25 MB is fitted here before it goes (the own background stays as it is)
  const bgSize = useQuery({ queryKey: ["bg-size", look.bgFile], queryFn: () => call("bg:size", look.bgFile), enabled: hasOwnBg }).data ?? 0;
  const needsFit = hasOwnBg && withBackground && look.bgFileType === "video" && bgSize > WORKSHOP_MAX;
  const [fitting, setFitting] = useState<number | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let video: Uint8Array | undefined;
    if (needsFit) {
      setFitting(0);
      try {
        video = await fitTo(`scbg://file/${look.bgFile}`, WORKSHOP_MAX, (p) => setFitting(p));
      } catch (err) {
        setFitting(null);
        toast(err instanceof Error && err.message ? err.message : t.serverOffline);
        return;
      }
    }
    // the preview is a picture of the window: the dialog, the page and the toasts leave first, so the middle shows the
    // background rather than the workshop's own grid of themes
    onClose();
    const { setPosing } = useUi.getState();
    setPosing(true);
    try {
      await new Promise((r) => setTimeout(r, 450));
      await call("ws:capture");
    } catch (err) {
      setPosing(false);
      toast(err instanceof Error && err.message ? err.message : t.serverOffline);
      return;
    }
    setPosing(false);
    toast(t.publishing);
    try {
      await call("ws:publish", { name: name.trim(), description: description.trim(), withBackground: hasOwnBg && withBackground, video });
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
        {needsFit && fitting === null && <p className="mt-2 text-xs leading-relaxed text-muted">{t.fitNote(Math.round(bgSize / 1048576))}</p>}
        {fitting !== null && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${Math.round(fitting * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">{t.fittingVideo(Math.round(fitting * 100))}</p>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
            {t.cancel}
          </button>
          <button type="submit" disabled={!name.trim() || fitting !== null} className="marker-fill sketch sketch-thin rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
            {t.publish}
          </button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted/80">{t.publishRules}</p>
      </form>
    </Modal>
  );
}

function Grid({ tab, q, onOpen }: { tab: WsSort | "mine"; q: string; onOpen: (id: string) => void }) {
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

/** The moderator's tab: reported and hidden themes, the most reported first, with their reasons and what to do. */
function Reports() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const q = useQuery({ queryKey: ["ws-reports"], queryFn: () => call("ws:reports"), staleTime: 30_000 });
  const [busy, setBusy] = useState("");
  const settle = () => {
    void client.invalidateQueries({ queryKey: ["ws-reports"] });
    void client.invalidateQueries({ queryKey: ["ws"] });
  };
  const moderate = async (th: WsReported, hide: boolean) => {
    setBusy(th.id);
    try {
      await call("ws:moderate", th.id, hide);
      toast(hide ? t.themeHidden : t.themeKept);
      settle();
    } catch {
      toast(t.serverOffline);
    } finally {
      setBusy("");
    }
  };
  const remove = async (th: WsReported) => {
    if (!(await ask(t.deleteOthersThemeConfirm(th.author || t.someone), t.delete, true))) return;
    setBusy(th.id);
    try {
      await call("ws:delete", th.id, true);
      settle();
    } catch {
      toast(t.serverOffline);
    } finally {
      setBusy("");
    }
  };

  if (q.isPending) return <Loading />;
  // a key the server no longer takes is "not found" there (and none here, "unauthorized"): not SoundCloud's session
  if (q.isError) return ["unauthorized", "not_found"].includes(errorCode(q.error)) ? <EmptyState caption={t.moderatorWrong} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState caption={t.noReports} />;
  return (
    <div>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted">{t.reportsHint}</p>
      <ul className="flex flex-col gap-4">
        {q.data.map((th) => {
          // who reported it and why; a server before 2.4 sends only the reasons
          const reports: Partial<WsReporter>[] =
            th.reporters ??
            th.reasons
              .split(" | ")
              .map((r) => r.trim())
              .filter(Boolean)
              .map((reason) => ({ reason }));
          return (
            <li key={th.id} className={`flex gap-4 rounded-md bg-white/[0.035] p-3 ${busy === th.id ? "opacity-60" : ""}`}>
              <span className="relative block aspect-[16/10] w-56 shrink-0 overflow-hidden rounded-md bg-white/[0.04]">
                {th.previewUrl && <img src={th.previewUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
                {th.background.startsWith("video/") && <span className="absolute left-2 top-2 rounded-[4px] bg-black/60 px-1.5 py-0.5 font-type text-[0.6rem] uppercase tracking-wider text-white/90">{t.video}</span>}
                {th.hidden && <span className="absolute right-2 top-2 rounded-[4px] bg-blood/80 px-1.5 py-0.5 font-type text-[0.6rem] uppercase tracking-wider text-white">{t.hidden}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-text">{th.name}</span>
                  {th.reports > 0 && <span className="shrink-0 font-type text-xs text-blood">{t.reportCount(th.reports)}</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {t.byAuthor(th.author || t.someone)} · {th.authorCode} · {t.installs(th.installs)}
                </p>
                {th.description && <p className="mt-1.5 line-clamp-2 text-xs text-text/75">{th.description}</p>}
                <ul className="mt-2 flex flex-col gap-1 text-xs text-text/90">
                  {(reports.length ? reports : th.reports ? [{}] : []).map((r, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-blood">•</span>
                      <span className="min-w-0 break-words">
                        {r.code && <span className="mr-1.5 font-semibold text-text">{t.reportedBy(r.name ?? "", r.code)}:</span>}
                        {r.reason || <span className="text-muted">{t.noReason}</span>}
                        {!!r.created && <span className="ml-1.5 text-muted">· {new Date(r.created).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={!!busy} onClick={() => void moderate(th, false)} className="sketch sketch-thin rounded-md px-3 py-1 text-xs text-text disabled:opacity-50">
                    {t.keepTheme}
                  </button>
                  {!th.hidden && (
                    <button type="button" disabled={!!busy} onClick={() => void moderate(th, true)} className="sketch sketch-thin rounded-md px-3 py-1 text-xs text-text disabled:opacity-50">
                      {t.hideTheme}
                    </button>
                  )}
                  <button type="button" disabled={!!busy} onClick={() => void remove(th)} className="rounded-md px-3 py-1 text-xs text-muted hover:text-blood disabled:opacity-50">
                    {t.delete}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
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
  const moderator = useModRoles().workshop;
  const reports = useQuery({ queryKey: ["ws-reports"], queryFn: () => call("ws:reports"), enabled: moderator, staleTime: 30_000 }).data;

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
    // only with the moderator's key on this computer (Settings → Friends)
    ...(moderator ? ([["reports", t.wsReports(reports?.filter((r) => r.reports > 0).length ?? 0)]] as [Tab, string][]) : []),
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
        {tab !== "reports" && (
          <label className="field sketch sketch-thin paper-fill ml-auto flex w-60 items-center rounded-md" data-keys-own>
            <Icon name="search" size={15} className="ml-2.5 text-muted" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.searchThemes} aria-label={t.searchThemes} className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-muted/70" />
          </label>
        )}
      </div>
      {tab === "reports" && moderator ? <Reports /> : <Grid tab={tab === "reports" ? "top" : tab} q={tab === "mine" ? "" : q} onOpen={setOpened} />}
      <AnimatePresence>
        {opened && <ThemeDialog key={opened} id={opened} onClose={() => setOpened(null)} />}
        {publishing && <PublishDialog key="publish" onClose={() => setPublishing(false)} />}
      </AnimatePresence>
    </Screen>
  );
}
