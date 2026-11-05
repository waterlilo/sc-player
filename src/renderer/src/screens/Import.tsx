import { useMemo, useState, type FormEvent } from "react";
import { artwork, type ImportItem, type Track } from "@shared/types";
import { IconButton, MarkerButton, PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import Tabs from "@/components/ui/Tabs";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { errorText, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { call } from "@/lib/sky";
import { missingText, refLink, pauseImport, pickedIds, pickImport, resetImport, resumeImport, saveImport, startImport, useImport, type ImportRow } from "@/state/import";
import { useNav } from "@/state/nav";
import { player } from "@/state/player";
import { useUi } from "@/state/ui";

type Filter = "all" | "found" | "maybe" | "none";
const SHOW_STEP = 200;

/** A pasted link, links or lines: what to paste, and how to get a link out of Yandex Music and Spotify. */
function Paste() {
  const t = useT();
  const phase = useImport((s) => s.phase);
  const error = useImport((s) => s.error);
  const [text, setText] = useState("");
  const reading = phase === "reading";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && !reading) void startImport(text);
  };
  return (
    <form onSubmit={submit} className="max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-muted">{t.importIntro}</p>
      <label className="field sketch sketch-thin paper-fill flex rounded-md">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={t.importPlaceholder}
          aria-label={t.importPlaceholder}
          className="min-w-0 flex-1 resize-y bg-transparent px-3 py-2 font-type text-sm text-text placeholder:font-sans placeholder:text-muted/70"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <MarkerButton type="submit" disabled={!text.trim() || reading}>
          <Icon name="search" size={16} /> {reading ? t.importReading : t.importFind}
        </MarkerButton>
        {error && <p role="alert" className="text-sm text-glow">{error.message || errorText(t, error.code)}</p>}
      </div>
      <dl className="mt-8 grid gap-4 text-sm leading-relaxed sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--card-edge)] bg-[var(--card)] p-4 sm:col-span-2">
          <dt className="mb-1 font-semibold text-text">{t.importVk}</dt>
          <dd className="text-muted">
            {t.importVkHow}
            <span className="mt-3 flex flex-wrap items-center gap-3">
              <PaperButton disabled={reading} onClick={() => void startImport(null)}>
                {t.importVkOpen}
              </PaperButton>
              <button type="button" onClick={() => void call("import:vkBookmark")} className="text-sm text-muted underline underline-offset-2 hover:text-text">
                {t.importVkBookmark}
              </button>
            </span>
          </dd>
        </div>
        {[
          [t.importYandex, t.importYandexHow],
          [t.importSpotify, t.importSpotifyHow],
          [t.importYoutube, t.importYoutubeHow],
          [t.importOther, t.importOtherHow],
        ].map(([title, how]) => (
          <div key={title} className="rounded-lg border border-[var(--card-edge)] bg-[var(--card)] p-4">
            <dt className="mb-1 font-semibold text-text">{title}</dt>
            <dd className="text-muted">{how}</dd>
          </div>
        ))}
      </dl>
    </form>
  );
}

/** A SoundCloud upload in a row: cover, title, uploader, length; plays on click. */
function Upload({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onPlay}
      title={track.playability === "preview" ? t.willSubstitutePreview : track.playability === "ok" ? `${t.play}: ${track.title}` : t.willSubstitute}
      className="group flex min-w-0 items-center gap-3 rounded-md text-left">
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)]">
        {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />}
        <span className="absolute inset-0 hidden place-items-center bg-black/45 group-hover:grid">
          <Icon name="play" size={16} className="text-white" />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.95rem] font-medium text-text group-hover:underline">{track.title}</span>
        <span className="block truncate text-sm text-muted">
          {track.user.username} · {duration(track.durationMs)}
          {track.playability !== "ok" && <span className="ml-2 rounded-sm border border-current px-1 font-type text-[0.65rem] uppercase leading-4">{t[track.playability]}</span>}
        </span>
      </span>
    </button>
  );
}

const original = (i: ImportItem) => i.title || refLink(i.ref);

/** One track: as it was on the other service, and the SoundCloud upload chosen for it (or the choices). */
function Row({ row, index }: { row: ImportRow; index: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const play = (track: Track) => player.playFrom([track], 0, { kind: "static" });
  const choices = row.options;
  // nothing chosen yet but something might be it: the choices are shown right away
  const showChoices = choices.length > 0 && (open || !row.pick);
  const status =
    row.state === "waiting" ? t.importWaiting : row.state === "failed" ? t.importFailed : row.state === "none" ? t.importNone : !row.pick ? (choices.length ? t.importChoose : t.importLeftOut) : null;
  return (
    <li className="border-b border-[var(--card-edge)] py-2.5 last:border-b-0">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-3">
        <span aria-hidden="true" className="grid place-items-center">
          {row.state === "waiting" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-muted/50" />
          ) : row.pick ? (
            <Icon name="check" size={18} className={row.state === "found" ? "text-glow" : "text-text"} />
          ) : choices.length ? (
            <span className="font-type text-sm text-glow">?</span>
          ) : (
            <Icon name="close" size={16} className="text-muted" />
          )}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[0.95rem] text-text">{original(row.item)}</div>
          <div className="truncate text-sm text-muted">
            {row.item.artist}
            {row.item.durationMs !== null && ` · ${duration(row.item.durationMs)}`}
          </div>
        </div>
        <div className="min-w-0">{row.pick ? <Upload track={row.pick} onPlay={() => play(row.pick!)} /> : <span className="text-sm text-muted">{status}</span>}</div>
        <div className="flex items-center gap-0.5">
          {row.pick && choices.length > 0 && (
            <button type="button" aria-expanded={open} title={t.importOtherUploads(choices.length)} onClick={() => setOpen((v) => !v)} className="grid h-9 min-w-9 place-items-center rounded-full px-2 font-type text-xs text-muted hover:text-text">
              {open ? "−" : `+${choices.length}`}
            </button>
          )}
          {row.pick && <IconButton icon="close" size={17} label={t.importLeaveOut} onClick={() => pickImport(index, null)} />}
          {!row.pick && row.state !== "waiting" && row.item.title && (
            <IconButton icon="external" size={17} label={t.importSearchSite} onClick={() => void call("shell:open", `https://soundcloud.com/search/sounds?q=${encodeURIComponent(`${row.item.artist} ${row.item.title}`.trim())}`)} />
          )}
        </div>
      </div>
      {showChoices && (
        <ul className="ml-9 mt-2 grid gap-2">
          {choices.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Upload track={c} onPlay={() => play(c)} />
              </div>
              <PaperButton className="!px-3 !py-1 text-sm" onClick={() => (pickImport(index, c), setOpen(false))}>
                {t.importUse}
              </PaperButton>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The search going on, the tracks as they are found, and saving them as a playlist. */
function Results() {
  const t = useT();
  const { phase, service, title, partial, rows, error } = useImport();
  const go = useNav((s) => s.go);
  const toast = useUi((s) => s.showToast);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(SHOW_STEP);
  const [name, setName] = useState(title ?? "");
  const [saving, setSaving] = useState(false);

  const done = rows.filter((r) => r.state !== "waiting").length;
  const counts = useMemo(
    () => ({ found: rows.filter((r) => r.pick).length, maybe: rows.filter((r) => !r.pick && r.options.length).length, none: rows.filter((r) => !r.pick && !r.options.length && r.state !== "waiting").length }),
    [rows],
  );
  const picked = useMemo(() => pickedIds(rows).length, [rows]);
  const protectedPicks = useMemo(() => rows.filter((r) => r.pick && r.pick.playability !== "ok").length, [rows]);
  const list = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => (filter === "all" ? true : filter === "found" ? !!row.pick : filter === "maybe" ? !row.pick && row.options.length > 0 : !row.pick && !row.options.length && row.state !== "waiting")),
    [rows, filter],
  );

  const save = async () => {
    if (saving || !picked) return;
    setSaving(true);
    try {
      const p = await saveImport(name.trim() || title || t.importDefaultName);
      toast(t.importSaved(picked));
      resetImport();
      go({ name: "playlist", id: p.id });
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t.playlistFailed);
    } finally {
      setSaving(false);
    }
  };
  const copyMissing = async () => {
    const text = missingText(rows);
    if (!text) return;
    await call("clipboard:write", text);
    toast(t.importCopied);
  };

  const filters: [Filter, string][] = [
    ["all", `${t.all} ${rows.length}`],
    ["found", `${t.importFound} ${counts.found}`],
    ["maybe", `${t.importCheck} ${counts.maybe}`],
    ["none", `${t.importNotFound} ${counts.none}`],
  ];
  const searching = phase === "searching";

  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="truncate text-xl font-semibold text-text">{title ?? t.importLooseTracks}</h2>
        {service && service !== "text" && <span className="font-type text-xs uppercase tracking-wider text-muted">{service === "yandex" ? t.importYandex : service === "youtube" ? t.importYoutube : service === "vk" ? t.importVk : t.importSpotify}</span>}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%` }} />
          </div>
          <p className="mt-1.5 font-type text-xs text-muted" aria-live="polite">
            {phase === "done" ? t.importDone(counts.found, rows.length) : phase === "paused" ? t.importPaused(done, rows.length) : t.importSearching(done, rows.length)}
          </p>
        </div>
        {searching && <PaperButton onClick={pauseImport}>{t.importPause}</PaperButton>}
        {phase === "paused" && <PaperButton onClick={resumeImport}>{t.importResume}</PaperButton>}
        <PaperButton onClick={resetImport}>{t.importStartOver}</PaperButton>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-glow">
          {error.code === "verify" ? t.importVerify : error.message || errorText(t, error.code)}
        </p>
      )}
      {partial && <p className="mb-3 max-w-2xl rounded-lg border border-[var(--card-edge)] bg-[var(--card)] px-4 py-3 text-sm leading-relaxed text-muted">{t.importPartial}</p>}

      {protectedPicks > 0 && <p className="mb-3 max-w-2xl text-sm leading-relaxed text-muted">{t.importProtected}</p>}
      <Tabs options={filters} value={filter} onChange={(f) => (setFilter(f), setShown(SHOW_STEP))} className="mb-2" />
      <ul>
        {list.slice(0, shown).map(({ row, index }) => (
          <Row key={index} row={row} index={index} />
        ))}
      </ul>
      {list.length > shown && (
        <PaperButton className="mt-3" onClick={() => setShown((n) => n + SHOW_STEP)}>
          {t.showMore}
        </PaperButton>
      )}

      <div className="sticky bottom-0 -mx-2 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--card-edge)] bg-[var(--bg)] p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
        <label className="field sketch sketch-thin paper-fill flex min-w-48 flex-1 rounded-md">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={title ?? t.importDefaultName} aria-label={t.playlistName} className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-text placeholder:text-muted/70" />
        </label>
        <MarkerButton disabled={!picked || saving} onClick={() => void save()}>
          {t.importSave(picked)}
        </MarkerButton>
        {counts.none + counts.maybe > 0 && phase !== "searching" && (
          <PaperButton title={t.importCopyHint} onClick={() => void copyMissing()}>
            <Icon name="copy" size={16} /> {t.importCopy}
          </PaperButton>
        )}
      </div>
    </div>
  );
}

/** Playlists from Yandex Music, Spotify, YouTube Music, VK or a list of text, found on SoundCloud and kept on this computer. */
export default function Import() {
  const t = useT();
  const hasRows = useImport((s) => s.rows.length > 0);
  return (
    <Screen label={t.importTitle}>
      <ScreenTitle>{t.importTitle.toLowerCase()}</ScreenTitle>
      {hasRows ? <Results /> : <Paste />}
    </Screen>
  );
}
