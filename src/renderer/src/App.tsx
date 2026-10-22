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
import NowPlaying from "@/components/player/NowPlaying";
import AppearancePopover from "@/components/studio/AppearancePopover";
import StudioPlayerBar from "@/components/studio/PlayerBar";
import StudioQueue from "@/components/studio/Queue";
import StudioSidebar from "@/components/studio/Sidebar";
import StudioTitleBar from "@/components/studio/TitleBar";
import { useUi } from "@/state/ui";
import ScreenBoundary from "@/components/ui/ScreenBoundary";
import History from "@/screens/History";
import Home from "@/screens/Home";
import Inbox from "@/screens/Inbox";
import { Albums, Following, Stations } from "@/screens/Library";
import Workshop from "@/screens/Workshop";
import SendSheet from "@/components/social/SendSheet";
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
    case "home":
      return <Home />;
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
    case "albums":
      return <Albums />;
    case "stations":
      return <Stations />;
    case "following":
      return <Following />;
    case "inbox":
      return <Inbox />;
    case "workshop":
      return <Workshop />;
    case "settings":
      return <Settings />;
  }
}

function Page() {
  const route = useNav((s) => s.route);
  return (
    // short screen transition (~180 ms)
    <motion.div key={JSON.stringify(route)} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
      <ScreenBoundary>
        <ScreenFor route={route} />
      </ScreenBoundary>
    </motion.div>
  );
}

/** The studio design's window: title bar with search, sidebar, the page, the queue on the right, the player. */
function StudioApp() {
  const full = useUi((s) => s.fullOpen);
  const sideQueue = useUi((s) => s.sideQueue);
  return (
    <>
      <LivingBackdrop />
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <SendSheet />
      <div className={`s-shell relative z-10${sideQueue ? " with-queue" : ""}${full ? " full-open" : ""}`}>
        <StudioTitleBar />
        <StudioSidebar />
        <main className="relative min-h-0 overflow-hidden">
          <Page />
          <Toast />
        </main>
        {sideQueue && <StudioQueue />}
        <StudioPlayerBar />
        <NowPlaying />
      </div>
      <AppearancePopover />
    </>
  );
}

/**
 * Window layout (og): title bar, sidebar, the current screen on its sheet, the player along the bottom. The backdrop
 * (stipple, night sky, grain) sits under all of it.
 */
export default function App() {
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  const full = useUi((s) => s.fullOpen);
  if (studio)
    return (
      <>
        <SvgDefs />
        <StudioApp />
      </>
    );
  return (
    <>
      <SvgDefs />
      <Backdrop />
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <SendSheet />
      <div className={`app-grid relative z-10 grid${full ? " full-open" : ""} h-full grid-cols-[232px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)_88px]`}>
        <div className="col-span-2">
          <TitleBar />
        </div>
        <Sidebar />
        <main className="relative min-h-0 overflow-hidden">
          <Page />
          <EdgeGlow />
          <QueuePanel />
          <LyricsPanel />
          <Toast />
        </main>
        <div className="col-span-2">
          <PlayerBar />
        </div>
        <NowPlaying />
      </div>
    </>
  );
}
