---
globs: src/services/**/*.ts
---

# Service Layer Patterns

## Architecture

Services are plain TypeScript modules exporting async functions – no classes, no singletons. Each service file focuses on one domain.

## Subsonic API (`subsonicService.ts`)

- Uses `subsonic-api` library with two auth modes: MD5 token auth (`t`+`s` params, default) and legacy plaintext auth (`p` param with `enc:` hex encoding, for servers like Nextcloud Music and Ampache that reject token auth). Controlled by `legacyAuth` flag in `authStore`.
- `getApi()` returns a cached `SubsonicAPI` instance, invalidated when server/user/legacyAuth changes.
- Auth credentials for cover art and stream URLs are cached separately via `ensureCoverArtAuth()`. The `applyUrlAuth()` helper centralizes auth param application for all URL builders.
- All API functions check `isLoggedIn` and return `null` on failure rather than throwing.
- Types re-exported from `subsonic-api`: `AlbumID3`, `ArtistID3`, `Child`, `Playlist`, etc.

```typescript
// Pattern for API functions
export async function getAlbum(albumId: string): Promise<AlbumWithSongsID3 | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const response = await api.getAlbum({ id: albumId });
    return response.album ?? null;
  } catch {
    return null;
  }
}
```

- `getCoverArtUrl(coverArtId, size?)` and `getStreamUrl(trackId)` build authenticated URLs synchronously.
- Stream URLs include playback settings from `playbackSettingsStore` (maxBitRate, format, estimateContentLength).

## Player Service (`playerService.ts`)

- Wraps `react-native-track-player` (RNTP).
- `initPlayer()` sets up RNTP, registers event listeners, starts progress polling.
- `childToTrack()` converts Subsonic `Child` to RNTP `Track` objects.
- Updates `playerStore` from RNTP events (`PlaybackState`, `PlaybackActiveTrackChanged`).
- Progress polling at 250ms intervals when playing, synced with `AppState`.

## Playback Service (`playbackService.ts`)

- Headless RNTP service for remote/lock-screen events.
- Registered in `index.js` via `TrackPlayer.registerPlaybackService()`.
- Uses CommonJS `module.exports` (required by RNTP).

## Image Cache (`imageCacheService.ts`)

- Disk cache under `Paths.document/image-cache/` using `expo-file-system`.
- Standard sizes: 50, 150, 300, 600.
- `getCachedImageUri()` is synchronous (file existence check).
- `cacheAllSizes()` downloads all sizes in parallel with deduplication via a `downloading` Set.
- Uses `expo/fetch` for image downloads.

## MusicBrainz Service (`musicbrainzService.ts`)

- Direct `fetch` calls with `User-Agent` header.
- Rate limiting with delay between requests.
- Returns `null` on any failure (best-effort enrichment).

## Scan Service (`scanService.ts`)

- Manages server-side library scanning (start scan, poll status).
- Polls the server at intervals for scan progress, auto-stopping when complete.
- Supports Navidrome full-scan option.
- Updates `scanStatusStore` with scanning state, count, and timestamps.

## Scrobble Service (`scrobbleService.ts`)

- Sends "now playing" notifications and completed playback scrobbles to the Subsonic server.
- Maintains a persisted pending-scrobble queue (`pendingScrobbleStore`) with retry logic.
- Processes the queue periodically, moving successful entries to `completedScrobbleStore`.

## SSL Trust Service (`sslTrustService.ts`)

- Syncs trusted SSL certificate fingerprints between `sslCertStore` and native trust stores.
- Bridges to platform-specific trust managers (Android TrustManager / iOS URLProtocol).
- Allows users to accept self-signed or custom certificates per hostname.

## Migration Service (`migrationService.ts`)

- Defines and runs versioned data migration tasks sequentially on app launch.
- Tracks completed migration versions via `migrationStore`.
- Handles schema changes and legacy data cleanup across app updates.

## Connectivity Service (`connectivityService.ts`)

- Monitors network reachability and server availability.
- `startMonitoring()` / `stopMonitoring()` lifecycle tied to login state and offline mode.
- Updates `connectivityStore` with reachability state.

## Music Cache Service (`musicCacheService.ts`) — v2 (per-row + cross-item dedup)

- Manages on-disk cache of downloaded music files for offline playback.
- `initMusicCache()` ensures cache directories exist at launch; module-scope AppState listener triggers `recoverStalledDownloadsAsync` on resume.
- `deferredMusicCacheInit()` (post-first-render) populates in-memory `trackUriMap` / `trackToItems` from SQL and runs `reconcileMusicCacheAsync()` to heal FS↔SQL drift.
- `getMusicCacheStats()` returns total size and file count for the settings UI (filesystem walk).
- Handles download queue processing for album, playlist, favorites (virtual playlist `'__starred__'`), **and single-song** downloads (`enqueueSongDownload(song)`).

**Architecture (v2):**
- **Cross-item deduplication.** A song is stored once on disk regardless of how many items (album, playlist, favorites, single-song) reference it. When `downloadSong` sees an existing `cached_songs` row, it just inserts a new edge in `cached_item_songs` and skips the network transfer entirely.
- **Album-rooted disk layout:** `{Paths.document}/music-cache/albums/{albumId}/{songId}.{suffix}`. Every song has a parent album (Subsonic `Child.albumId`); `_unknown` sentinel for the rare case it's missing. Keeps any single directory bounded to one album's worth of files.
- **Persistence:** four SQLite tables in `src/store/persistence/musicCacheTables.ts` — `cached_songs` (canonical song pool), `cached_items` (album/playlist/favorites/song intents), `cached_item_songs` (many-to-many edges), `download_queue`. FK `ON DELETE CASCADE` from items to edges. Refcount of a song = `COUNT(*) FROM cached_item_songs WHERE song_id = ?` — never stored, never drifts.
- **Partial albums:** a `cached_items` row with `type='album'` can exist even when `songIds.length < expected_song_count` — this is what cross-item song downloads look like. UI in `music-cache-browser.tsx` differentiates partial vs complete and surfaces a dedicated "Song downloads" section.
- **In-memory mirrors** (`trackUriMap: Map<songId, fileUri>`, `trackToItems: Map<songId, Set<itemId>>`) rebuilt from SQL at startup, not from filesystem walk. `trackMapsReady` flag guards favorites-subscription during init.
- **Preserved v1 robustness:** queue recovery on resume, retry-on-null, `.tmp` atomicity (download to `.tmp`, `move` to final on success), startup `.tmp` cleanup, item-level resumption, parallel `maxConcurrentDownloads` workers, real-time `downloadSpeedTracker`, storage-limit-aware pause/resume, AppState listener.

**Format info lives on the song row, not a separate map.** The v1 `downloadedFormats` record is gone; `cached_songs.{suffix,bitRate,bitDepth,samplingRate,formatCapturedAt}` replace it. `effectiveFormat.ts` reads directly from `cachedSongs[id]`.

**Store action contract** (see `src/store/musicCacheStore.ts`): all mutations write-through to `musicCacheTables` before updating in-memory state. `removeCachedItem(itemId)` returns `string[]` of now-orphan songIds so the service can delete files. `removeCachedItemSong(itemId, position)` returns `{ orphanedSongId: string | null }`.

## Storage Service (`storageService.ts`)

- Checks device storage against configured limits.
- `checkStorageLimit()` runs at launch and updates `storageLimitStore`.

## More Options Service (`moreOptionsService.ts`)

- Orchestrates actions triggered from the more-options bottom sheet (e.g. add to playlist, share, delete).
- Bridges between `moreOptionsStore` and the relevant stores/services for each action.

## Backup Service (`backupService.ts`)

- Creates, lists, restores, and prunes compressed backups of scrobble history and MBID overrides.
- Backup files are gzip-compressed via `expo-gzip` and stored in `Paths.document/backups/`.
- Each backup produces a `.meta.json` manifest plus `.scrobbles.gz` and/or `.mbid.gz` data files.
- `runAutoBackupIfNeeded()` runs on launch — creates a backup if auto-backup is enabled and >24h since the last one, then prunes to keep the 5 most recent.
- Cleans up orphaned `.tmp` files and data files missing their manifest on startup.

## Download Speed Tracker (`downloadSpeedTracker.ts`)

- Tracks real-time aggregate download speed across all concurrent music downloads.
- Listens to native progress events from `expo-async-fs` via a global listener registered at module import.
- Uses a 10-second rolling window of byte deltas for smoothed speed calculation.
- Exports `getDownloadSpeed()` (bytes/sec), `getActiveDownloadCount()`, `beginDownload(id)`, and `clearDownload(id)`.

## Server Capability Service (`serverCapabilityService.ts`)

- Detects and gates features based on server type and Subsonic API version.
- `KNOWN_SERVERS` maps OpenSubsonic server types (navidrome, gonic, nextcloud music, ampache) to explicit capability sets.
- `API_VERSION_CAPABILITIES` maps classic Subsonic API versions to capabilities as a fallback.
- `supports(capability)` checks whether the connected server supports a given feature.
- Current capabilities: `shares`, `scan`, `fullScan`, `albumArtistRating`, `internetRadioCrud`.
- UI code gates feature visibility via `supports()` — e.g. shares menu, scan buttons, rating options.

## Search Service (`searchService.ts`)

- Implements search across albums, artists, and songs via `search3` API.
- Builds track cover art maps from multiple stores for offline search capability.
- Coordinates with `searchStore` for state management.

## Auto-Offline Service (`autoOfflineService.ts`)

- Manages automatic offline mode toggling based on network state and WiFi detection.
- Monitors network changes to detect home vs. away WiFi.
- Pairs with `autoOfflineStore` for configuration persistence.

## Battery Optimization Service (`batteryOptimizationService.ts`)

- Manages Android battery optimization exemption requests.
- Pairs with `batteryOptimizationStore` for status tracking.
- No-op on iOS.

## Tuned In Service (`tunedInService.ts`)

- "Tuned In" music discovery and mix generation.
- Time-of-day based mix generation (early morning, morning, midday, etc.).
- Multi-genre blending strategies using random songs, similar songs, and genre filtering.

## Export Scoping

Only export functions and types that are consumed by other modules. Keep internal helpers, intermediate types, and implementation details module-private:

- **Export:** API functions called from stores/screens, shared type aliases re-exported from `subsonic-api`.
- **Do not export:** Internal types like `LoginResult`, `ScanStatusResult`, `CachedFileEntry`, `MigrationTask`, `StarrableType` that are only used within their own service file.

## Error Handling

- Login returns a discriminated union: `{ success: true; version: string } | { success: false; error: string }`.
- Data-fetching functions return `null` on failure rather than throwing.
- Image caching and player sync swallow errors (best-effort).
- Stores surface errors via `error` state field for UI display.
- When swallowing errors in `.catch()`, always add a short comment explaining why:

```typescript
.catch(() => { /* non-critical: disk cache miss is handled by fallback */ });
```

## Adding New API Endpoints

When adding a new Subsonic API call:

1. Add the function to `subsonicService.ts`.
2. Use `getApi()` to get the client, return `null` if not available.
3. Wrap in try/catch, return `null` on failure.
4. Re-export any new types from `subsonic-api` that are needed by consumers. Keep internal types private.
5. Consume from a Zustand store or directly in a screen.
