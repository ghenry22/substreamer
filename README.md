<div align="center">

# Substreamer

**Stream your music library on iOS and Android — free and open source.**

<a href="https://apps.apple.com/us/app/substreamer/id1012991665"><img src="https://img.shields.io/badge/App_Store-0D96F6?style=for-the-badge&logo=app-store&logoColor=white" alt="Download on the App Store"></a>
<a href="https://play.google.com/store/apps/details?id=com.ghenry22.substream2"><img src="https://img.shields.io/badge/Google_Play-414141?style=for-the-badge&logo=google-play&logoColor=white" alt="Get it on Google Play"></a>

[![Tests](https://github.com/ghenry22/substreamer/actions/workflows/tests.yml/badge.svg)](https://github.com/ghenry22/substreamer/actions/workflows/tests.yml)
![Coverage](./badges/coverage.svg)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Crowdin](https://badges.crowdin.net/substreamer/localized.svg)](https://crowdin.com/project/substreamer)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?style=social)](https://github.com/sponsors/ghenry22)
![GitHub Stars](https://img.shields.io/github/stars/ghenry22/substreamer?style=social)

<img src="docs/assets/images/screenshots/hero_diagonal.jpg" alt="Substreamer app preview" width="700">

</div>

## Screenshots

<p align="center">
  <img src="docs/assets/images/screenshots/home.jpg" alt="Home Screen" width="180">
  &nbsp;
  <img src="docs/assets/images/screenshots/library_albums_grid.jpg" alt="Library" width="180">
  &nbsp;
  <img src="docs/assets/images/screenshots/player.jpg" alt="Now Playing" width="180">
  &nbsp;
  <img src="docs/assets/images/screenshots/album_detail.jpg" alt="Album Detail" width="180">
</p>

## Highlights

**Playback** — Background audio, lock screen controls, adjustable playback speed, shuffle and repeat modes, queue management.

**Offline Use** — Download albums and playlists for offline listening, background download queue with progress and automatic recovery, automatic offline mode (if you leave wifi or if you leave your home wifi network specifically), manual offline mode switch at any time, configurable storage limits and visibility of storage use, configurable download Quality.

**Ratings & Favorites** — 5-star ratings for songs, albums, artists (server support dependant), star albums, artists, and songs, dedicated favorites view with filtering, download favorites and keep them in sync with new changes.

**Scrobbling** — Automatic scrobble submission to your server with offline support. Scrobbles are queued locally when offline and submitted automatically when you reconnect.

**Listening Analytics** — Listening history, activity heatmaps, top artists, albums, and songs by play count, most active hours, listening streaks

**Search** — Quick search access on any main screen, Full search for more results from your entire library, automatically switches to seaching your downloaded content when in offline mode.

**Playlist Management** - Add any song to any playlist or create a new one on the fly, remove or re-order tracks in any saved playlist, quick access to save Artist Top Songs as a new playlist or save your current player queue as a new playlist.

**Sharing** - full support for sharing albums or playlists (server support dependant), allows you to set a server address override in case you have a different public address for people to access what you share with them, quick copy to clipboard so you can share it anywhere.  Full share management functionality in settings.

**Metadata** - Allow MusicBrainz ID (MBID) overrides to be set in app for both artists and albums, users can search on the detail screen to easily correct an incorrect match or choose the right MBID if the server does not provide one.

**Metadata Management** - The storage and data section in settings gives you access to a wealth of information, you can browse, refresh or remove any offline metadata, cached images or downloaded music, pending and completed scrobbles and more.  Great for the curious or for when something funky happens and you just want to know what or quickly fix it!

**Tablet Interface** — A beautiful landscape-optimized UI designed to make the most of larger screens. Multi-pane layouts, expanded album art, and spacious controls give you a rich, immersive experience on tablets.

**Appearance** — Light, dark, and system theme modes, custom accent colors, list and grid layout toggles and default settings, alphabetical quick-scroll for large libraries.

**Backup** - Substreamer does a few things that are outside what the subsonic API accomodates (MBID Overrides, Listening history and analytics) to deal with this we need to keep some detail locally with your app and we don't want it to be lost if you have to re-install the app or get a new device (No one wants to break their listening streak!).  This data is automatically set to be included in your devices native cloud backups.

## Integrations

<div align="center">
  <a href="https://github.com/NeptuneHub/AudioMuse-AI">
    <img src="docs/assets/images/audiomuse-ai.png" alt="AudioMuse-AI logo" width="120">
  </a>
</div>

### AudioMuse-AI

Substreamer supports [AudioMuse-AI](https://github.com/NeptuneHub/AudioMuse-AI) for AI-powered playlist generation. When AudioMuse-AI is enabled on your server, the **"Play more like this"** option on any song and the **"Play similar artists"** option on any artist will leverage AudioMuse-AI's sonic analysis to deliver smarter, more relevant recommendations — all generated locally from your own library with no external APIs.

## Compatible Servers

Substreamer works with any server implementing the [Subsonic API](http://www.subsonic.org/pages/api.jsp). Features are automatically adjusted based on what each server supports.

### Verified

Tested and actively supported. Features are gated based on each server's capabilities.

| Server | Notes |
|--------|-------|
| [Navidrome](https://www.navidrome.org/) | Recommended. Full API support including OpenSubsonic extensions. |
| [Subsonic](http://www.subsonic.org/) | The original Subsonic server. Tested against the official demo. |
| [Gonic](https://github.com/sentriz/gonic) | Lightweight, OpenSubsonic compatible. Some features limited (no shares, no scan). |
| [Nextcloud Music](https://github.com/owncloud/music) | Nextcloud app. Requires legacy authentication (toggle in Advanced options on login). No shares or scan. |
| [Ampache](https://ampache.org/) | Subsonic API compatibility mode. Requires legacy authentication (toggle in Advanced options on login). No shares or scan. |

### Compatible

Expected to work based on API version support. Not regularly tested.

| Server | Notes |
|--------|-------|
| [Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced) | Community fork of Airsonic. Classic Subsonic API. |

### Untested

These servers implement the Subsonic API but have not been tested with Substreamer. They may work but your experience may vary.

| Server | Notes |
|--------|-------|
| [Funkwhale](https://funkwhale.audio/) | Subsonic API compatibility mode. |
| [Supysonic](https://github.com/spl0k/supysonic) | Python-based, lightweight. |

## Getting Started

1. **Set up a server** — Install a Subsonic-compatible server to host your music. [Navidrome](https://www.navidrome.org/docs/installation/) is a great place to start.

2. **Download Substreamer** — Get the app for free on the [App Store](https://apps.apple.com/us/app/substreamer/id1012991665) or [Google Play](https://play.google.com/store/apps/details?id=com.ghenry22.substream2).

3. **Connect** — Open the app, enter your server URL and credentials, and start streaming.

## Translations

Substreamer is available in multiple languages thanks to community translators. Help translate the app into your language or improve existing translations on [Crowdin](https://crowdin.com/project/substreamer).

[![Crowdin](https://badges.crowdin.net/substreamer/localized.svg)](https://crowdin.com/project/substreamer)

Currently supported languages: English, French, German, Spanish, Italian. More languages are welcome — just start translating on Crowdin and we'll add it to the app.

## Community

- **Reddit:** [r/substreamer](https://www.reddit.com/r/substreamer/)
- **Bug reports & feature requests:** [GitHub Issues](https://github.com/ghenry22/substreamer/issues)
- **Contributing:** Pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

Substreamer is licensed under the [GNU General Public License v3.0](LICENSE).

You are free to use, modify, and distribute this software under the terms of the GPL-3.0. Any derivative works must also be distributed under the same license. See the [LICENSE](LICENSE) file for the full text.
