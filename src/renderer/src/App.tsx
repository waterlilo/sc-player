import { motion } from "framer-motion";
import TitleBar from "@/components/chrome/TitleBar";
import Sidebar from "@/components/chrome/Sidebar";
import Backdrop from "@/components/deco/Backdrop";
import LivingBackdrop from "@/components/deco/LivingBackdrop";
import { useSettings } from "@/state/settings";
import SvgDefs from "@/components/deco/SvgDefs";
import PlayerBar from "@/components/player/PlayerBar";
import QueuePanel from "@/components/player/QueuePanel";
import EdgeGlow from "@/components/deco/EdgeGlow";
import LyricsPanel from "@/components/player/LyricsPanel";
import ScreenBoundary from "@/components/ui/ScreenBoundary";
import History from "@/screens/History";
import Feed from "@/screens/Feed";
import Likes from "@/screens/Likes";
import Playlist from "@/screens/Playlist";
import Playlists from "@/screens/Playlists";
import Profile from "@/screens/Profile";
import Search from "@/screens/Search";
import Settings from "@/screens/Settings";
import Track from "@/screens/Track";
import TrackMenu from "@/components/tracks/TrackMenu";
import Toast from "@/components/ui/Toast";
import PlaylistPicker from "@/components/tracks/PlaylistPicker";
import CheckDialog from "@/components/CheckDialog";
import { useNav, type Route } from "@/state/nav";

function ScreenFor({ route }: { route: Route }) {
  switch (route.name) {
    case "likes":
      return <Likes />;
    case "feed":
      return <Feed />;
    case "playlists":
      return <Playlists />;
    case "playlist":
      return <Playlist id={route.id} />;
    case "track":
      return <Track id={route.id} />;
    case "profile":
      return <Profile userId={route.userId} />;
    case "history":
      return <History />;
    case "search":
      return <Search />;
    case "settings":
      return <Settings />;
  }
}

/**
 * Window layout: title bar, sidebar, the current screen on its sheet, the player along the bottom. The backdrop
 * (stipple, day sky, grain) sits under all of it.
 */
export default function App() {
  const route = useNav((s) => s.route);
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  return (
    <>
      <SvgDefs />
      {studio ? <LivingBackdrop /> : <Backdrop />}
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <div className="app-grid relative z-10 grid h-full grid-cols-[232px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)_88px]">
        <div className="col-span-2">
          <TitleBar />
        </div>
        <Sidebar />
        <main className="relative min-h-0 overflow-hidden">
          {/* short screen transition (~180 ms) */}
          <motion.div key={JSON.stringify(route)} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
            <ScreenBoundary>
              <ScreenFor route={route} />
            </ScreenBoundary>
          </motion.div>
          {!studio && <EdgeGlow />}
          <QueuePanel />
          <LyricsPanel />
          <Toast />
        </main>
        <div className="col-span-2">
          <PlayerBar />
        </div>
      </div>
    </>
  );
}
