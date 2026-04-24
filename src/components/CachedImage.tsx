/**
 * Drop-in replacement for `<Image>` that loads cover art from the
 * local disk cache when available, and falls back to the remote
 * Subsonic URL on a cache miss (triggering a background download of
 * all size variants for next time).
 *
 * Design invariants:
 *
 *   - The branded WaveformLogo placeholder is ALWAYS rendered as the
 *     base layer. Anything drawn on top (the actual image, whether
 *     cached or remote) just covers it once it paints. If the image
 *     fails to decode or is missing, the placeholder remains visible —
 *     we never reach a "blank square" state.
 *   - A cached `file://` URI is rendered at full opacity on the first
 *     frame, with no onLoad gate and no fade-in. If the decode fails
 *     (corrupt file), onError falls through to retry/placeholder paths.
 *   - A remote URL is rendered underneath a brief 300ms crossfade so
 *     the placeholder dissolves smoothly into the downloaded art.
 *   - Offline + cache miss shows the placeholder. No network attempts.
 *
 * Recovery on decode error:
 *   - Online: delete the broken local variant, retry once after a
 *     2.5s backoff with a cache-buster so RN doesn't dedupe the prop.
 *     Second failure leaves the placeholder visible.
 *   - Offline: drop the URI so the placeholder shows; preserve the
 *     file on disk since the error may be transient.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Image as RNImage,
  type ImageProps,
  type ImageStyle,
  type LayoutChangeEvent,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import WaveformLogo from './WaveformLogo';
import {
  cacheAllSizes,
  deleteCachedVariant,
  getCachedImageUri,
} from '../services/imageCacheService';
import { STARRED_COVER_ART_ID } from '../services/musicCacheService';
import { getCoverArtUrl, VARIOUS_ARTISTS_COVER_ART_ID } from '../services/subsonicService';
import { offlineModeStore } from '../store/offlineModeStore';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Delay before starting a remote download (avoids fetches during fast scrolls). */
const DEBOUNCE_MS = 150;
/** Duration of the placeholder-to-image crossfade for remote URLs. */
const FADE_DURATION_MS = 300;
/** Backoff before retrying a failed image load once (covers server cold-start). */
const RETRY_BACKOFF_MS = 2500;
/** Min size for the placeholder logo (dp). */
const MIN_LOGO_SIZE = 16;
/** Max size for the placeholder logo (dp). */
const MAX_LOGO_SIZE = 80;
/** Logo size as a fraction of the image's smaller dimension. */
const LOGO_SCALE = 0.4;
/** Default colour for the placeholder waveform bars. */
const PLACEHOLDER_COLOR = 'rgba(150,150,150,0.25)';

/** Resolved URI for the bundled starred-songs cover art. */
const STARRED_COVER_URI = RNImage.resolveAssetSource(
  require('../assets/starred-cover.jpg'),
).uri;

/** Resolved URI for the bundled Various Artists cover art. */
const VARIOUS_ARTISTS_COVER_URI = RNImage.resolveAssetSource(
  require('../assets/various-artists-cover.jpg'),
).uri;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CachedImageProps extends Omit<ImageProps, 'source'> {
  /** Subsonic cover art ID (e.g. `album.coverArt`). */
  coverArtId: string | undefined;
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

/** Compute the WaveformLogo size from image dimensions. */
function computeLogoSize(w: number | undefined, h: number | undefined): number {
  const smaller = Math.min(w ?? 56, h ?? 56);
  return Math.min(MAX_LOGO_SIZE, Math.max(MIN_LOGO_SIZE, smaller * LOGO_SCALE));
}

/** True when the URI is a local cache file (trusted, render at full opacity). */
function isCachedFileUri(uri: string | undefined): boolean {
  return uri != null && uri.startsWith('file://');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const CachedImage = memo(function CachedImage({
  coverArtId: rawCoverArtId,
  size,
  fallbackUri: rawFallbackUri,
  style,
  placeholderColor,
  ...imageProps
}: CachedImageProps) {
  /* ---- resolve sentinel cover art IDs to bundled assets ---- */
  const isSentinel =
    rawCoverArtId === STARRED_COVER_ART_ID ||
    rawCoverArtId === VARIOUS_ARTISTS_COVER_ART_ID;

  const coverArtId = isSentinel ? undefined : rawCoverArtId;
  const fallbackUri = isSentinel
    ? rawCoverArtId === STARRED_COVER_ART_ID
      ? STARRED_COVER_URI
      : VARIOUS_ARTISTS_COVER_URI
    : rawFallbackUri;

  /* ---- reload nonce forces derivation to re-run after an error ----- */
  const [reloadNonce, setReloadNonce] = useState(0);

  /* ---- remote-URL fallback state (set after the debounced fetch) -- */
  const [remoteUri, setRemoteUri] = useState<string | undefined>(undefined);

  /* ---- error suppress: after a decode error, hide the Image layer
          until recovery (retry success, coverArtId/size change) so the
          placeholder shows through and we don't immediately re-attempt
          rendering the same broken source. */
  const [errorSuppress, setErrorSuppress] = useState(false);

  /* ---- derive the URI to render on EVERY render -------------------- */
  // Cache lookup is synchronous and uses the `uriCache` Map inside the
  // image service. Re-reading on every render means a file that was
  // deleted by reconcile/purge/cleanup below is immediately reflected —
  // we don't pin a stale URI across session-boundary cleanups.
  const cachedUri = coverArtId ? getCachedImageUri(coverArtId, size) : null;
  const resolvedUri = errorSuppress
    ? undefined
    : cachedUri ?? remoteUri ?? (!coverArtId ? fallbackUri : undefined);
  const trustedInstant = isCachedFileUri(cachedUri ?? undefined) || (!coverArtId && !!fallbackUri);

  /* ---- refs for the one-shot error retry --------------------------- */
  const currentIdRef = useRef(coverArtId);
  const retriedRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- fade-in shared value (remote URLs only) --------------------- */
  // Initial opacity: 1 for trusted instant URIs (cached files + bundled
  // fallbacks), 0 for remote URLs that should fade in on onLoad.
  const fadeAnim = useSharedValue(trustedInstant ? 1 : 0);

  /* ---- reset fade state when coverArtId/size change ---------------- */
  useEffect(() => {
    currentIdRef.current = coverArtId;
    retriedRef.current = false;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    // Clear any stale remote URL and error-suppression from a previous
    // coverArtId so a new mount starts fresh.
    setRemoteUri(undefined);
    setErrorSuppress(false);
    // Reset the animation. Trusted instant URIs (cache hit or bundled
    // fallback) jump straight to 1; everything else fades in on onLoad.
    cancelAnimation(fadeAnim);
    const cachedOnMount = coverArtId ? getCachedImageUri(coverArtId, size) : null;
    const instantReady = isCachedFileUri(cachedOnMount ?? undefined) || (!coverArtId && !!fallbackUri);
    fadeAnim.value = instantReady ? 1 : 0;
    // NOTE: reloadNonce is deliberately NOT in this dep array. Nonce
    // bumps are for forcing a re-render to re-derive cachedUri after
    // retry recovery; they must not clear the retry's remoteUri.
  }, [coverArtId, size, fallbackUri, fadeAnim]);

  /* ---- debounced remote fetch for cache misses --------------------- */
  useEffect(() => {
    if (!coverArtId) return;
    if (cachedUri) return;
    if (offlineModeStore.getState().offlineMode) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || currentIdRef.current !== coverArtId) return;

      const remoteUrl = getCoverArtUrl(coverArtId, size) ?? fallbackUri;
      if (remoteUrl) setRemoteUri(remoteUrl);

      cacheAllSizes(coverArtId).catch(() => {
        /* cache failure is non-critical; placeholder or remote URL stays */
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coverArtId, size, fallbackUri, cachedUri, reloadNonce]);

  /* ---- clear pending retry on unmount ------------------------------ */
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  /* ---- fade-in on successful load (remote URLs only) --------------- */
  const handleImageLoad = useCallback(() => {
    retriedRef.current = false;
    // Trusted instant URIs already have fadeAnim.value = 1; a second
    // withTiming(1) from 1 is effectively instant. For remote URLs
    // this runs the 300ms crossfade.
    if (fadeAnim.value < 1) {
      fadeAnim.value = withTiming(1, { duration: FADE_DURATION_MS });
    }
  }, [fadeAnim]);

  /* ---- recovery on decode failure ---------------------------------- */
  const handleImageError = useCallback(() => {
    if (!coverArtId) return;
    const failedUri = resolvedUri;
    const offline = offlineModeStore.getState().offlineMode;

    // Common reset: fade to 0 and suppress the Image layer so the
    // placeholder underneath is visible.
    cancelAnimation(fadeAnim);
    fadeAnim.value = 0;
    setErrorSuppress(true);

    if (offline) {
      // Preserve the file on disk — errors may be transient. Drop any
      // remote URL too; the placeholder stays visible for this mount.
      setRemoteUri(undefined);
      return;
    }

    // Online: if the failed URI was the local cache, the file is
    // broken — delete it so the next download writes a fresh copy.
    // Remote failures leave the file alone.
    if (failedUri?.startsWith('file://')) {
      deleteCachedVariant(coverArtId, size);
    }

    if (retriedRef.current) {
      // Second failure — surface placeholder and stop.
      setRemoteUri(undefined);
      return;
    }
    retriedRef.current = true;

    // Schedule a single retry with a cache-buster so RN re-fetches
    // even when the underlying URL is identical.
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      if (currentIdRef.current !== coverArtId) return;

      // Lift error suppression regardless of outcome so the retry can
      // actually paint.
      setErrorSuppress(false);

      // Force a fresh remote round-trip with a cache-buster so RN
      // doesn't dedupe the source prop when the underlying URL would
      // otherwise match a just-failed one. The debounced-fetch effect
      // runs concurrently; this is the authoritative retry URI.
      const remoteUrl = getCoverArtUrl(coverArtId, size);
      if (remoteUrl) setRemoteUri(`${remoteUrl}&_r=${Date.now()}`);

      // Always re-queue cacheAllSizes — if the server now serves the
      // cover, the next render picks up the fresh cached URI.
      cacheAllSizes(coverArtId)
        .then(() => {
          if (currentIdRef.current !== coverArtId) return;
          setReloadNonce((n) => n + 1);
        })
        .catch(() => { /* retry exhausted — placeholder stays visible */ });
    }, RETRY_BACKOFF_MS);
  }, [coverArtId, size, resolvedUri, fadeAnim]);

  /* ---- measure actual rendered size for placeholder logo ---------- */
  const [layoutSize, setLayoutSize] = useState<{ w: number; h: number } | null>(null);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayoutSize((prev) => {
      if (prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1) return prev;
      return { w: width, h: height };
    });
  }, []);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  /* ---- derive logo size from measured layout (or style fallback) -- */
  const flatStyle = StyleSheet.flatten(style) as (ImageStyle & ViewStyle) | undefined;
  const logoSize = computeLogoSize(
    layoutSize?.w ?? (typeof flatStyle?.width === 'number' ? flatStyle.width : undefined),
    layoutSize?.h ?? (typeof flatStyle?.height === 'number' ? flatStyle.height : undefined),
  );

  return (
    <View style={[style as ViewStyle, styles.container]} onLayout={handleLayout}>
      {/* Placeholder is ALWAYS in the tree. Any Image drawn on top
          covers it; if the Image is absent, broken or still fading in,
          the placeholder shows through. This is the invariant that
          prevents "blank square" states. */}
      <View style={styles.placeholder} pointerEvents="none">
        <WaveformLogo
          size={logoSize}
          color={placeholderColor ?? PLACEHOLDER_COLOR}
        />
      </View>
      {resolvedUri != null && (
        <Animated.Image
          {...imageProps}
          source={{ uri: resolvedUri }}
          style={[StyleSheet.absoluteFill, fadeStyle]}
          onLoad={handleImageLoad}
          onError={handleImageError}
          // We do our own crossfade via fadeStyle. Disabling Fresco's
          // built-in fade shrinks the window in which a recycled view
          // can deliver a decode-success callback to a released
          // CloseableReference (the IllegalStateException trigger in
          // PipelineDraweeController on Android).
          fadeDuration={0}
        />
      )}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
