import { motion } from "framer-motion";
import LivingBackdrop from "@/components/deco/LivingBackdrop";
import SvgDefs from "@/components/deco/SvgDefs";
import NowPlaying from "@/components/player/NowPlaying";
import AppearancePopover from "@/components/studio/AppearancePopover";
import StudioPlayerBar from "@/components/studio/PlayerBar";
import StudioQueue from "@/components/studio/Queue";
import StudioSidebar from "@/components/studio/Sidebar";
import StudioTitleBar from "@/components/studio/TitleBar";
import { useUi } from "@/state/ui";
import ScreenBoundary from "@/components/ui/ScreenBoundary";
import History from "@/screens/History";
import Local from "@/screens/Local";
import Home from "@/screens/Home";
import Inbox from "@/screens/Inbox";
import { Albums, Following, Stations } from "@/screens/Library";
import Workshop from "@/screens/Workshop";
import SendSheet from "@/components/social/SendSheet";
import InviteFloat from "@/components/room/Invites";
import RoomSheet from "@/components/room/RoomSheet";
import SkipNotice from "@/components/player/SkipNotice";
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
import Dialog from "@/components/Dialog";
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
    case "local":
      return <Local />;
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

/**
 * The window: title bar with search, sidebar, the page, the queue on the right, the player, over the living
 * background. While the workshop takes its picture of the look (`posing`), the page and the toasts step aside so
 * the background shows in the middle.
 */
export default function App() {
  const full = useUi((s) => s.fullOpen);
  const sideQueue = useUi((s) => s.sideQueue);
  const posing = useUi((s) => s.posing);
  return (
    <>
      <SvgDefs />
      <LivingBackdrop />
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <SendSheet />
      <RoomSheet />
      <InviteFloat />
      <SkipNotice />
      <div className={`s-shell relative z-10${sideQueue ? " with-queue" : ""}${full ? " full-open" : ""}`}>
        <StudioTitleBar />
        <StudioSidebar />
        <main className="relative min-h-0 overflow-hidden">
          {!posing && <Page />}
          {!posing && <Toast />}
        </main>
        {sideQueue && <StudioQueue />}
        <StudioPlayerBar />
        <NowPlaying />
      </div>
      <AppearancePopover />
      <Dialog />
    </>
  );
}

