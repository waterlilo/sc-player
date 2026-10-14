import { QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Page, Playlist, Track, User } from "@shared/types";
import { call, SkyError } from "@/lib/sky";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      // Electron focus changes all the time (I alt-tab to After Effects): never refetch on that
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // main already retries network hiccups and waits out 429s; one more try here only for unknown failures
      retry: (count, err) => count < 1 && err instanceof SkyError && err.code === "unknown",
    },
  },
});

type Cursor = string | null;
const pages = { initialPageParam: null as Cursor, getNextPageParam: <T,>(last: Page<T>) => last.next };

export const useLikes = (userId: number | "me", enabled = true) =>
  useInfiniteQuery({
    queryKey: ["likes", userId],
    queryFn: ({ pageParam }) => (userId === "me" ? call("data:likes", pageParam) : call("data:userLikes", userId, pageParam)),
    enabled,
    ...pages,
  });

export const useUserTracks = (userId: number) =>
  useInfiniteQuery({
    queryKey: ["userTracks", userId],
    queryFn: ({ pageParam }) => call("data:userTracks", userId, pageParam),
    ...pages,
  });

export const usePlaylists = (userId: number | "me", enabled = true) =>
  useInfiniteQuery({
    queryKey: ["playlists", userId],
    queryFn: ({ pageParam }) => (userId === "me" ? call("data:playlists", pageParam) : call("data:userPlaylists", userId, pageParam)),
    enabled,
    ...pages,
  });

export const usePlaylist = (id: string) => useQuery({ queryKey: ["playlist", id], queryFn: () => call("data:playlist", id) });

export const usePlaylistTracks = (id: string) =>
  useInfiniteQuery({
    queryKey: ["playlistTracks", id],
    queryFn: ({ pageParam }) => call("data:playlistTracks", id, pageParam),
    ...pages,
  });

export const useUser = (id: number) => useQuery({ queryKey: ["user", id], queryFn: () => call("data:user", id), staleTime: 5 * 60_000 });

export const useSearchTracks = (query: string) =>
  useInfiniteQuery({
    queryKey: ["search", "tracks", query],
    queryFn: async ({ pageParam }) => (await call("data:search", query, "tracks", pageParam)) as Page<Track>,
    enabled: query.trim().length > 1,
    ...pages,
  });

export const useWaveform = (url: string | null) =>
  useQuery({
    queryKey: ["waveform", url],
    queryFn: () => call("data:waveform", url!),
    enabled: !!url,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

export type { Playlist, Track, User };
