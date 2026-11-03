import { app } from "electron";
import { prefs } from "./store";

/**
 * The few strings main shows itself (the tray menu, the taskbar buttons, file dialogs, the browser sign-in question,
 * import errors), in the interface's language: Settings → App → Language, "auto" following Windows like the window.
 */
export type Lang = "en" | "ru";

export function lang(): Lang {
  const p = prefs().language;
  if (p === "en" || p === "ru") return p;
  return /^ru\b/i.test(app.getLocale()) ? "ru" : "en";
}

const en = {
  nothingPlaying: "Nothing playing",
  play: "Play",
  pause: "Pause",
  next: "Next",
  previous: "Previous",
  show: "Show sc player",
  quit: "Quit",
  playlistsFile: "sc player playlists",
  textFile: "Text",
  signInAsk: "Sign in with the SoundCloud account from your browser?",
  signInAskDetail: "A sign-in link came from your browser. Go on only if you just clicked the “sc player sign-in” bookmark.",
  signIn: "Sign in",
  cancel: "Cancel",
  // importing
  yandexOffline: "Couldn't reach Yandex Music. Check the connection and try again.",
  yandexClosed: "This Yandex Music playlist doesn't open. If it's private, copy its link with Share in Yandex Music, or make it public.",
  yandexBusy: (status: number) => `Yandex Music didn't answer (${status}). Try again in a minute.`,
  yandexTrack: "This Yandex Music track doesn't open.",
  yandexRegion: "Yandex Music is closed to the country it sees you in (451). If a VPN is on, turn it off while the link is read (Settings → Network: “Windows settings”), then turn it back on.",
  spotifyOffline: "Couldn't reach Spotify. Check the connection and try again.",
  spotifyClosed: "This Spotify link doesn't open. The playlist may be private or deleted: in Spotify, make it public, or copy its tracks (see below).",
  spotifyBusy: (status: number) => `Spotify didn't answer (${status}). Try again in a minute.`,
  spotifyTrack: "This Spotify track doesn't open.",
  youtubeOffline: "Couldn't reach YouTube Music. Check the connection and try again.",
  youtubeClosed: "This YouTube playlist doesn't open. It may be private or deleted: in YouTube Music, set it to Public or Unlisted and copy its link again.",
  youtubeLikes: "“Liked music” opens only to you, signed in to YouTube. Add its songs to a playlist of your own (Public or Unlisted) and paste that playlist's link.",
  youtubeBusy: (status: number) => `YouTube Music didn't answer (${status}). Try again in a minute.`,
  youtubeTrack: "This YouTube video doesn't open.",
  importNothing: "Nothing to import here. Paste a link to a playlist or album, track links, or lines like “Artist — Title”.",
  importEmpty: "There are no tracks in this playlist.",
};

const ru: typeof en = {
  nothingPlaying: "Ничего не играет",
  play: "Играть",
  pause: "Пауза",
  next: "Следующий",
  previous: "Предыдущий",
  show: "Показать sc player",
  quit: "Выйти",
  playlistsFile: "Плейлисты sc player",
  textFile: "Текст",
  signInAsk: "Войти с аккаунтом SoundCloud из вашего браузера?",
  signInAskDetail: "Из браузера пришла ссылка для входа. Продолжайте, только если вы сейчас нажали закладку «sc player sign-in».",
  signIn: "Войти",
  cancel: "Отмена",
  yandexOffline: "Не удалось связаться с Яндекс Музыкой. Проверьте подключение и попробуйте ещё раз.",
  yandexClosed: "Этот плейлист Яндекс Музыки не открывается. Если он закрытый, скопируйте ссылку через «Поделиться» в Яндекс Музыке или сделайте его открытым.",
  yandexBusy: (status: number) => `Яндекс Музыка не ответила (${status}). Попробуйте через минуту.`,
  yandexTrack: "Этот трек Яндекс Музыки не открывается.",
  yandexRegion: "Яндекс Музыка закрыта для страны, в которой она вас видит (451). Если включён VPN — выключите его, пока читается ссылка (Настройки → Сеть: «Настройки Windows»), потом включите обратно.",
  spotifyOffline: "Не удалось связаться со Spotify. Проверьте подключение и попробуйте ещё раз.",
  spotifyClosed: "Эта ссылка Spotify не открывается. Возможно, плейлист закрытый или удалён: сделайте его открытым в Spotify или скопируйте его треки (см. ниже).",
  spotifyBusy: (status: number) => `Spotify не ответил (${status}). Попробуйте через минуту.`,
  spotifyTrack: "Этот трек Spotify не открывается.",
  youtubeOffline: "Не удалось связаться с YouTube Music. Проверьте подключение и попробуйте ещё раз.",
  youtubeClosed: "Этот плейлист YouTube не открывается. Возможно, он закрытый или удалён: в YouTube Music сделайте его открытым или доступным по ссылке и скопируйте ссылку ещё раз.",
  youtubeLikes: "«Понравившиеся» видны только вам — со входом в YouTube. Добавьте эти треки в свой плейлист (открытый или доступный по ссылке) и вставьте ссылку на него.",
  youtubeBusy: (status: number) => `YouTube Music не ответил (${status}). Попробуйте через минуту.`,
  youtubeTrack: "Это видео YouTube не открывается.",
  importNothing: "Здесь нечего импортировать. Вставьте ссылку на плейлист или альбом, ссылки на треки или строки вида «Исполнитель — Название».",
  importEmpty: "В этом плейлисте нет треков.",
};

/** the strings in the language chosen now */
export const m = () => (lang() === "ru" ? ru : en);
