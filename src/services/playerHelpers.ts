/**
 * Stateless helpers for playerService. None of these touch the module's
 * own state machine; they only read from external stores and services.
 * Extracted so the main service can stay focused on its event handlers.
 */

import { type PlayerState, type RepeatMode, type TrackItem } from 'react-native-queue-player';

import i18n from '../i18n/i18n';
import { type EffectiveFormat } from '../types/audio';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { imageCacheDiagnosticsStore } from '../store/imageCacheDiagnosticsStore';
import { playbackSettingsStore, type RepeatModeSetting } from '../store/playbackSettingsStore';
import { type PlaybackStatus } from '../store/playerStore';
import { resolveEffectiveFormat } from '../utils/effectiveFormat';
import { resolveSongCoverArt } from '../hooks/useSongCoverArt';
import { resolveCachedImageUri } from './imageCacheService';
import { logImageCache } from './imageCacheLogger';
import { getLocalTrackUri } from './musicCacheService';
import { getCoverArtUrl, getStreamUrl, isRadioChild, type Child } from './subsonicService';

/** Map our RepeatModeSetting to RNQP's RepeatMode string union. */
export function mapRepeatMode(mode: RepeatModeSetting): RepeatMode {
  switch (mode) {
    case 'all':
      return 'queue';
    case 'one':
      return 'track';
    default:
      return 'off';
  }
}

/** Map RNQP PlayerState to our simplified PlaybackStatus. */
export function mapState(state: PlayerState): PlaybackStatus {
  switch (state) {
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'buffering':
      return 'buffering';
    case 'loading':
      return 'loading';
    case 'ended':
    case 'error':
      return 'stopped';
    default:
      // 'none'
      return 'idle';
  }
}

/**
 * Build an EffectiveFormat stamp for a track being added to the queue.
 * If the track has a downloaded copy with a persisted format, use that;
 * otherwise resolve from the current streaming settings.
 */
export function stampQueueFormat(child: Child): EffectiveFormat {
  const downloadedSong = musicCacheStore.getState().cachedSongs[child.id];
  if (downloadedSong) {
    return {
      suffix: downloadedSong.suffix.toLowerCase(),
      bitRate: downloadedSong.bitRate,
      bitDepth: downloadedSong.bitDepth,
      samplingRate: downloadedSong.samplingRate,
      capturedAt: downloadedSong.formatCapturedAt,
    };
  }

  const { streamFormat, maxBitRate } = playbackSettingsStore.getState();
  return resolveEffectiveFormat({
    sourceSuffix: child.suffix,
    sourceBitRate: child.bitRate,
    sourceBitDepth: child.bitDepth,
    sourceSamplingRate: child.samplingRate,
    formatSetting: streamFormat,
    bitRateSetting: maxBitRate,
  });
}

/** Monotonic counter so two stations built in the same millisecond still get
 *  distinct live-stream URLs. */
let liveStreamCounter = 0;

/**
 * Stamp a live stream URL with a one-shot fragment so it can never be served
 * from the player's on-disk cache.
 *
 * RNQP wraps every remote read in a Media3 `CacheDataSource` keyed on the
 * track URL (`LookaheadCache.wrapDataSourceFactory`, applied to the player's
 * own `MediaSource.Factory`, not just the prefetcher). Media3 only bypasses
 * that cache for unknown-length responses when
 * `FLAG_IGNORE_CACHE_FOR_UNSET_LENGTH_REQUESTS` is set, which RNQP does not
 * set — so a live stream is written to disk while it plays and replayed from
 * those bytes the next time the same URL is opened. The user hears audio from
 * the previous listen instead of the live edge.
 *
 * A fragment is never sent to the server (RFC 3986 §3.5 — `DefaultHttpDataSource`
 * / `URLSession` request only path + query), so the stream request is
 * byte-for-byte the same; only the cache key changes.
 */
export function liveStreamUrl(streamUrl: string): string {
  liveStreamCounter += 1;
  const base = streamUrl.split('#')[0];
  return `${base}#live-${Date.now().toString(36)}-${liveStreamCounter}`;
}

/**
 * Convert a Child (Subsonic song) to an RNQP TrackItem.
 *
 * Returns `null` when the track can't be played right now:
 * - Offline mode + no local cached file → never hand the player a server
 *   stream URL (it would stall waiting on an unreachable server).
 * - No local URI AND stream-URL construction failed (e.g. auth not yet
 *   initialised) — an empty URL would stall the same way, so filter here.
 *
 * Callers must filter nulls out of the resulting array and treat an
 * all-null queue as "nothing playable" (toast + clearQueue).
 */
export function childToTrack(
  child: Child,
  cachedArt?: string | null,
): TrackItem | null {
  // Internet radio: the stream URL lives on the Child itself (no server
  // stream URL, no local file). Live streams are online-only.
  if (isRadioChild(child)) {
    if (offlineModeStore.getState().offlineMode) return null;
    return {
      id: child.id,
      url: liveStreamUrl(child.radioStreamUrl),
      title: child.title,
      artist: child.artist ?? i18n.t('unknownArtist'),
      // Station favicon as lock-screen artwork; the player falls back to its
      // default artwork when the URL 404s.
      artworkUrl: child.radioLogoUrl,
      duration: 0,
    };
  }

  const localUri = getLocalTrackUri(child.id);
  const offline = offlineModeStore.getState().offlineMode;
  if (!localUri && offline) return null;

  const url = localUri ?? getStreamUrl(child.id);
  if (!url) return null;

  // Diagnostic: a song the cache store reports as downloaded resolving to a
  // server stream URL means the in-memory track map missed it. Logged (gated).
  if (!localUri
    && imageCacheDiagnosticsStore.getState().enabled
    && musicCacheStore.getState().cachedSongs[child.id]) {
    logImageCache(`player stream-url-for-cached-song id=${child.id}`);
  }

  // Cover-art lookup resolves the song's `coverArt` value (album mode: the
  // parent album's coverArt so every track in an album shares one cached file;
  // per-track mode: the song's own) — see src/utils/coverArtId.ts. (#202)
  const coverArtId = resolveSongCoverArt(child);
  // In offline mode drop any server-only artwork so the lock-screen artwork
  // fetch can't hit the network either. (`getCoverArtUrl` also returns null
  // under offline mode; this is belt-and-braces.)
  const artworkUrl = cachedArt
    ?? (offline || !coverArtId ? undefined : getCoverArtUrl(coverArtId, 600) ?? undefined);

  return {
    id: child.id,
    url,
    title: child.title,
    artist: child.artist ?? i18n.t('unknownArtist'),
    album: child.album ?? undefined,
    artworkUrl,
    duration: child.duration ?? 0,
  };
}

/**
 * Build (RNQP tracks, filtered child queue) from a Child queue, dropping
 * entries that aren't currently playable. Preserves source order so callers
 * can translate desired indices onto the filtered queue by looking up the
 * original Child.
 */
export async function buildPlayableQueue(queue: readonly Child[]): Promise<{
  rnTracks: TrackItem[];
  filteredQueue: Child[];
}> {
  // Resolve local cover artwork up front (async, DB-authoritative — off the JS
  // thread), deduped by album coverArtId so a 500-track album resolves one URI,
  // not 500. Then build the tracks synchronously from the resolved map.
  const ids = Array.from(
    new Set(queue.map((c) => resolveSongCoverArt(c)).filter((v): v is string => !!v)),
  );
  const artEntries = await Promise.all(
    ids.map(async (id) => [id, await resolveCachedImageUri(id, 600)] as const),
  );
  const artMap = new Map<string, string | null>(artEntries);

  const rnTracks: TrackItem[] = [];
  const filteredQueue: Child[] = [];
  for (const child of queue) {
    const coverArtId = resolveSongCoverArt(child);
    const track = childToTrack(child, (coverArtId ? artMap.get(coverArtId) : null) ?? null);
    if (track) {
      rnTracks.push(track);
      filteredQueue.push(child);
    }
  }
  return { rnTracks, filteredQueue };
}
