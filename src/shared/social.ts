/**
 * sc player's own server (server/README.md): the track messenger and the theme workshop. Shapes as the API returns
 * them; main talks to the server, the page only sees these.
 */

/** A track as it travels between friends: just enough to show it and open it. */
export interface SocialTrack {
  id: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface SocialProfile {
  /** the friend code others type to add you (SKY-XXXXX) */
  code: string;
  name: string;
  /** friends may see what is playing */
  shareNow: boolean;
}

export interface SocialStatus {
  /** this build knows a server */
  available: boolean;
  /** null until "Get my code" */
  profile: SocialProfile | null;
}

export interface Friend {
  code: string;
  name: string;
  since: number;
  /** playing right now (when they share it) */
  now: SocialTrack | null;
  /** their app can join listening rooms (older ones can't) */
  rooms?: boolean;
}

export interface FriendRequest {
  code: string;
  name: string;
  at: number;
}

export interface Friends {
  v: number;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export type MessageState = "" | "heard" | "liked" | "queued";

export interface Message {
  id: number;
  /** the sender's code (in updates) */
  from?: string;
  mine: boolean;
  track: SocialTrack;
  sent: number;
  seen: boolean;
  state: MessageState;
}

/** What a poll brings: new tracks for me, unread counts per friend, what friends did with mine, friends' "now". */
export interface SocialUpdate {
  messages: Message[];
  unread: Record<string, number>;
  states: Record<string, MessageState>;
  now: Record<string, SocialTrack>;
  friends?: Friends;
  /** invitations to listening rooms waiting for me */
  invites?: RoomInvite[];
}

// ---- listening rooms ------------------------------------------------------------------------------------------------

/** An invitation to a friend's listening room. */
export interface RoomInvite {
  room: string;
  /** who invited (their code and name) */
  by: string;
  name: string;
  at: number;
  /** the host now (may have changed since) */
  host: string;
  track: SocialTrack | null;
  members: number;
}

export interface RoomItem {
  uid: string;
  track: SocialTrack;
  /** who put it there (a code) */
  by: string;
  /** picked by the host's autopilot */
  auto?: boolean;
}

/**
 * A listening room as the server sends it, whole, after every change: what plays from which second (`position` at
 * the server time `at`, moving on while `playing`), who is in it, the host's queue, suggestions waiting, what played.
 */
export interface Room {
  id: string;
  version: number;
  /** the server's time when this was sent */
  now: number;
  host: string;
  startTogether: boolean;
  members: { code: string; name: string; here: boolean }[];
  track: SocialTrack | null;
  position: number;
  at: number;
  playing: boolean;
  /** who paused or resumed last */
  by: string;
  /** "start together": waiting for everyone to have the track loaded, until `until` at most */
  waiting: { until: number; ready: string[] } | null;
  queue: RoomItem[];
  /** what the host put on (a playlist, the likes…), after the queue: its name, the next few, how many are left */
  list?: { title: string; left: number; next: RoomItem[] } | null;
  suggestions: (RoomItem & { at: number })[];
  history: { track: SocialTrack; at: number }[];
}

export type RoomOp =
  | { op: "play"; track: SocialTrack; position?: number }
  | { op: "playing"; playing: boolean }
  | { op: "seek"; position: number }
  | { op: "next" }
  | { op: "queueAdd"; track: SocialTrack; next?: boolean; auto?: boolean }
  | { op: "queueRemove"; item: string }
  | { op: "queueMove"; item: string; to: number }
  | { op: "suggest"; track: SocialTrack }
  | { op: "decide"; item: string; take: boolean }
  | { op: "ready"; trackId: number }
  | { op: "playList"; tracks: SocialTrack[]; title: string }
  | { op: "listAppend"; tracks: SocialTrack[] }
  | { op: "listRemove"; item: string }
  | { op: "listClear" }
  | { op: "handOver"; to: string };

/** Where this app stands with rooms: in one (and connected or reconnecting), or not; why the last one ended. */
export interface RoomState {
  room: Room | null;
  /** my code */
  me: string;
  /** server time − this machine's time, ms */
  offset: number;
  connected: boolean;
  /** the room ended by itself (the server closed it, or I was dropped) rather than by my leaving */
  closed: boolean;
}

/** The appearance a workshop theme sets (the Settings → Appearance knobs that travel). */
export interface ThemeLook {
  design: "studio" | "og";
  bg: "liquid" | "cover" | "file" | "none";
  bgBlur: number;
  bgDim: number;
  bgReact: number;
  panelOpacity: number;
  panelBlur: number;
  /** "#rrggbb", or "" = from the cover */
  accent: string;
  /** the interface colour "#rrggbb", or "" = graphite (missing in themes published before it existed) */
  surface?: string;
}

export interface WsTheme {
  id: string;
  name: string;
  description: string;
  author: string;
  likes: number;
  installs: number;
  created: number;
  /** the preview image (an https address on the server) */
  previewUrl: string;
  /** the background's type ("image/png", "video/mp4"), "" without one */
  background: string;
  liked?: boolean;
  /** my own themes only */
  published?: boolean;
  hidden?: boolean;
}

export interface WsThemeFull extends WsTheme {
  look: ThemeLook;
  css: string;
  /** published by this device */
  mine: boolean;
}

export interface WsPage {
  themes: WsTheme[];
  more: boolean;
}

export type WsSort = "new" | "top";
