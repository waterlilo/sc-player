import type { SearchKind } from "./provider";
import type { Friends, Message, SocialStatus, SocialTrack, SocialUpdate, WsPage, WsSort, WsThemeFull } from "./social";
import type { AppErrorInfo, Lyrics, LyricsHit, Page, Playlist, QueueSource, Resolved, SavedProfile, StreamInfo, Track, TrackDetails, User } from "./types";

/**
 * The one contract between main and renderer. main registers a handler for every InvokeMap channel, preload exposes
 * them as typed methods on window.sky; events flow main → renderer through EventMap. Nothing else crosses the bridge.
 */

export type AuthMode = "session" | "public";
export interface AuthStatus {
  mode: AuthMode;
  user: User | null;
}

/** active — visible and focused; blurred — visible, another app has focus; hidden — minimized, hidden or in the tray */
export type WindowActivity = "active" | "blurred" | "hidden";

export type QualityPref = "auto" | "0" | "1" | "2";
export type RepeatMode = "off" | "all" | "one";

export interface PlayerSnapshot {
  queue: Track[];
  /** the queue in its order before shuffle was turned on, null when shuffle is off */
  original: Track[] | null;
  index: number;
  source: QueueSource;
  position: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
}

export type HotkeyAction = "playPause" | "next" | "previous" | "showWindow";
export type PlayerCommand = "playPause" | "next" | "previous";

/** What main needs to know about playback: tray menu and tooltip, notifications. */
export interface PlayerInfo {
  track: { id: number; title: string; artist: string; artworkUrl: string | null } | null;
  playing: boolean;
}

export type UpdateStatus =
  | { state: "idle" | "checking" | "none" }
  | { state: "available"; version: string; portable: boolean }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export interface NetCheck {
  name: string;
  ok: boolean;
  ms: number | null;
  detail: string;
}

export interface AppInfo {
  version: string;
  portable: boolean;
  packaged: boolean;
  logsDir: string;
  /** the build carries sc player's own proxy */
  builtinProxy: boolean;
}
export type StreamQuality = "high" | "low";
/** studio — the 2.0 look (dark glass over a living background); og — the hand-drawn night sky of 1.x */
export type Design = "studio" | "og";
/** what fills the window behind the studio design */
export type BackgroundKind = "liquid" | "cover" | "file" | "none";
/** The studio design's knobs. */
export interface Look {
  design: Design;
  bg: BackgroundKind;
  /** the picked image / GIF / video, copied into userData/backgrounds ("" = none) */
  bgFile: string;
  bgFileType: "image" | "video" | "";
  /** px, 0..40 */
  bgBlur: number;
  /** how much the background is darkened under the interface, 0..100 */
  bgDim: number;
  /** how much the background moves with the music, 0..100 (40 = the calm default) */
  bgReact: number;
  /** how opaque the glass panels are, 10..100 */
  panelOpacity: number;
  /** px of blur behind the panels, 0..60 */
  panelBlur: number;
  /** no blur behind panels (for slow PCs) */
  lite: boolean;
  /** a fixed accent "#rrggbb" (a workshop theme can set one); "" = from the cover */
  accent: string;
}
export type PopupCorner = "bottom-right" | "top-right" | "bottom-left" | "top-left";

/** Everything on the Settings screen. main reads the parts it acts on (tray, autostart, hotkeys, notifications). */
export interface Prefs {
  /** when the list runs out (repeat off), keep playing similar tracks */
  autopilot: boolean;
  /** the window's ✕ hides it to the tray instead of quitting */
  closeToTray: boolean;
  startWithWindows: boolean;
  /** started with Windows: stay in the tray */
  startMinimized: boolean;
  /** a toast when the track changes while the window isn't in front */
  notifications: boolean;
  /** a small card with the cover, title and artist in a corner of the screen for a few seconds on a track change */
  trackPopup: boolean;
  /** the night design's clouds drifting behind the window */
  skyClouds: boolean;
  /** stars twinkle with the top end, the edges flash on the kick (an analyser on the output) */
  reactiveSky: boolean;
  /** clouds and the glow take the colour of the cover */
  coverTint: boolean;
  popupCorner: PopupCorner;
  /** global shortcuts, Electron accelerator strings; "" = off */
  hotkeys: Record<HotkeyAction, string>;
  streamQuality: StreamQuality;
  /** seconds of overlap between tracks, 0 = off */
  crossfade: number;
  eq: { enabled: boolean; preset: string; gains: number[] };
  /** audio output device id, "" = system default */
  outputDevice: string;
  blockedArtists: { id: number; username: string }[];
  /** tracks whose title or artist contains one of these are hidden and skipped */
  hiddenKeywords: string[];
  /** check GitHub for a new version at start and every few hours */
  checkUpdates: boolean;
  /** play another SoundCloud upload of a track that is only streamed with DRM (or as a 30 s preview) */
  substitute: boolean;
  /** how close the other upload's length must be, seconds */
  substituteTolerance: number;
  /** tracks the user told not to substitute */
  noSubstitute: number[];
  /** proxy: system settings, none, an address (for everything), or sc player's own (SoundCloud only) */
  proxy: { mode: "system" | "direct" | "custom" | "builtin"; url: string; username: string };
  look: Look;
  /** a pop-up when a friend sends a track while the window isn't in front */
  socialPopups: boolean;
  /** once a day: an anonymous "one more app is running" to sc player's server (a random install id + the version) */
  countMe: boolean;
}

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const PREFS_DEFAULTS: Prefs = {
  autopilot: true,
  closeToTray: true,
  startWithWindows: false,
  startMinimized: true,
  notifications: false,
  trackPopup: false,
  skyClouds: true,
  reactiveSky: true,
  coverTint: true,
  popupCorner: "bottom-right",
  hotkeys: { playPause: "Control+Alt+Space", next: "Control+Alt+Right", previous: "Control+Alt+Left", showWindow: "Control+Alt+S" },
  streamQuality: "high",
  crossfade: 0,
  eq: { enabled: false, preset: "flat", gains: EQ_BANDS.map(() => 0) },
  outputDevice: "",
  blockedArtists: [],
  hiddenKeywords: [],
  checkUpdates: true,
  substitute: true,
  substituteTolerance: 3,
  noSubstitute: [],
  proxy: { mode: "system", url: "", username: "" },
  look: { design: "studio", bg: "liquid", bgFile: "", bgFileType: "", bgBlur: 14, bgDim: 72, bgReact: 40, panelOpacity: 58, panelBlur: 30, lite: false, accent: "" },
  socialPopups: true,
  countMe: true,
};

/** Fills in anything missing from stored prefs (new options in a newer version). */
export function withPrefDefaults(stored: Partial<Prefs> | undefined): Prefs {
  const p = { ...PREFS_DEFAULTS, ...stored };
  return { ...p, hotkeys: { ...PREFS_DEFAULTS.hotkeys, ...stored?.hotkeys }, eq: { ...PREFS_DEFAULTS.eq, ...stored?.eq }, proxy: { ...PREFS_DEFAULTS.proxy, ...stored?.proxy }, look: { ...PREFS_DEFAULTS.look, ...stored?.look } };
}

/** State the renderer keeps in main's store (settings.json in userData). */
export interface PinnedPlaylist {
  id: string;
  title: string;
  artworkUrl: string | null;
  trackCount: number;
}

export interface RendererState {
  /** player volume 0..1 and mute, kept between runs */
  volume: number;
  muted: boolean;
  quality: QualityPref;
  savedProfiles: SavedProfile[];
  /** playlists pinned to the sidebar */
  pinnedPlaylists: PinnedPlaylist[];
  history: Track[];
  searchHistory: string[];
  prefs: Prefs;
  player: PlayerSnapshot | null;
}

export const RENDERER_DEFAULTS: RendererState = {
  volume: 0.8,
  muted: false,
  quality: "auto",
  savedProfiles: [],
  pinnedPlaylists: [],
  history: [],
  searchHistory: [],
  prefs: PREFS_DEFAULTS,
  player: null,
};

export interface InvokeMap {
  "auth:status": () => AuthStatus;
  "auth:login": () => AuthStatus;
  "auth:logout": () => AuthStatus;
  /** sign in through the user's own browser: opens the helper page and waits for its link (15 min) */
  "auth:browser": () => void;
  /** Settings: show the track popup now, with the current track */
  "popup:preview": () => void;
  "auth:browserCancel": () => void;
  /** the bot protection stopped an action: open this soundcloud.com page in the app's session; resolves on close */
  "auth:check": (url: string) => void;

  "data:me": () => User | null;
  "data:likes": (cursor: string | null) => Page<Track>;
  "data:playlists": (cursor: string | null) => Page<Playlist>;
  "data:playlist": (id: string) => Playlist;
  "data:playlistTracks": (id: string, cursor: string | null) => Page<Track>;
  "data:user": (id: number) => User;
  "data:userLikes": (userId: number, cursor: string | null) => Page<Track>;
  "data:userTracks": (userId: number, cursor: string | null) => Page<Track>;
  "data:userPlaylists": (userId: number, cursor: string | null) => Page<Playlist>;
  "data:followings": (userId: number | "me", cursor: string | null) => Page<User>;
  "data:resolve": (url: string) => Resolved;
  "data:tracks": (ids: number[]) => Track[];
  "data:sourceIds": (source: QueueSource) => number[];
  "data:related": (trackId: number) => Track[];
  "data:trackDetails": (trackId: number) => TrackDetails;
  /** `deep`: read more search pages (the user asked for another upload and the first search found too few) */
  "data:alternatives": (trackId: number, deep?: boolean) => Track[];
  /** the words of a track (LRCLIB), null when none were found */
  "lyrics:get": (q: { trackId: number; artist: string; title: string; durationMs: number }) => Lyrics | null;
  "lyrics:search": (text: string) => LyricsHit[];
  /** use this LRCLIB record for the track from now on */
  "lyrics:pick": (trackId: number, lyricsId: number) => Lyrics | null;
  "data:feed": (cursor: string | null) => Page<Track>;
  /** `refresh`: read them again from SoundCloud (after liking on the site) */
  "data:likedIds": (refresh?: boolean) => number[];
  "data:setLiked": (trackId: number, liked: boolean) => void;
  "data:myPlaylists": () => Playlist[];
  "data:addToPlaylist": (playlistId: string, trackId: number) => void;
  "data:search": (query: string, kind: SearchKind, cursor: string | null) => Page<Track> | Page<Playlist> | Page<User>;
  "data:suggest": (query: string) => string[];
  "data:stream": (trackId: number) => StreamInfo;
  "data:waveform": (url: string) => number[];

  /** Settings → background: pick an image, GIF or video; main copies it into userData. null when cancelled */
  "bg:pick": () => { file: string; type: "image" | "video" } | null;
  "win:minimize": () => void;
  "win:toggleMaximize": () => void;
  "win:close": () => void;

  "store:get": () => RendererState;
  "store:set": (patch: Partial<RendererState>) => void;

  "shell:open": (url: string) => void;
  "clipboard:write": (text: string) => void;
  "clipboard:read": () => string;

  "player:state": (info: PlayerInfo) => void;
  "hotkeys:suspend": (suspended: boolean) => void;
  "app:info": () => AppInfo;
  "log:write": (message: string) => void;
  "diag:openLogs": () => void;
  "diag:netcheck": () => NetCheck[];
  "diag:clearCache": () => void;
  /** the proxy password, kept encrypted; "" removes it. Returns whether one is set. */
  "proxy:setPassword": (password: string) => boolean;
  "proxy:hasPassword": () => boolean;
  "update:check": () => UpdateStatus;
  "update:download": () => void;
  "update:install": () => void;

  /** sc player's own server: the messenger (friend codes, tracks only) */
  "social:status": () => SocialStatus;
  /** "Get my code": a new profile on the server with this name */
  "social:join": (name: string) => SocialStatus;
  "social:profile": (patch: { name?: string; shareNow?: boolean }) => SocialStatus;
  /** forget the profile here and on the server (friends, tracks, themes) */
  "social:leave": () => SocialStatus;
  "social:friends": () => Friends;
  "social:addFriend": (code: string) => Friends;
  "social:accept": (code: string) => Friends;
  /** decline, cancel or unfriend */
  "social:removeFriend": (code: string) => Friends;
  /** the new messages' ids, one per friend, in the order given */
  "social:send": (codes: string[], track: SocialTrack) => number[];
  /** the conversation with one friend, oldest first; `before` = an older page */
  "social:chat": (code: string, before?: number) => Message[];
  "social:seen": (code: string) => void;
  /** the newest tracks friends sent (empty without a profile) */
  "social:recent": () => Message[];
  "social:state": (messageId: number, state: "heard" | "liked" | "queued") => void;
  /** what is playing, for friends (sent only when sharing is on) */
  "social:now": (track: SocialTrack | null) => void;
  /** poll now (the inbox opened) */
  "social:poll": () => void;
  /** the theme workshop */
  "ws:list": (sort: WsSort, page: number, q: string, mine: boolean) => WsPage;
  "ws:get": (id: string) => WsThemeFull;
  /** publish the current look (with its own background when `withBackground`) and a picture of the window; the theme's id */
  "ws:publish": (t: { name: string; description: string; withBackground: boolean }) => string;
  /** download a theme (and its background): the look to apply */
  "ws:install": (id: string) => Look;
  "ws:like": (id: string) => { likes: number; liked: boolean };
  "ws:report": (id: string, reason: string) => void;
  "ws:delete": (id: string) => void;
}

export interface EventMap {
  "win:activity": WindowActivity;
  "win:maximized": boolean;
  "auth:changed": AuthStatus;
  /** the browser sign-in: its link arrived and SoundCloud refused the token */
  "auth:browserRefused": null;
  /** tray menu, global hotkeys */
  "player:command": PlayerCommand;
  /** global hotkeys that could not be registered (taken by another app) */
  "hotkeys:failed": HotkeyAction[];
  "update:status": UpdateStatus;
  /** the messenger: new tracks, unread counts, friends — after every poll that brought something */
  "social:update": SocialUpdate;
  /** a pop-up about a sent track was clicked: open the inbox (at this friend) */
  "social:open": string;
}

export type InvokeChannel = keyof InvokeMap;
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

/** Runtime allowlist for preload; the check below fails to compile when a channel is missing. */
export const INVOKE_CHANNELS = [
  "social:status",
  "social:join",
  "social:profile",
  "social:leave",
  "social:friends",
  "social:addFriend",
  "social:accept",
  "social:removeFriend",
  "social:send",
  "social:chat",
  "social:seen",
  "social:recent",
  "social:state",
  "social:now",
  "social:poll",
  "ws:list",
  "ws:get",
  "ws:publish",
  "ws:install",
  "ws:like",
  "ws:report",
  "ws:delete",
  "bg:pick",
  "auth:status",
  "auth:login",
  "auth:logout",
  "auth:browser",
  "auth:check",
  "popup:preview",
  "auth:browserCancel",
  "data:me",
  "data:likes",
  "data:playlists",
  "data:playlist",
  "data:playlistTracks",
  "data:user",
  "data:userLikes",
  "data:userTracks",
  "data:userPlaylists",
  "data:followings",
  "data:resolve",
  "data:tracks",
  "data:sourceIds",
  "data:related",
  "data:trackDetails",
  "data:alternatives",
  "lyrics:get",
  "lyrics:search",
  "lyrics:pick",
  "data:feed",
  "data:likedIds",
  "data:setLiked",
  "data:myPlaylists",
  "data:addToPlaylist",
  "data:search",
  "data:suggest",
  "data:stream",
  "data:waveform",
  "win:minimize",
  "win:toggleMaximize",
  "win:close",
  "store:get",
  "store:set",
  "shell:open",
  "clipboard:write",
  "clipboard:read",
  "player:state",
  "hotkeys:suspend",
  "app:info",
  "log:write",
  "diag:openLogs",
  "diag:netcheck",
  "diag:clearCache",
  "proxy:setPassword",
  "proxy:hasPassword",
  "update:check",
  "update:download",
  "update:install",
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = ["win:activity", "win:maximized", "auth:changed", "auth:browserRefused", "player:command", "hotkeys:failed", "update:status", "social:update", "social:open"] as const satisfies readonly (keyof EventMap)[];

type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
type MissingEvent = Exclude<keyof EventMap, (typeof EVENT_CHANNELS)[number]>;
export const _channelsComplete: [MissingInvoke, MissingEvent] extends [never, never] ? true : never = true;

/** What preload puts on window.sky. */
export interface SkyBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<Result<ReturnType<InvokeMap[K]>>>;
  on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
}
