import { artwork } from "@shared/types";
import { useUser } from "@/api/queries";
import { PaperButton } from "@/components/ui/Buttons";
import Chip from "@/components/ui/Chip";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { ErrorState } from "@/components/ui/States";
import { useT } from "@/i18n";
import { compactNumber } from "@/lib/format";
import { saveProfile, unsaveProfile } from "@/lib/links";
import { call } from "@/lib/sky";
import { useSettings } from "@/state/settings";
import { useViewState } from "@/state/viewState";
import { LikesList } from "./Likes";
import { PlaylistsView } from "./Playlists";

/** Any user's public likes and playlists — works without signing in. Can be kept in the sidebar. */
export default function Profile({ userId }: { userId: number }) {
  const t = useT();
  const saved = useSettings((s) => s.savedProfiles.some((p) => p.id === userId));
  const user = useUser(userId);
  const [tab, setTab] = useViewState<"likes" | "playlists">("tab", "likes");
  const u = user.data;

  return (
    <Screen label={u?.username ?? t.profiles} part={tab}>
      {user.isError && !u ? (
        <ErrorState error={user.error} onRetry={() => void user.refetch()} />
      ) : (
        <header className="mb-5 flex items-center gap-5">
          <div className="sketch sketch-round h-24 w-24 shrink-0 rounded-full bg-[var(--paper)]">
            {u?.avatarUrl && <img src={artwork(u.avatarUrl, "t300x300") ?? undefined} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />}
          </div>
          <div className="min-w-0">
            <h1 className="display-heading min-h-[3rem] truncate text-5xl leading-tight text-text">{u?.username}</h1>
            {u && (
              <div className="flex flex-wrap gap-x-3 font-type text-sm text-muted">
                {u.city && <span>{u.city}</span>}
                {u.followers !== null && <span>{t.followers(compactNumber(u.followers))}</span>}
              </div>
            )}
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            {u && (
              <PaperButton onClick={() => (saved ? unsaveProfile(userId) : saveProfile(u))} aria-pressed={saved}>
                <Icon name={saved ? "close" : "plus"} size={16} /> {saved ? t.removeProfile : t.addProfile}
              </PaperButton>
            )}
            {u?.permalinkUrl && (
              <PaperButton aria-label={t.openOnSoundCloud} title={t.openOnSoundCloud} onClick={() => void call("shell:open", u.permalinkUrl)}>
                <Icon name="external" size={16} />
              </PaperButton>
            )}
          </div>
        </header>
      )}
      <div role="tablist" className="mb-4 flex gap-2">
        <Chip index={0} active={tab === "likes"} onClick={() => setTab("likes")}>
          {t.likes}
        </Chip>
        <Chip index={1} active={tab === "playlists"} onClick={() => setTab("playlists")}>
          {t.playlists}
        </Chip>
      </div>
      {tab === "likes" ? <LikesList key={`l${userId}`} userId={userId} label={`${u?.username ?? ""} — ${t.likes}`} /> : <PlaylistsView key={`p${userId}`} userId={userId} />}
    </Screen>
  );
}
