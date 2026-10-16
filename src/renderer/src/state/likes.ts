import { create } from "zustand";
import type { Track } from "@shared/types";
import { queryClient } from "@/api/queries";
import { en as t } from "@/i18n/en";
import { call } from "@/lib/sky";
import { useAuth } from "./auth";
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

export function initLikes() {
  let mode = useAuth.getState().status?.mode;
  if (mode === "session") void load();
  useAuth.subscribe((s) => {
    if (s.status?.mode === mode) return;
    mode = s.status?.mode;
    if (mode === "session") void load();
    else useLikes.setState({ ids: new Set(), ready: false });
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
  } catch {
    // put it back as it was
    const back = new Set(useLikes.getState().ids);
    if (liked) back.delete(track.id);
    else back.add(track.id);
    useLikes.setState({ ids: back });
    useUi.getState().showToast(liked ? t.likeFailed : t.unlikeFailed);
  }
}
