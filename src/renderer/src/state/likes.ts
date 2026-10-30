import { create } from "zustand";
import type { Track } from "@shared/types";
import { queryClient } from "@/api/queries";
import { en as t } from "@/i18n/en";
import { call, errorCode } from "@/lib/sky";
import { askCheck } from "./check";
import { useAuth } from "./auth";
import { useSettings } from "./settings";
import { useUi } from "./ui";

/** What the signed-in user liked, for the ♥ buttons. Read once after sign-in; a ♥ click changes it right away. */
export const useLikes = create<{ ids: Set<number>; ready: boolean }>(() => ({ ids: new Set(), ready: false }));

let loading: Promise<void> | null = null;

function load() {
  loading ??= call("data:likedIds")
    .then((ids) => useLikes.setState({ ids: new Set(ids), ready: true }))
    .catch(() => undefined)
    .finally(() => (loading = null));
  return loading;
}

/** ♥ works: signed in to SoundCloud, or with likes kept on this computer (Settings → Playback, the default) */
export const canLike = () => useAuth.getState().status?.mode === "session" || useSettings.getState().prefs.localLikes;
export const useCanLike = () => {
  const signedIn = useAuth((s) => s.status?.mode === "session");
  const local = useSettings((s) => s.prefs.localLikes);
  return signedIn || local;
};

export function initLikes() {
  let mode = useAuth.getState().status?.mode;
  let local = useSettings.getState().prefs.localLikes;
  const reload = () => {
    if (canLike()) void load();
    else useLikes.setState({ ids: new Set(), ready: false });
  };
  reload();
  useAuth.subscribe((s) => {
    if (s.status?.mode === mode) return;
    mode = s.status?.mode;
    reload();
  });
  useSettings.subscribe((s) => {
    if (s.prefs.localLikes === local) return;
    local = s.prefs.localLikes;
    reload();
    void queryClient.invalidateQueries({ queryKey: ["likes", "me"] });
  });
}

export const useLiked = (id: number | undefined) => useLikes((s) => id !== undefined && s.ids.has(id));

export async function toggleLike(track: Track) {
  const before = useLikes.getState().ids;
  const liked = !before.has(track.id);
  const ids = new Set(before);
  if (liked) ids.add(track.id);
  else ids.delete(track.id);
  useLikes.setState({ ids });
  try {
    await call("data:setLiked", track.id, liked);
    void queryClient.invalidateQueries({ queryKey: ["likes", "me"] });
  } catch (err) {
    // put it back as it was
    const back = new Set(useLikes.getState().ids);
    if (liked) back.delete(track.id);
    else back.add(track.id);
    useLikes.setState({ ids: back });
    if (errorCode(err) === "verify") askCheck({ action: liked ? t.like : t.unlike, url: track.permalinkUrl, retry: () => retryLike(track, liked) });
    else useUi.getState().showToast(liked ? t.likeFailed : t.unlikeFailed);
  }
}

/** After the check: try again; if it's still refused, maybe it was done on the site — read the likes again. */
async function retryLike(track: Track, liked: boolean): Promise<boolean> {
  let done = false;
  try {
    await call("data:setLiked", track.id, liked);
    done = true;
  } catch {
    const ids = await call("data:likedIds", true).catch(() => null);
    if (ids) {
      useLikes.setState({ ids: new Set(ids) });
      done = ids.includes(track.id) === liked;
    }
  }
  if (done) {
    const ids = new Set(useLikes.getState().ids);
    if (liked) ids.add(track.id);
    else ids.delete(track.id);
    useLikes.setState({ ids });
    void queryClient.invalidateQueries({ queryKey: ["likes", "me"] });
  }
  return done;
}
