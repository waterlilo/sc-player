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
