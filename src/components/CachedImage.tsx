/**
 * Cover-art image with three render states:
 *
 *   LOCAL       — a cached file exists on disk → render it.
 *   REMOTE      — no cached file, online, the service hasn't flagged this
 *                 id's server URL as failed → render the server URL AND
 *                 ask the service to cache it in parallel. When the cache
 *                 download lands, the cache-update subscription forces a
 *                 re-render and we switch to LOCAL.
 *   PLACEHOLDER — anything else (offline + no cache, remote-failed, no
 *                 coverArtId, both URI sources errored on this mount).
 *                 The branded WaveformLogo placeholder is ALWAYS in the
 *                 tree underneath; the Image layer just covers it once
 *                 it paints. We never render a blank square.
 *
 * Decode errors flow back to the service:
 *   - A cached file that fails to decode → `reportBadCache(id, size)` →
 *     service deletes the variant + re-enqueues a download. On this
 *     mount we set a `localErroredRef` so we don't immediately try the
 *     same broken URI again; next render falls through to REMOTE.
 *   - A remote URL that fails → `reportBadRemote(id)` → service adds id
 *     to `failedRemoteIds` and notifies subscribers. Every CachedImage
 *     instance for the id stays on PLACEHOLDER until a fresh file lands.
 *
 * The service owns: download queue, dedup, timed retry, persistent
 * recovery (offline → online, AppState 'active'). The component only
 * renders and reports — no retry tower, no debounce, no scheduling.
 */

import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Image as RNImage,
  type ImageProps,
  type ImageStyle,
  type LayoutChangeEvent,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import WaveformLogo from './WaveformLogo';
import {
  ensureCached,
  isRemoteFailed,
  reportBadCache,
  reportBadRemote,
  resolveDisplayImage,
  subscribeImageCacheUpdate,
} from '../services/imageCacheService';
import { logImageCache } from '../services/imageCacheLogger';
import { STARRED_COVER_ART_ID } from '../services/musicCacheService';
import { VARIOUS_ARTISTS_COVER_ART_ID } from '../services/subsonicService';
import { layoutPreferencesStore } from '../store/layoutPreferencesStore';
import { offlineModeStore } from '../store/offlineModeStore';

import { absoluteFill } from '../utils/styles';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Min size for the placeholder logo (dp). */
const MIN_LOGO_SIZE = 16;
/** Max size for the placeholder logo (dp). */
const MAX_LOGO_SIZE = 80;
/** Logo size as a fraction of the image's smaller dimension. */
const LOGO_SCALE = 0.4;
/** Default colour for the placeholder waveform bars. */
const PLACEHOLDER_COLOR = 'rgba(150,150,150,0.25)';

/** RN `resizeMode` → expo-image `contentFit`. Covers are square-filled ('cover'). */
const RESIZE_MODE_TO_CONTENT_FIT: Record<string, 'cover' | 'contain' | 'fill' | 'none'> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  center: 'none',
};

/** Resolved URI for the bundled starred-songs cover art. */
const STARRED_COVER_URI = RNImage.resolveAssetSource(
  require('../assets/starred-cover.jpg'),
)?.uri;

/** Resolved URI for the bundled Various Artists cover art. */
const VARIOUS_ARTISTS_COVER_URI = RNImage.resolveAssetSource(
  require('../assets/various-artists-cover.jpg'),
)?.uri;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CachedImageProps extends Omit<ImageProps, 'source'> {
  /** Subsonic cover art ID (e.g. `album.coverArt`); for a song, the song's own `coverArt`. */
  coverArtId: string | undefined;
  /** A song's `albumId`, so album cover mode shows its album's cover. Omit for albums, artists
   *  and playlists, whose own `coverArt` is the cover. */
  albumId?: string | null;
  /** Requested image size tier (50 | 150 | 300 | 600). */
  size: number;
  /** Optional fallback URI when coverArtId is missing or URL construction fails. */
  fallbackUri?: string;
  /** Optional colour for the placeholder waveform bars. */
  placeholderColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function computeLogoSize(w: number | undefined, h: number | undefined): number {
  const smaller = Math.min(w ?? 56, h ?? 56);
  return Math.min(MAX_LOGO_SIZE, Math.max(MIN_LOGO_SIZE, smaller * LOGO_SCALE));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const CachedImage = memo(function CachedImage({
  coverArtId: rawCoverArtId,
  albumId,
  size,
  fallbackUri: rawFallbackUri,
  style,
  placeholderColor,
  resizeMode,
}: CachedImageProps) {
  // Sentinel cover ids resolve to bundled assets — the cache service
  // never sees them. Map the id to `undefined` so the rest of the
  // component never tries to cache or report on them.
  const isSentinel =
    rawCoverArtId === STARRED_COVER_ART_ID ||
    rawCoverArtId === VARIOUS_ARTISTS_COVER_ART_ID;
  const coverArtId = isSentinel ? undefined : rawCoverArtId;
  const fallbackUri = isSentinel
    ? rawCoverArtId === STARRED_COVER_ART_ID
      ? STARRED_COVER_URI
      : VARIOUS_ARTISTS_COVER_URI
    : rawFallbackUri;

  // Re-resolve token. Bumped by the cache-update subscription (a fresh on-disk
  // variant OR a failedRemoteIds flip) and by onError, to re-run the async
  // cover-art resolution below.
  const [resolveToken, bumpResolve] = useReducer((x: number) => x + 1, 0);

  // Resolved display target, filled asynchronously via the shared resolver
  // (`resolveDisplayImage` — the single source of truth also used by the CarPlay
  // browse service): a `file://` cache hit (`isRemote:false`) or the server URL
  // (`isRemote:true`), or null while resolving / placeholder. NO synchronous
  // FS/SQLite on render.
  const [resolved, setResolved] = useState<{ uri: string; isRemote: boolean } | null>(null);
  // A song's cover token is only known once resolved (album mode → its album's). Everything
  // keyed on the token during render reads `token`; an entity's token is its own id.
  const [resolvedToken, setResolvedToken] = useState<string | undefined>(undefined);
  const token = albumId ? resolvedToken : coverArtId;
  const songCoverArtMode = layoutPreferencesStore((s) => s.songCoverArtMode);

  // Per-mount flag: "I already tried the local URI and it failed." Reset on a
  // cache-update or an id/size change (fresh attempt).
  const localErroredRef = useRef(false);
  // Keyed on the SUBJECT (id + album), never the resolved token: a recycled cell given a new
  // song must drop the old token at once, not when the new one resolves.
  const subjectKey = `${coverArtId ?? ''}|${albumId ?? ''}|${size}`;
  const currentKeyRef = useRef(subjectKey);
  if (currentKeyRef.current !== subjectKey) {
    currentKeyRef.current = subjectKey;
    localErroredRef.current = false;
    // Reset synchronously (React's "adjust state during render" pattern) so a
    // recycled FlashList cell never shows the previous cover while the new one
    // resolves.
    setResolved(null);
    setResolvedToken(undefined);
  }

  const remoteFailed = token ? isRemoteFailed(token) : false;
  const offline = offlineModeStore((s) => s.offlineMode);

  // Resolve the display target asynchronously via the shared resolver (file://
  // cache first, then the server URL — gated on offline + the remote-failed
  // set). On a genuine cache miss, ask the service to cache it; the subscription
  // below re-resolves when it lands. `offline` is a dep so an offline flip
  // re-resolves; `resolveToken` covers the remote-failed flip + onError retry.
  useEffect(() => {
    if (!coverArtId) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    resolveDisplayImage({ coverArt: coverArtId, albumId }, size, {
      offline,
      skipCache: localErroredRef.current,
    })
      .then((r) => {
        if (cancelled) return;
        const shown = r.uri ? { uri: r.uri, isRemote: r.isRemote } : null;
        setResolvedToken(r.coverArtId);
        setResolved(shown);
        // Cache miss (no local file) → fetch it; NOT when we deliberately
        // skipped a bad cached file (it exists; reportBadCache handled it).
        if (r.coverArtId && !localErroredRef.current && (shown == null || shown.isRemote)) {
          ensureCached(r.coverArtId);
        }
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
    // `songCoverArtMode` re-resolves a song's token when the cover mode changes.
  }, [coverArtId, albumId, size, resolveToken, offline, songCoverArtMode]);

  // What to render: the shared resolver already picked LOCAL vs REMOTE (gated on
  // offline + the remote-failed set); fall back to the bundled placeholder URI.
  let renderUri: string | undefined = resolved?.uri;
  const isRemote = resolved?.isRemote ?? false;
  if (!renderUri && fallbackUri) renderUri = fallbackUri;

  // Subscribe — fires on file landed OR remote-failed flag flipped.
  useEffect(() => {
    if (!token) return;
    return subscribeImageCacheUpdate(token, () => {
      localErroredRef.current = false;
      bumpResolve();
    });
  }, [token]);

  // Error handler — three branches, no retry tower.
  const onError = useCallback(() => {
    if (!token) return;
    const hadCached = resolved != null && !resolved.isRemote; // was showing a file:// cache hit
    if (hadCached) {
      localErroredRef.current = true;
      void reportBadCache(token, size);
    } else if (resolved?.isRemote) {
      void reportBadRemote(token);
    }
    bumpResolve();
  }, [token, size, resolved]);

  // Layout measurement for placeholder logo sizing.
  const [layoutSize, setLayoutSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayoutSize((prev) => {
      if (prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1) return prev;
      return { w: width, h: height };
    });
  }, []);

  // One log line per state transition. Kept minimal so user logs are
  // scannable; the service has its own logs for downloads/retries.
  useEffect(() => {
    if (!coverArtId) {
      // No usable id AND no bundled fallback → a genuine missing-id
      // placeholder: the parent handed us an entity with no id. This is the
      // otherwise-silent stuck case (every other branch is gated on a truthy
      // id), so log it to make recurrence diagnosable. Sentinels render a
      // bundled fallbackUri and are intentionally skipped.
      if (!fallbackUri) {
        logImageCache(`CachedImage placeholder id-missing size=${size}`);
      }
      return;
    }
    const where = resolved && !resolved.isRemote
      ? 'local'
      : isRemote
        ? 'remote'
        : 'placeholder';
    logImageCache(
      `CachedImage state id=${token ?? coverArtId} size=${size} ${where} remoteFailed=${remoteFailed}`,
    );
  }, [coverArtId, token, size, resolved, isRemote, remoteFailed, fallbackUri]);

  const flatStyle = StyleSheet.flatten(style) as (ImageStyle & ViewStyle) | undefined;
  const contentFit = RESIZE_MODE_TO_CONTENT_FIT[resizeMode ?? 'cover'] ?? 'cover';
  const logoSize = computeLogoSize(
    layoutSize?.w ?? (typeof flatStyle?.width === 'number' ? flatStyle.width : undefined),
    layoutSize?.h ?? (typeof flatStyle?.height === 'number' ? flatStyle.height : undefined),
  );

  return (
    <View style={[style as ViewStyle, styles.container]} onLayout={onLayout}>
      <View style={styles.placeholder} pointerEvents="none">
        <WaveformLogo
          size={logoSize}
          color={placeholderColor ?? PLACEHOLDER_COLOR}
        />
      </View>
      {renderUri && (
        <ExpoImage
          source={{ uri: renderUri }}
          style={StyleSheet.absoluteFill as ImageStyle}
          contentFit={contentFit}
          onError={onError}
          // Glide (Android) / SDWebImage (iOS), NOT Fresco — sidesteps the
          // PipelineDraweeController recycle/re-attach crashes. Both fetch via
          // our trusted OkHttp / URLSession, so self-signed servers still load.
          transition={0}
          // id+size for FlashList recycling; resolveToken forces a reload when
          // reportBadCache re-downloads the same file:// path (expo-image has
          // no per-key memory eviction).
          recyclingKey={`${token ?? rawCoverArtId}:${size}:${resolveToken}`}
          // We own resize (pre-sized variants) + disk cache (imageCacheService),
          // so expo-image retains nothing.
          cachePolicy="none"
          allowDownscaling={false}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    ...absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
