import { motion } from "framer-motion";
import TitleBar from "@/components/chrome/TitleBar";
import Sidebar from "@/components/chrome/Sidebar";
import Backdrop from "@/components/deco/Backdrop";
import SvgDefs from "@/components/deco/SvgDefs";
import PlayerBar from "@/components/player/PlayerBar";
import QueuePanel from "@/components/player/QueuePanel";
import History from "@/screens/History";
import Likes from "@/screens/Likes";
import Playlist from "@/screens/Playlist";
import Playlists from "@/screens/Playlists";
import Profile from "@/screens/Profile";
import Search from "@/screens/Search";
import { useNav, type Route } from "@/state/nav";

function ScreenFor({ route }: { route: Route }) {
  switch (route.name) {
    case "likes":
      return <Likes />;
    case "playlists":
      return <Playlists />;
    case "playlist":
      return <Playlist id={route.id} />;
    case "profile":
      return <Profile userId={route.userId} />;
    case "history":
      return <History />;
    case "search":
      return <Search />;
  }
}

/**
 * Window layout: title bar, sidebar, the current screen on its sheet, the player along the bottom. The backdrop
 * (stipple, day sky, grain) sits under all of it.
 */
export default function App() {
  const route = useNav((s) => s.route);
  return (
    <>
      <SvgDefs />
      <Backdrop />
      <div className="relative z-10 grid h-full grid-cols-[232px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)_88px]">
        <div className="col-span-2">
          <TitleBar />
        </div>
        <Sidebar />
        <main className="relative min-h-0 overflow-hidden">
          {/* short screen transition (~180 ms) */}
          <motion.div key={JSON.stringify(route)} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
            <ScreenFor route={route} />
          </motion.div>
          <QueuePanel />
        </main>
        <div className="col-span-2">
          <PlayerBar />
        </div>
      </div>
    </>
  );
}
