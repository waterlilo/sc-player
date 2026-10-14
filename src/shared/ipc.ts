import type { SearchKind } from "./provider";
import type { AppErrorInfo, Page, Playlist, QueueSource, Resolved, SavedProfile, StreamInfo, Track, User } from "./types";

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

/** State the renderer keeps in main's store (settings.json in userData). */
export interface RendererState {
  quality: QualityPref;
  savedProfiles: SavedProfile[];
  history: Track[];
  player: PlayerSnapshot | null;
}

export const RENDERER_DEFAULTS: RendererState = {
  quality: "auto",
  savedProfiles: [],
  history: [],
  player: null,
};

export interface InvokeMap {
  "auth:status": () => AuthStatus;
  "auth:login": () => AuthStatus;
  "auth:logout": () => AuthStatus;

  "data:me": () => User | null;
  "data:likes": (cursor: string | null) => Page<Track>;
  "data:playlists": (cursor: string | null) => Page<Playlist>;
  "data:playlist": (id: string) => Playlist;
  "data:playlistTracks": (id: string, cursor: string | null) => Page<Track>;
  "data:user": (id: number) => User;
  "data:userLikes": (userId: number, cursor: string | null) => Page<Track>;
  "data:userPlaylists": (userId: number, cursor: string | null) => Page<Playlist>;
  "data:resolve": (url: string) => Resolved;
  "data:search": (query: string, kind: SearchKind, cursor: string | null) => Page<Track> | Page<Playlist> | Page<User>;
  "data:suggest": (query: string) => string[];
  "data:stream": (trackId: number) => StreamInfo;
  "data:waveform": (url: string) => number[];

  "win:minimize": () => void;
  "win:toggleMaximize": () => void;
  "win:close": () => void;

  "store:get": () => RendererState;
  "store:set": (patch: Partial<RendererState>) => void;

  "shell:open": (url: string) => void;
}

export interface EventMap {
  "win:activity": WindowActivity;
  "win:maximized": boolean;
  "auth:changed": AuthStatus;
}

export type InvokeChannel = keyof InvokeMap;
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

/** Runtime allowlist for preload; the check below fails to compile when a channel is missing. */
export const INVOKE_CHANNELS = [
  "auth:status",
  "auth:login",
  "auth:logout",
  "data:me",
  "data:likes",
  "data:playlists",
  "data:playlist",
  "data:playlistTracks",
  "data:user",
  "data:userLikes",
  "data:userPlaylists",
  "data:resolve",
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
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = ["win:activity", "win:maximized", "auth:changed"] as const satisfies readonly (keyof EventMap)[];

type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
type MissingEvent = Exclude<keyof EventMap, (typeof EVENT_CHANNELS)[number]>;
export const _channelsComplete: [MissingInvoke, MissingEvent] extends [never, never] ? true : never = true;

/** What preload puts on window.sky. */
export interface SkyBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<Result<ReturnType<InvokeMap[K]>>>;
  on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
}
