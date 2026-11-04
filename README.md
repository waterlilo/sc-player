<div align="center">

<img src=".github/assets/icon.png" width="72" alt="" />

# sc player

**A SoundCloud player for Windows, macOS and Linux — no ads, lyrics word by word, and friends to listen with.**

[Download](../../releases/latest) •
[Features](#features) •
[Install](#install) •
[Good to know](#good-to-know)

[![Latest release](https://img.shields.io/github/v/release/waterlilo/sc-player?style=flat-square&label=release&labelColor=111114&color=3a3a41)](../../releases/latest)
[![Downloads](https://img.shields.io/github/downloads/waterlilo/sc-player/total?style=flat-square&labelColor=111114&color=3a3a41)](../../releases)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-3a3a41?style=flat-square&labelColor=111114)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-3a3a41?style=flat-square&labelColor=111114)
![Linux](https://img.shields.io/badge/Linux-AppImage%20%2F%20deb-3a3a41?style=flat-square&labelColor=111114)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-3a3a41?style=flat-square&labelColor=111114)](LICENSE)

<br/>

<img src=".github/assets/hero.jpg" alt="sc player — the Home page over a living background" width="100%" />

</div>

---

## Preview

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <img src=".github/assets/fullscreen.jpg" alt="The full screen player with lyrics lit word by word" />
        <br/>
        <sub><b>Lyrics, word by word</b></sub>
      </td>
      <td align="center" width="50%">
        <img src=".github/assets/rooms.jpg" alt="A listening room with friends next to the Home page" />
        <br/>
        <sub><b>Listen together</b></sub>
      </td>
    </tr>
    <tr>
      <td align="center" colspan="2">
        <img src=".github/assets/appearance.jpg" alt="Settings → Appearance with an own interface colour and accent" width="50%" />
        <br/>
        <sub><b>Make it yours</b></sub>
      </td>
    </tr>
  </table>
</div>

> [!NOTE]
> sc player is an unofficial app, not affiliated with SoundCloud. It uses the same interface as soundcloud.com, so it
> needs SoundCloud to be reachable from your network.

---

## Features

**Together**
- **Listening rooms:** invite friends and everyone hears the same track at the same second. Pause is shared; the host
  puts on tracks or a whole playlist, the others suggest theirs; the host can hand the room over, and when the queue
  runs out similar tracks keep it going.
- **Send tracks to friends:** friend codes (no accounts), an Inbox, what your friends are listening to right now, and an
  invite link to send in any messenger.
- **On Home:** what your friends are playing and what people listen to on sc player (anonymous).

**Lyrics**
- From [Better Lyrics](https://betterlyrics.org) (often timed word by word), its community catalog Unison and
  [LRCLIB](https://lrclib.net); click a line to jump there.
- Words that come without timings can be matched to the song on your computer (Settings → Playback → Lyrics; an
  optional speech model, the sound never leaves your PC). Timings made for another upload are moved to fit this one.
- **Full screen player:** a big cover with a spectrum around it or along the bottom, and the words lighting up as
  they're sung.

**The look**
- Dark glass over a living background that takes the colours of the cover — or the cover itself, your own image, GIF
  or video.
- Your own interface colour and accent, blur, dim, panel opacity; lighter effects for slow PCs.
- **Workshop:** publish your look and install other people's.

**Your music**
- Likes, playlists, albums, stations, history, the feed of people you follow, any public profile; pin playlists and
  profiles to the sidebar.
- **Your own playlists:** make them, add to them, reorder, rename — kept on your computer, no sign-in needed; copy any
  SoundCloud playlist to change it, save the queue as one, export them to a file and back.
- **Bring your playlists over** from Spotify, Yandex Music, YouTube Music and VK Music (or a list of lines): paste a
  link, and every track is looked up on SoundCloud.
- **Honest shuffle** over the whole playlist or all your likes; **autopilot** keeps playing similar tracks.
- **Protected tracks:** when SoundCloud only streams a track with DRM or as a 30-second preview, sc player plays
  another upload of the same recording, checked by its sound (marked `ALT`).
- Seek on the waveform, a queue you can drag, crossfade, a 10-band equalizer, output device, sleep timer.

**On your computer**
- Media keys, the system's media controls, tray / menu bar icon, global hotkeys, notifications, start with the system.
- **Windows:** ⏮ ⏯ ⏭ under the taskbar preview.
- **macOS:** the window's own buttons; closing the window keeps the music playing (the Dock icon brings it back).
- Updates itself (Windows installer, Linux AppImage), or tells you a new version is out (macOS, .deb, portable).
  Nothing moves while the window is hidden — only the sound keeps going.

---

## Install

### Windows
1. Download `sc-player-setup-v….exe` (installer) or `sc-player-portable-v….exe` from the [latest release](../../releases/latest).
2. The app isn't code-signed, so Windows may say "Windows protected your PC": click **More info → Run anyway**.

### macOS
1. Download `sc-player-v…-arm64.dmg` (Apple Silicon: M1 and newer) or `sc-player-v…-x64.dmg` (Intel) from the
   [latest release](../../releases/latest).
2. Open the `.dmg` and drag **sc player** into **Applications**.
3. The app isn't signed with a paid Apple certificate, so macOS blocks the first launch ("sc player can't be
   opened", or "is damaged"). Open **Terminal** and run this once, then open sc player as usual:
   ```bash
   xattr -cr "/Applications/sc player.app"
   ```
   (Or, if macOS offers it: **System Settings → Privacy & Security**, scroll down, **Open Anyway** next to sc player.)
4. Lyrics auto-sync (the speech model) needs Apple Silicon; everything else works on Intel Macs too.

### Linux
- **AppImage** (any distribution): download `sc-player-v…-x86_64.AppImage`, make it executable
  (`chmod +x sc-player-*.AppImage`) and run it. It adds itself to the app menu and updates itself.
- **Debian / Ubuntu:** download `sc-player-v…-amd64.deb` and install it (`sudo apt install ./sc-player-*.deb`).
- On GNOME the tray icon needs the AppIndicator extension.

### Sign in
Click **Sign in to SoundCloud** to see your likes and playlists. If the sign-in window says "access temporarily restricted" or "something unexpected happened", use **Sign in with your browser** instead. Without signing in you can still search, listen, make playlists and open any public profile.

New versions install over the old one; your sign-in, settings and playlists stay.

---

## Good to know

- Some tracks are only streamed encrypted (DRM). If no other upload of the same recording exists, the track says
  `SoundCloud only` and opens on soundcloud.com.
- SoundCloud's bot protection doesn't let apps change playlists on SoundCloud, so the playlists you make here are kept
  on your computer (Export them now and then — they don't travel with your SoundCloud account).
- If SoundCloud changes its site, the app shows an error with **Retry**; if that doesn't help, check for a
  [new version](../../releases/latest). Something broken? Settings → Account → **Report a problem**.
- Settings → Network: **Automatic** uses your own connection, and sc player's own route to SoundCloud only when
  SoundCloud doesn't open over it. The community guide for SoundCloud in Russia with zapret:
  [«Как починить SoundCloud с помощью zapret»](https://github.com/Flowseal/zapret-discord-youtube/issues/7449)
  (by kkkwkswd).

---

## Thanks

- **[Better Lyrics](https://betterlyrics.org)** — sc player shows lyrics from Better Lyrics and from Unison, its
  community catalog, with the permission of its author. Many of them are timed word by word, so the words light up
  as they are sung. Thank you!
- **[LRCLIB](https://lrclib.net)** — the open lyrics database.
- **[Whisper](https://github.com/openai/whisper)** by OpenAI (MIT) — the speech model that matches plain lyrics to the
  song on your computer.
- **[ggrk52](https://github.com/ggrk52)** — the macOS version.
- The zapret guide for SoundCloud by kkkwkswd.

---

## License

Copyright © 2026 sky (@skythemontage) and the contributors.

sc player is free software under the [GNU General Public License v3.0](LICENSE): you may use, study, change and share
it, and a changed version you share must stay open under the same license, with its source.

The name **sc player** and its logo are not covered by the license (GPL-3.0 section 7e): a changed version you share
needs a name and logo of its own, so nobody takes it for this app.

---

<div align="center">
<sub>made by sky (@skythemontage) · SoundCloud is a trademark of SoundCloud Ltd.</sub>
</div>
