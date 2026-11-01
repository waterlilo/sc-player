import assert from "node:assert/strict";
import { test } from "node:test";
import { lineSource, parseInput, spotifyTitle, withVersion } from "./parse.ts";

test("Yandex Music links", () => {
  assert.deepEqual(parseInput("https://music.yandex.ru/users/label%40strela.in/playlists/1001?utm_source=share"), [{ kind: "yandexPlaylist", owner: "label@strela.in", id: "1001" }]);
  assert.deepEqual(parseInput("https://music.yandex.com/playlists/lk.1C3D398F-4071-805e-8574-9e8d81e828a7"), [{ kind: "yandexShared", uuid: "lk.1c3d398f-4071-805e-8574-9e8d81e828a7" }]);
  assert.deepEqual(parseInput("https://music.yandex.ru/users/someone/tracks"), [{ kind: "yandexPlaylist", owner: "someone", id: "3" }]);
  assert.deepEqual(parseInput("https://music.yandex.ru/album/41191261"), [{ kind: "yandexAlbum", id: "41191261" }]);
  assert.deepEqual(parseInput("https://music.yandex.ru/album/41191261/track/149352017"), [{ kind: "yandexTrack", id: "149352017" }]);
});

test("Spotify links, one per line as the Spotify app copies them", () => {
  const text = "https://open.spotify.com/track/2LlQb7Uoj1kKyGhlkBf9aC\nhttps://open.spotify.com/intl-de/track/569uHYIB0X324FZOBEhvit?si=abc\n\nspotify:track:2D7iDoCv55FL4ZaCF5y89f";
  assert.deepEqual(
    parseInput(text).map((s) => s.kind === "spotifyTrack" && s.id),
    ["2LlQb7Uoj1kKyGhlkBf9aC", "569uHYIB0X324FZOBEhvit", "2D7iDoCv55FL4ZaCF5y89f"],
  );
  assert.deepEqual(parseInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1"), [{ kind: "spotifyPlaylist", id: "37i9dQZF1DXcBWIGoYBM5M" }]);
  assert.deepEqual(parseInput("https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy"), [{ kind: "spotifyAlbum", id: "4aawyAB9vmqN3uQ7FjRGTy" }]);
});

test("lines of text", () => {
  assert.deepEqual(lineSource("Fleetwood Mac — Dreams"), { kind: "line", artist: "Fleetwood Mac", title: "Dreams", durationMs: null });
  assert.deepEqual(lineSource("12. Jay-Z - 99 Problems 3:54"), { kind: "line", artist: "Jay-Z", title: "99 Problems", durationMs: 234_000 });
  assert.deepEqual(lineSource("Кино – Группа крови"), { kind: "line", artist: "Кино", title: "Группа крови", durationMs: null });
  assert.deepEqual(lineSource("Just a title"), { kind: "line", artist: "", title: "Just a title", durationMs: null });
  assert.equal(lineSource("   "), null);
  // an unknown link is not a track named like a link
  assert.deepEqual(parseInput("https://example.com/whatever\nA - B"), [{ kind: "line", artist: "A", title: "B", durationMs: null }]);
});

test("versions: kept when they change the song", () => {
  assert.equal(spotifyTitle("Dreams - 2004 Remaster"), "Dreams");
  assert.equal(spotifyTitle("Ghostbusters - from the \"Ghostbusters\" Original Motion Picture Soundtrack"), "Ghostbusters");
  assert.equal(spotifyTitle("Song - Radio Edit"), "Song");
  assert.equal(spotifyTitle("Song - Live at Wembley"), "Song (Live at Wembley)");
  assert.equal(spotifyTitle("Song - Kaskade Remix"), "Song (Kaskade Remix)");
  assert.equal(withVersion("Any Other Name", "из фильма «Красота по-американски»"), "Any Other Name");
  assert.equal(withVersion("Siesta Del Sol", "Laid Back Summer Cut"), "Siesta Del Sol");
  assert.equal(withVersion("Weed", "Laid Back Mix"), "Weed (Laid Back Mix)");
  assert.equal(withVersion("Yesterday", "Remastered 2009"), "Yesterday");
});
