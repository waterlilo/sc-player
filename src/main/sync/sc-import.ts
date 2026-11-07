import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { MusicProvider } from "@shared/provider";
import type { Playlist, ScImportStatus, Track } from "@shared/types";
import { addFollows, followsData } from "../local-follows";
import { addImportedLikes, likesData, setPlaylistSaved } from "../local-likes";
import { copiesOf, copyLocal } from "../local-playlists";
import { log } from "../system/log";
import { accountReady, setImportStatus, syncNow, vaultEntry, vaultHasPlaylistFrom } from "./engine";
import { ImportStopped, newMemory, runImport, type Memory, type Sink } from "./import-core";

/**
 * The SoundCloud library moves into the sc player account by itself (design §11, automatic): whenever this computer
 * is signed in to both — right after either sign-in, at start, and every 6 hours while both stay — the import runs in
 * the background (main/sync/import-core) and sync carries the result to the other devices. Settings → Account shows
 * its progress. Nothing here asks SoundCloud for more than reading the person's own library.
 */

const EVERY_MS = 6 * 60 * 60_000;

interface Saved {
  users: Record<string, Memory>;
}
const path = () => join(app.getPath("userData"), "sc-import.json");
function read(): Saved {
  try {
    const s = JSON.parse(readFileSync(path(), "utf8")) as Saved;
    return s && typeof s.users === "object" ? s : { users: {} };
  } catch {
    return { users: {} };
  }
}
function write(s: Saved) {
  const tmp = `${path()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, path());
}

let provider: MusicProvider | null = null;
let scSignedIn: () => boolean = () => false;
let running: Promise<void> | null = null;

/** sc player has it, had it (a tombstone: removed somewhere), or the person hid it from SoundCloud's list here. */
const sink: Sink = {
  hasLike: (id) => {
    const l = likesData();
    return l.liked.some((x) => x.id === id) || l.hidden.includes(id) || !!vaultEntry("likes", "tracks", String(id)) || vaultEntry("likes", "hidden", String(id)) === "live";
  },
  addLikes: (ids, now) => void addImportedLikes(ids, now),
  hasSaved: (id) => {
    const l = likesData();
    return !!l.playlists?.some((x) => x.playlist.id === id) || !!l.hiddenPlaylists?.includes(id) || !!vaultEntry("likes", "lists", id) || vaultEntry("likes", "hiddenLists", id) === "live";
  },
  addSaved: (p) => setPlaylistSaved(p.id, p as unknown as Playlist),
  hasOwn: (scId) => copiesOf(scId).length > 0 || vaultHasPlaylistFrom(scId),
  addOwn: (p, tracks) => void copyLocal(p.id, String(p.title).slice(0, 100) || "SoundCloud", tracks as unknown as Track[]),
  hasFollow: (id) => !!followsData()[String(id)] || !!vaultEntry("follows", "users", String(id)),
  addFollows: (users) => addFollows(users.map((u) => ({ id: u.id, username: u.username, permalinkUrl: u.permalinkUrl, avatarUrl: u.avatarUrl }))),
};

/** Runs the import if this computer is signed in to both (and it isn't running already). */
export function maybeImport(): Promise<void> {
  if (running || !provider || !accountReady() || !scSignedIn()) return running ?? Promise.resolve();
  const p = provider;
  running = (async () => {
    // the vault first: what it has (and had) decides what comes in
    await syncNow();
    if (!accountReady()) return;
    const saved = read();
    let shown = false;
    try {
      const r = await runImport(
        {
          me: async () => {
            const u = await p.getMe();
            return u ? { id: u.id, username: u.username, likesCount: u.likesCount, followingsCount: u.followingsCount } : null;
          },
          likes: (c) => p.getLikes(c),
          playlists: (c) => p.getPlaylists(c) as never,
          playlistTracks: (id, c) => p.getPlaylistTracks(id, c) as never,
          followings: (c) => p.getFollowings("me", c),
        },
        sink,
        {
          load: (id) => saved.users[String(id)] ?? newMemory(),
          save: (id, m) => {
            saved.users[String(id)] = m;
            write(saved);
          },
          progress: (pr) => {
            // a run that brings nothing (all of it is in the account already) stays quiet
            if (!shown && !pr.likes && !pr.playlists && !pr.saved && !pr.follows) return;
            shown = true;
            setImportStatus({ state: "running", ...pr, reason: null });
          },
        },
      );
      log("main", `sc import: done (+${r.likes} likes, +${r.playlists} playlists, +${r.saved} saved, +${r.follows} follows)`);
      if (r.likes || r.playlists || r.saved || r.follows) setImportStatus({ state: "done", ...r, reason: null } satisfies ScImportStatus);
      else if (shown) setImportStatus(null);
    } catch (e) {
      const reason = e instanceof ImportStopped ? e.reason : "unknown";
      log("main", `sc import: stopped (${reason}${e instanceof ImportStopped && e.message !== reason ? `: ${e.message}` : ""})`);
      setImportStatus({ state: "stopped", username: "", likes: 0, playlists: 0, saved: 0, follows: 0, totals: { likes: null, follows: null }, reason });
    }
    // what came in goes to the other devices now, not in 3 s
    await syncNow();
  })().finally(() => (running = null));
  return running;
}

/**
 * `sc` is the SoundCloud provider itself (not the one with this computer's likes in front); `signedIn` tells whether
 * SoundCloud is signed in here.
 */
export function initScImport(sc: MusicProvider, signedIn: () => boolean) {
  provider = sc;
  scSignedIn = signedIn;
  setTimeout(() => void maybeImport(), 20_000);
  setInterval(() => void maybeImport(), EVERY_MS).unref();
}
