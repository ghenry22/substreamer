# Servers

A reference for server-specific configuration that affects how Substreamer interacts
with Subsonic-compatible servers. Use this document to look up the exact commands,
profile names, and gotchas for each server feature, and to track per-server quirks
that aren't obvious from the protocol spec.

This file is a living reference — add new sections as new server-specific behaviour
is discovered. Every claim should cite the source code, an issue/PR, or a primary
documentation page so a future reader can verify it.

---

## Authentication

Substreamer defaults to modern Subsonic **token authentication** — it sends `t=md5(password+salt)` and `s=salt` instead of the password itself. This is what every actively maintained Subsonic server expects, and it works out of the box on Navidrome, Subsonic, Gonic, MiniMediaSonicServer, and Airsonic-Advanced with the user's normal login password.

Two servers in our compatibility list need a different setup: **Nextcloud Music** and **Ampache**. Both expose the Subsonic API as a compatibility layer on top of an existing user system that does not store passwords in a way that supports token auth, so both require:

1. A **dedicated API key / APIKEY** generated through the server's UI — the user's normal web-login password will **not** work.
2. Substreamer's **Legacy authentication** toggle turned **ON** (Login screen → Advanced options → Legacy auth). This switches the client from `t`+`s` token auth to sending `p=enc:HEX` (the password hex-encoded in plaintext over the connection — use HTTPS).

### Nextcloud Music

The Nextcloud Music app stores Nextcloud passwords as SHA-256 hashes, which makes Subsonic's `md5(password + salt)` token auth mathematically impossible — the server has no way to recover or recompute the value the client sends. The maintainer ([owncloud/music#893](https://github.com/owncloud/music/issues/893)) added a separate APIKEY system for Subsonic clients to work around this.

**Substreamer settings:**

| Field | Value |
|---|---|
| Server URL | `https://<your-nextcloud-host>/index.php/apps/music/subsonic` |
| Username | Your Nextcloud login name (or the UUID shown in step 4 below for LDAP accounts) |
| Password | The APIKEY generated in step 5 below — **not** your Nextcloud password |
| Legacy auth | **ON** |

**Server-side setup steps:**

1. Log in to Nextcloud as the user who owns the music library.
2. Open the **Music** app from the Nextcloud app launcher.
3. Click the **Settings** link at the **bottom of the left side pane** in the Music app.
4. Find the **"Ampache and Subsonic"** section. It will display the username to use in your Subsonic client. For most accounts this is your normal Nextcloud login; for LDAP-provisioned accounts it may be a UUID — use whichever value the dialog shows.
5. Click **Generate API Password**. The dialog displays a freshly generated APIKEY **once and only once**. Copy it immediately — there is no way to retrieve it later, only to delete and regenerate.
6. In Substreamer, enter the URL above, the username from step 4, the APIKEY from step 5 as the password, and enable **Legacy authentication** under Advanced options.

**Notes:**

- The APIKEY is **per user**. There is no global Subsonic password — every Nextcloud user that wants Substreamer access generates their own.
- Nextcloud's normal **App Passwords** (Settings → Security → Devices & sessions → Create new app password, used for WebDAV/CalDAV) are a separate system and **do not work** against the Music app's Subsonic endpoint. The APIKEY must be generated from inside the Music app itself.
- The Music app will accept the APIKEY indefinitely; it does not expire. To revoke access, delete the APIKEY from the same dialog.

**Sources:** [owncloud/music README](https://github.com/owncloud/music/blob/master/README.md), [owncloud/music wiki — Subsonic](https://github.com/owncloud/music/wiki/Subsonic), [owncloud/music#893](https://github.com/owncloud/music/issues/893).

### Ampache

Ampache's Subsonic API was originally based on Subsonic 1.11.0, which only supported plaintext authentication. Token auth was added later ([PR #1413](https://github.com/ampache/ampache/pull/1413)) but is wired against the API key column rather than the user's web-login password — Ampache's `AuthenticationManager::tokenLogin()` computes `md5(apiKey + salt)`, not `md5(password + salt)`. The web-login password does not work on the Subsonic endpoint at all. Substreamer uses legacy auth with the API key in the password field for the most reliable behaviour across Ampache 5.x / 6.x / 7.x.

**Substreamer settings:**

| Field | Value |
|---|---|
| Server URL | `https://<your-ampache-host>/` (the root of your Ampache install — e.g. `https://ampache.example.com/` or `https://example.com/ampache`) |
| Username | Your Ampache username |
| Password | The API key generated in step 4 below — **not** your Ampache web-UI password |
| Legacy auth | **ON** |

**Server-side setup steps:**

1. **Enable the Subsonic backend (admin task).** This is **not** in `ampache.cfg.php` — it lives as a database preference (`subsonic_backend`, default `0`) that has to be turned on through the admin web UI. Editing `ampache.cfg.php` will have no effect.
   - Log in as an administrator.
   - Navigate to **Admin → Server Config → Server** (or **System Options** in older releases).
   - Find the **"Use Subsonic backend"** checkbox and enable it.
   - Save.

2. **Confirm access control is enabled.** Ampache's Subsonic endpoint refuses all requests if the global `access_control` setting is off. Open `ampache.cfg.php` and confirm `access_control = "true"` (this is the default in shipped configs — only check if you have a heavily customised install).

3. **Confirm URL rewriting works.** Ampache's `/rest/...` endpoints depend on Apache's `mod_rewrite` (`a2enmod rewrite` plus `AllowOverride All` on the vhost) or the equivalent nginx rewrite block. If `https://<host>/rest/ping.view` returns 404 in a browser, this is the cause.

4. **Generate an API key for the user.** Historically this has been admin-only ([ampache/ampache#1324](https://github.com/ampache/ampache/issues/1324)) — the user-self-service flow under their own Account screen was reported broken in 2019 and has not been verified fixed in 6.x/7.x. Use the admin flow if the user-level option doesn't work in your version:
   - Admin → **User Tools → Browse Users**.
   - Click the target user → **Edit**.
   - Click **Generate API Key**. Save.
   - Copy the generated API key — this is the value the user enters as their password in Substreamer.

5. **Verify the endpoint** by opening this URL in a browser, replacing the placeholders:
   ```
   https://<your-ampache-host>/rest/ping.view?u=<username>&p=<apikey>&v=1.16.1&c=Substreamer&f=json
   ```
   - `{"status":"ok",...}` → ready, configure Substreamer.
   - `Disabled` → step 1 was not completed.
   - 404 → step 3 was not completed.
   - `{"status":"failed",...}` with an auth error → check the API key is correct (not the user's password) and that legacy auth is enabled in Substreamer.

6. In Substreamer, enter the Ampache root URL, the username, the API key as the password, and enable **Legacy authentication** under Advanced options.

**Notes:**

- **Ampache 5 vs 6 vs 7.** Ampache 5.x speaks Subsonic API 1.13.0; Ampache 6.x and 7.x speak 1.16.1. Ampache 7.x additionally advertises the OpenSubsonic `apiKeyAuthentication` extension, which would in theory let a client send `apiKey=...` instead of `u=`+`p=`. For backward compatibility across all three Ampache major versions, Substreamer continues to use legacy `p=` auth with the API key in the password field — this works on every Ampache 5/6/7 release.
- **`subsonic_legacy` per-user preference is unrelated.** Ampache has a per-user preference labelled "Enable legacy Subsonic API responses for compatibility issues". This controls server *response* shape (classic Subsonic vs OpenSubsonic), not client authentication mode. Toggling it does not change anything Substreamer needs.
- **Streaming redirect issues.** If playback starts then immediately fails with a 301/302 error, set `local_web_path = "http://localhost"` in `ampache.cfg.php` (community workaround for reverse-proxy setups where Ampache miscalculates its own URL during stream redirects).

**Sources:** [Ampache Subsonic API documentation](https://ampache.org/api/subsonic/), [`SubsonicApiApplication.php`](https://github.com/ampache/ampache/blob/develop/src/Module/Api/SubsonicApiApplication.php), [`AuthenticationManager.php`](https://github.com/ampache/ampache/blob/develop/src/Module/Authentication/AuthenticationManager.php), [ampache/ampache#1389](https://github.com/ampache/ampache/issues/1389), [ampache/ampache#1324](https://github.com/ampache/ampache/issues/1324), [ampache/ampache#541](https://github.com/ampache/ampache/issues/541).

---

## Transcoding profiles

The audio quality picker exposes a curated set of stream/download format presets.
Each preset corresponds to a `format=` value sent to the server. Different servers
interpret `format=` differently — Navidrome treats it as a codec name, Gonic treats
it as a profile name, Ampache matches it against `encode_args_<codec>` config keys —
so the same preset can map to wildly different ffmpeg invocations depending on which
server is on the other end.

The table below documents the canonical ffmpeg command for each preset, the client
platforms it plays on, and any special requirements (admin configuration, source-file
prerequisites, encoder libraries). For the four advanced presets that require admin
setup (`opus_rg`, `opus_car`, `mp3_rg`, `mp3_car`), the per-server "how to add the
profile" steps are in the [Enabling advanced transcoding profiles](#enabling-advanced-transcoding-profiles)
section below — in practice it is a copy-paste of the command from the table into
the server's transcoding profile UI under the matching profile name.

```
┌──────────┬───────────────────────────────────────────────────────┬─────┬─────────┬──────────────────────────────────────────────┐
│ Format   │ Transcode command                                     │ iOS │ Android │ Special requirements                         │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ raw      │ (no transcoding — format param omitted)               │  ✓¹ │    ✓¹   │ Source codec must be playable on the client  │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ mp3      │ ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk               │  ✓  │    ✓    │ None — works on every server out of the box  │
│          │        -v 0 -f mp3 -                                  │     │         │                                              │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ aac      │ ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk               │  ✓  │    ✓    │ Navidrome older than PR #5167 produces       │
│          │        -v 0 -c:a aac -f adts -                        │     │         │ silent output. Ampache needs libfdk_aac      │
│          │                                                       │     │         │ ffmpeg build (or admin swap to native aac).  │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ opus     │ ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk               │  ✗  │    ✓    │ iOS cannot play Opus-in-Ogg (which is what   │
│          │        -v 0 -c:a libopus -f opus -                    │     │         │ every server outputs). Android-only in       │
│          │                                                       │     │         │ practice.                                    │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ opus_rg  │ ffmpeg -v 0 -i %s -ss %t -map 0:a:0 -vn -b:a %bk      │  ✗  │    ✓    │ Gonic-only by default. Other servers need    │
│          │        -c:a libopus -vbr on                           │     │         │ admin to add the profile under the name      │
│          │        -af "volume=replaygain=track                   │     │         │ "opus_rg". Source files must be tagged with  │
│          │             :replaygain_preamp=6dB                    │     │         │ ReplayGain (use loudgain or rsgain).         │
│          │             :replaygain_noclip=0,                     │     │         │ iOS-blocked (Opus).                          │
│          │             alimiter=level=disabled,                  │     │         │                                              │
│          │             asidedata=mode=delete:type=REPLAYGAIN"    │     │         │                                              │
│          │        -metadata replaygain_*=                        │     │         │                                              │
│          │        -metadata r128_*=                              │     │         │                                              │
│          │        -f opus -                                      │     │         │                                              │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ opus_car │ ffmpeg -v 0 -i %s -ss %t -map 0:a:0 -vn -b:a %bk      │  ✗  │    ✓    │ Gonic-only by default. Other servers need    │
│          │        -c:a libopus -vbr on                           │     │         │ admin to add the profile under the name      │
│          │        -af "aresample=96000:resampler=soxr,           │     │         │ "opus_car". ReplayGain-tagged source files.  │
│          │             volume=replaygain=track                   │     │         │ Heavy CPU. iOS-blocked (Opus).               │
│          │             :replaygain_preamp=15dB                   │     │         │                                              │
│          │             :replaygain_noclip=0,                     │     │         │                                              │
│          │             alimiter=level=disabled,                  │     │         │                                              │
│          │             asidedata=mode=delete:type=REPLAYGAIN"    │     │         │                                              │
│          │        -metadata replaygain_*=                        │     │         │                                              │
│          │        -metadata r128_*=                              │     │         │                                              │
│          │        -f opus -                                      │     │         │                                              │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ ogg      │ ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk               │  ✗  │    ✓    │ Admin must add the profile on every server.  │
│          │        -v 0 -c:a libvorbis -f ogg -                   │     │         │ iOS has no Vorbis decoder at all.            │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ flac     │ ffmpeg -i %s -ss %t -map 0:a:0 -v 0 -c:a flac         │  ✓  │    ✓    │ Navidrome ships it. Other servers need admin │
│          │        -f flac -                                      │     │         │ to add it. Pointless against MP3/AAC sources │
│          │                                                       │     │         │ (lossy → lossless wastes bandwidth).         │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ mp3_rg ★ │ ffmpeg -v 0 -i %s -ss %t -map 0:a:0 -vn -b:a %bk      │  ✓  │    ✓    │ Ships in Gonic by default. Other servers     │
│          │        -c:a libmp3lame                                │     │         │ need admin to add the profile under the      │
│          │        -af "volume=replaygain=track                   │     │         │ exact name "mp3_rg". ReplayGain-tagged       │
│          │             :replaygain_preamp=6dB                    │     │         │ source files required.                       │
│          │             :replaygain_noclip=0,                     │     │         │                                              │
│          │             alimiter=level=disabled,                  │     │         │                                              │
│          │             asidedata=mode=delete:type=REPLAYGAIN"    │     │         │                                              │
│          │        -metadata replaygain_*=                        │     │         │                                              │
│          │        -metadata r128_*=                              │     │         │                                              │
│          │        -ar 48000 -f mp3 -                             │     │         │                                              │
├──────────┼───────────────────────────────────────────────────────┼─────┼─────────┼──────────────────────────────────────────────┤
│ mp3_car ★│ ffmpeg -v 0 -i %s -ss %t -map 0:a:0 -vn -b:a %bk      │  ✓  │    ✓    │ Not shipped by ANY server today. Admin must  │
│          │        -c:a libmp3lame                                │     │         │ add the profile under "mp3_car" on every     │
│          │        -af "aresample=96000:resampler=soxr,           │     │         │ server. ReplayGain-tagged source files.      │
│          │             volume=replaygain=track                   │     │         │ Heavy CPU.                                   │
│          │             :replaygain_preamp=15dB                   │     │         │                                              │
│          │             :replaygain_noclip=0,                     │     │         │                                              │
│          │             alimiter=level=disabled,                  │     │         │                                              │
│          │             asidedata=mode=delete:type=REPLAYGAIN,    │     │         │                                              │
│          │             aresample=48000:resampler=soxr"           │     │         │                                              │
│          │        -metadata replaygain_*=                        │     │         │                                              │
│          │        -metadata r128_*=                              │     │         │                                              │
│          │        -f mp3 -                                       │     │         │                                              │
└──────────┴───────────────────────────────────────────────────────┴─────┴─────────┴──────────────────────────────────────────────┘
```

★ = proposed Substreamer additions (cross-platform alternatives to Gonic's
Opus-only ReplayGain / Car-mode profiles, which give iOS users access to features
that today are Android+Gonic-only).

¹ `raw` playback depends on the source codec — both clients handle MP3/AAC/FLAC/
ALAC/WAV; uncommon containers (`.dsf`, `.wv`, `.tta`, `.shn`) won't decode on either.

`-metadata replaygain_*=` is shorthand for the six explicit clauses
(`replaygain_album_gain=`, `replaygain_album_peak=`, `replaygain_track_gain=`,
`replaygain_track_peak=`, `r128_album_gain=`, `r128_track_gain=`) that strip source
ReplayGain tags so the client can't double-apply gain.

### Sources

- Navidrome `consts/consts.go` — default transcoding profile seeds:
  https://github.com/navidrome/navidrome/blob/master/consts/consts.go
- Navidrome PR #5167 — AAC `-f adts` fix:
  https://github.com/navidrome/navidrome/pull/5167
- Gonic `transcode/transcode.go` — `UserProfiles` map (mp3, mp3_rg, opus, opus_rg,
  opus_car, etc.):
  https://github.com/sentriz/gonic/blob/master/transcode/transcode.go
- Ampache transcoding configuration:
  https://ampache.org/docs/configuration/transcoding
- Airsonic default profiles (`schema50.xml`):
  https://github.com/airsonic/airsonic/blob/master/airsonic-main/src/main/resources/liquibase/legacy/schema50.xml
- ExoPlayer / Media3 supported formats:
  https://developer.android.com/media/media3/exoplayer/supported-formats
- react-native-track-player issue #809 — Opus on iOS:
  https://github.com/doublesymmetry/react-native-track-player/issues/809

---

## Enabling advanced transcoding profiles

The `opus_rg`, `opus_car`, `mp3_rg`, and (proposed) `mp3_car` presets need
ffmpeg with `libopus` / `libmp3lame` (for the encoders) and `libsoxr` (for the
Car-mode `aresample=96000:resampler=soxr` filter step). **Every Subsonic
server Substreamer supports already ships an ffmpeg that has all three.** No
custom binary, no recompile, no Dockerfile patch. The only setup cost is
adding the transcoding profile in the server's admin UI under the exact
preset name (`opus_rg`, `opus_car`, `mp3_rg`, `mp3_car`) so that Substreamer's
`format=` query parameter matches.

`libfdk_aac` is a separate concern — it is the preferred AAC encoder on
Ampache and is missing from every mainstream distro package because the
licence is non-free. It is **never** required for the ReplayGain or Car-mode
presets.

### Compatibility matrix

| Server (official image) | Base | ffmpeg origin | libsoxr | libopus | libmp3lame | libvorbis | libfdk_aac |
|-------------------------|------|---------------|:-------:|:-------:|:----------:|:---------:|:----------:|
| Navidrome (`deluan/navidrome`) | alpine:3.20 | `apk add ffmpeg` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Gonic (`sentriz/gonic`) | alpine:3.22 | `apk add ffmpeg` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Ampache (`ampache/ampache`) | debian:stable | `apt-get install ffmpeg` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Airsonic-Advanced (`linuxserver/airsonic-advanced`) | alpine:3.21 | `apk add ffmpeg` | ✓ | ✓ | ✓ | ✓ | ✗ |
| Airsonic-Advanced (`airsonicadvanced/airsonic-advanced`) | ubuntu:jammy (eclipse-temurin) | `apt-get install ffmpeg` | ✓ | ✓ | ✓ | ✓ | ✗ |
| John Van Sickle static build | N/A | standalone binary | ✓ | ✓ | ✓ | ✓ | ✗ |
| BtbN FFmpeg-Builds (`nonfree`) | N/A | standalone binary | ✓ | ✓ | ✓ | ✓ | ✓ |

**Bottom line:** All four supported servers' official Docker images already
have everything needed for `opus_rg`, `opus_car`, `mp3_rg`, and `mp3_car`. The
only action required is creating the transcoding profile in the admin UI. The
static-binary recipes below are kept around as escape hatches for edge cases
(very old base images, custom builds, ffmpeg with `libfdk_aac`).

### Navidrome

**Status:** Everything works out of the box. The `deluan/navidrome` image is
built `FROM alpine:3.20` and installs ffmpeg via `apk add -U --no-cache
ffmpeg`. Alpine's `ffmpeg-libswresample` package has a hard runtime dependency
on `libsoxr.so.0`, and `ffmpeg-libavcodec` pulls in `libopus.so.0` and
`libmp3lame.so.0` — so a fresh `deluan/navidrome` container already has every
library the presets need.

Just add the transcoding profiles in the Navidrome admin UI (Settings →
Transcoding → New) using the ffmpeg commands from the
[Transcoding profiles](#transcoding-profiles) table above, and set the profile
`Name` to exactly `opus_rg`, `opus_car`, `mp3_rg`, or `mp3_car` — Substreamer
sends these strings as the `format=` parameter.

If you ever want to swap in a different ffmpeg build (e.g. to get
`libfdk_aac`), Navidrome supports
[`FFmpegPath`](https://www.navidrome.org/docs/usage/configuration/options/)
in `navidrome.toml`:

```toml
FFmpegPath = "/custom/ffmpeg"
```

### Gonic

**Status:** Everything works out of the box. `sentriz/gonic` is built `FROM
alpine:3.22` and installs ffmpeg via `apk add`, so the same libsoxr / libopus /
libmp3lame story as Navidrome. On top of that, Gonic already **ships**
`opus`, `opus_rg`, `opus_car`, and `mp3_rg` as built-in transcoding profiles
in [`transcode/transcode.go`](https://github.com/sentriz/gonic/blob/master/transcode/transcode.go) —
no admin action needed. The only preset that requires config is the proposed
`mp3_car`, which no server ships by default; Gonic users would need to either
wait for a Substreamer upstream PR or add a custom profile.

Gonic resolves the ffmpeg binary via `exec.LookPath("ffmpeg")`, so any
bind-mount that replaces `/usr/bin/ffmpeg` inside the container works.

### Ampache

**Status:** Everything needed for `*_rg` / `*_car` works out of the box. The
`ampache/ampache` image is `FROM debian:stable` and installs ffmpeg via
`apt-get install ffmpeg`. Debian's ffmpeg source package lists
`libsoxr-dev`, `libopus-dev`, `libmp3lame-dev`, and `libvorbis-dev` in its
Build-Depends, and the resulting binary is compiled with `--enable-libsoxr
--enable-libopus --enable-libmp3lame --enable-libvorbis`. `libfdk_aac` is
**not** in Debian main (it is DFSG non-free), so Ampache's long-standing AAC
footgun on Debian-based installs is still present — the admin must either
swap `libfdk_aac` for `aac` in Ampache's `config/ampache.cfg.php`
(`encode_args_m4a`) or bind-mount a non-free ffmpeg build (see below).

To add `opus_rg` / `opus_car` / `mp3_rg`, edit `ampache.cfg.php` and add new
transcode profiles keyed by the preset name, matching Ampache's
[transcoding configuration documentation](https://ampache.org/docs/configuration/transcoding).
Substreamer sends `format=opus_rg` etc., and Ampache will match that against
its `encode_args_*` / `transcode_cmd_*` entries.

### Airsonic / Airsonic-Advanced

**Status:** Everything works out of the box on both the `linuxserver/airsonic-
advanced` (Alpine 3.21) and official `airsonicadvanced/airsonic-advanced`
(Ubuntu Jammy via eclipse-temurin) images — same apt/apk sourcing, same
libsoxr / libopus / libmp3lame availability.

Airsonic looks for transcoder binaries in `$AIRSONIC_HOME/transcode/` first
and falls back to `$PATH` — see the
[Airsonic transcoding docs](https://airsonic.github.io/docs/transcode/). The
recommended pattern is to symlink the system ffmpeg into the transcode dir:

```bash
ln -s /usr/bin/ffmpeg /var/airsonic/transcode/ffmpeg
```

Add the new profiles in the Airsonic admin UI (Settings → Transcoding). Use
exactly the preset name (`opus_rg`, `opus_car`, `mp3_rg`, `mp3_car`) as the
profile `Name` so Substreamer's `format=` query parameter matches.

**Legacy original Airsonic** (the archived project, not Airsonic-Advanced)
is no longer maintained and its Docker image has not been rebuilt in years —
the bundled ffmpeg is whatever that ancient base image happened to ship. If
you're still running it, use a bind-mounted static binary (see Recipe 1
below).

### Recipe 1 — Drop-in static ffmpeg (escape hatch)

You should not need this for any supported server's official Docker image —
they all bundle a complete enough ffmpeg already (see the matrix above). Keep
this recipe for the edge cases: legacy original Airsonic, very old Alpine
base images, custom forks, or environments where the system ffmpeg is
unusable for some other reason. Download John Van Sickle's static ffmpeg
build (GPL v3, includes libsoxr, libopus, libmp3lame, libvorbis), bind-mount
it over the container's ffmpeg, and restart.

**1. Download and extract the static build on the Docker host.** The release
builds live at `https://johnvansickle.com/ffmpeg/releases/`:

```bash
# amd64 (most x86_64 servers, Intel NUCs, generic cloud VMs)
curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz

# arm64 (Raspberry Pi 4/5 64-bit, Apple Silicon, AWS Graviton)
curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz

# armhf (Raspberry Pi 3 32-bit)
curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz
```

Checksums are MD5-only and published alongside the tarballs at the same URL
with a `.md5` suffix; the project does not currently publish SHA-256
checksums. Verify with `md5sum -c ffmpeg-release-amd64-static.tar.xz.md5`.

```bash
tar -xJf ffmpeg-release-amd64-static.tar.xz
sudo mkdir -p /opt/ffmpeg-static
sudo cp ffmpeg-release-*-static/ffmpeg /opt/ffmpeg-static/ffmpeg
sudo chmod +x /opt/ffmpeg-static/ffmpeg
```

**2. Bind-mount it over the container's ffmpeg.** For a typical Alpine-based
container (Navidrome, Gonic, linuxserver/airsonic-advanced) the system
ffmpeg lives at `/usr/bin/ffmpeg`:

```yaml
# docker-compose.yml
services:
  navidrome:
    image: deluan/navidrome:latest
    volumes:
      - /opt/ffmpeg-static/ffmpeg:/usr/bin/ffmpeg:ro
      - ./data:/data
      - ./music:/music:ro
```

Or with plain `docker run`:

```bash
docker run -d --name navidrome \
  -v /opt/ffmpeg-static/ffmpeg:/usr/bin/ffmpeg:ro \
  -v /srv/navidrome:/data \
  -v /srv/music:/music:ro \
  -p 4533:4533 \
  deluan/navidrome:latest
```

**3. Restart and verify.**

```bash
docker compose up -d --force-recreate navidrome
docker exec navidrome /usr/bin/ffmpeg -version | grep -i -E 'soxr|enable-lib'
```

A successful build reports `--enable-libsoxr`, `--enable-libopus`,
`--enable-libmp3lame` in the `configuration:` line.

### Recipe 2 — Build a custom image

If you cannot bind-mount (e.g. running on a managed container platform that
forbids host volumes), extend the official image and install a newer ffmpeg
from the base distro's own package tree. On Alpine this is a one-liner — the
package already has everything except libfdk_aac:

```dockerfile
FROM deluan/navidrome:latest
# Alpine's ffmpeg already ships with libsoxr + libopus + libmp3lame.
# This Dockerfile is only useful if the base image's ffmpeg is outdated.
RUN apk add --no-cache --upgrade ffmpeg
```

On Debian/Ubuntu bases, the default Debian ffmpeg is also already built with
libsoxr + libopus + libmp3lame — you only need a custom image if you want
`libfdk_aac` for Ampache. The non-free recipe is to pull a static binary
from BtbN's non-free builds:

```dockerfile
FROM ampache/ampache:latest
ADD https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-nonfree.tar.xz /tmp/ffmpeg.tar.xz
RUN cd /tmp \
 && tar -xJf ffmpeg.tar.xz \
 && install -m 0755 ffmpeg-master-latest-linux64-nonfree/bin/ffmpeg /usr/bin/ffmpeg \
 && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-master-latest-linux64-nonfree
```

The `linuxserver/ffmpeg` image is another pre-built option that includes
`--enable-libsoxr --enable-libopus --enable-libmp3lame --enable-libfdk_aac`
and can be used via a multi-stage `COPY --from=lscr.io/linuxserver/ffmpeg`,
but the Linuxserver image is primarily designed to be run as an ephemeral
one-shot transcoder, and its binary has its own shared-library dependencies
that may not be satisfied by a different base — prefer John Van Sickle's
static build or BtbN's nonfree static build for drop-in use.

### Recipe 3 — Compile ffmpeg from source

Only needed if neither a distro package nor a pre-built static binary suits
you (e.g. exotic architecture, corporate policy against unsigned binaries).
The minimum `./configure` invocation for all Substreamer presets is:

```bash
# Build-time dependencies on Debian/Ubuntu
sudo apt-get install -y \
  build-essential pkg-config yasm nasm \
  libsoxr-dev libopus-dev libmp3lame-dev libvorbis-dev

# Build-time dependencies on Alpine
apk add --no-cache \
  build-base pkgconfig yasm nasm \
  soxr-dev opus-dev lame-dev libvorbis-dev

# Download and compile (use a recent tagged release, not master)
curl -LO https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz
tar -xJf ffmpeg-7.0.2.tar.xz
cd ffmpeg-7.0.2

./configure \
  --prefix=/opt/ffmpeg \
  --enable-gpl \
  --enable-version3 \
  --enable-libsoxr \
  --enable-libopus \
  --enable-libmp3lame \
  --enable-libvorbis \
  --disable-debug \
  --disable-doc \
  --disable-ffplay
make -j"$(nproc)"
sudo make install
```

To additionally get `libfdk_aac` (non-free), add `libfdk-aac-dev` (Debian) /
`fdk-aac-dev` (Alpine) to the build deps and append `--enable-libfdk_aac
--enable-nonfree` to the configure line. **Licence note:** a binary built
with `--enable-nonfree` **cannot be redistributed** under any licence — it
is legal for personal use on the machine it was built on only.

### Verification

After any of the three recipes, verify the new binary from inside the
container:

```bash
# Confirm the binary was swapped in
docker exec <container> /usr/bin/ffmpeg -version

# Confirm libsoxr is present in the build
docker exec <container> /usr/bin/ffmpeg -version | grep -i enable-libsoxr

# Confirm the aresample filter is registered (it always is, but a
# missing filter list means the binary is badly linked)
docker exec <container> /usr/bin/ffmpeg -hide_banner -filters | grep aresample

# End-to-end: request a car-mode stream from the server and check the
# response headers. Substreamer sends format=opus_car; the server should
# return 200 OK with Content-Type: audio/ogg (or audio/mpeg for mp3_car).
curl -I 'https://music.example.com/rest/stream?u=USER&p=PASS&v=1.16.1&c=substreamer&id=<track-id>&format=opus_car'
```

The final and most reliable test is to play a track through Substreamer
with the new preset selected in Settings → Audio Quality and confirm
(a) playback starts within a second or two, (b) the volume matches a
ReplayGain-normalised level, and (c) for `*_car` the perceived loudness is
noticeably higher than `*_rg`.

### Open questions

- **BtbN FFmpeg-Builds arm64 / armhf availability.** BtbN's project publishes
  Linux amd64 builds prominently; arm64 builds exist in the release artifacts
  but coverage is less consistent. Raspberry Pi users should prefer John Van
  Sickle's builds, which have first-class arm64 and armhf support.
- **Alpine 3.18 and older.** The dependency walk above was verified for
  Alpine 3.20 / 3.21 / 3.22 — the versions used by current Navidrome, Gonic,
  and linuxserver images. Older Alpine versions have not been re-verified;
  users pinning to `alpine:3.18` or earlier should run
  `ffmpeg -version | grep enable` inside the container to confirm libsoxr
  is present.
- **SHA-256 checksums for static builds.** John Van Sickle's site publishes
  MD5-only checksums as of this writing; there is no SHA-256 verification
  path short of running one on the downloaded tarball yourself and pinning
  the value in your own infrastructure.
- **Ampache `libfdk_aac` workaround.** The Ampache documentation notes that
  `libfdk_aac` is the preferred AAC encoder but does not provide an
  installation script that handles the non-free licence cleanly. The
  in-repo docs also do not document a supported fallback to ffmpeg's native
  `aac` encoder — users report success editing `config/ampache.cfg.php`
  manually to swap `libfdk_aac` → `aac`, but the behaviour may change
  between Ampache versions.
- **Actual `ffmpeg -version` output per distro.** The claims in the
  compatibility matrix are derived from each distro's package Build-Depends
  and runtime shared-library dependencies, not from observed
  `ffmpeg -version` output. A full empirical run (`docker run --rm
  deluan/navidrome ffmpeg -version`) per image would give definitive
  confirmation and is the fastest way to resolve any remaining doubt.
