/**
 * Drop-in replacement for `<Image>` that loads cover art from the
 * local disk cache when available, and falls back to the remote
 * Subsonic URL on a cache miss (triggering a background download
 * of all size variants for next time).
 *
 * Shows a branded WaveformLogo placeholder while loading, with a
 * smooth crossfade animation when the image becomes available.
 * Debounces remote fetches to avoid unnecessary downloads during
 * fast scrolling in FlashList.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import WaveformLogo from './WaveformLogo';
import {
  cacheAllSizes,
  evictUriCacheEntry,
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
/** Duration of the placeholder-to-image crossfade. */
const FADE_DURATION_MS = 300;
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

  /* ---- initial synchronous cache check ---- */
  const initialCached = coverArtId ? getCachedImageUri(coverArtId, size) : null;
  const hasInitialImage = !!initialCached || (!coverArtId && !!fallbackUri);

  const [uri, setUri] = useState<string | undefined>(
    initialCached ?? (!coverArtId ? fallbackUri : undefined),
  );
  const [showPlaceholder, setShowPlaceholder] = useState(!hasInitialImage);

  const fadeAnim = useSharedValue(hasInitialImage ? 1 : 0);
  const currentIdRef = useRef(coverArtId);
  const retriedRef = useRef(false);

  /* ---- measure actual rendered size for placeholder logo ---- */
  const [layoutSize, setLayoutSize] = useState<{ w: number; h: number } | null>(null);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayoutSize((prev) => {
      if (prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1) return prev;
      return { w: width, h: height };
    });
  }, []);

  /* ---- synchronous reset when props change (prevents stale images) ---- */
  useLayoutEffect(() => {
    currentIdRef.current = coverArtId;
    retriedRef.current = false;
    const cached = coverArtId ? getCachedImageUri(coverArtId, size) : null;

    if (cached) {
      setUri(cached);
      cancelAnimation(fadeAnim);
      fadeAnim.value = 1;
      setShowPlaceholder(false);
      return;
    }

    if (!coverArtId) {
      setUri(fallbackUri);
      cancelAnimation(fadeAnim);
      fadeAnim.value = fallbackUri ? 1 : 0;
      setShowPlaceholder(!fallbackUri);
      return;
    }

    cancelAnimation(fadeAnim);
    fadeAnim.value = 0;
    setShowPlaceholder(true);
    setUri(undefined);
  }, [coverArtId, size, fallbackUri, fadeAnim]);

  /* ---- debounced remote fetch for cache misses ---- */
  useEffect(() => {
    if (!coverArtId) return;

    const cached = getCachedImageUri(coverArtId, size);
    if (cached) return;

    if (offlineModeStore.getState().offlineMode) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled || currentIdRef.current !== coverArtId) return;

      const remoteUrl = getCoverArtUrl(coverArtId, size) ?? fallbackUri;
      if (remoteUrl) setUri(remoteUrl);

      cacheAllSizes(coverArtId)
        .then(() => {
          if (cancelled || currentIdRef.current !== coverArtId) return;
          const newCached = getCachedImageUri(coverArtId, size);
          if (newCached) setUri(newCached);
        })
        .catch(() => { /* non-critical: disk cache miss is handled by fallback */ });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coverArtId, size, fallbackUri]);

  /* ---- fade-in animation on image load ---- */
  const handleImageLoad = useCallback(() => {
    fadeAnim.value = withTiming(1, { duration: FADE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(setShowPlaceholder)(false);
    });
  }, [fadeAnim]);

  /* ---- recovery when a cached file is deleted externally ---- */
  const handleImageError = useCallback(() => {
    if (!coverArtId || retriedRef.current) return;
    retriedRef.current = true;

    evictUriCacheEntry(coverArtId, size);

    const freshCached = getCachedImageUri(coverArtId, size);
    if (freshCached) {
      setUri(freshCached);
      return;
    }

    if (offlineModeStore.getState().offlineMode) return;

    const remoteUrl = getCoverArtUrl(coverArtId, size);
    if (remoteUrl) setUri(remoteUrl);

    cacheAllSizes(coverArtId)
      .then(() => {
        if (currentIdRef.current !== coverArtId) return;
        const newCached = getCachedImageUri(coverArtId, size);
        if (newCached) setUri(newCached);
      })
      .catch(() => {});
  }, [coverArtId, size]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  /* ---- derive logo size from measured layout (or style fallback) ---- */
  const flatStyle = StyleSheet.flatten(style) as (ImageStyle & ViewStyle) | undefined;
  const logoSize = computeLogoSize(
    layoutSize?.w ?? (typeof flatStyle?.width === 'number' ? flatStyle.width : undefined),
    layoutSize?.h ?? (typeof flatStyle?.height === 'number' ? flatStyle.height : undefined),
  );

  return (
    <View style={[style as ViewStyle, styles.container]} onLayout={handleLayout}>
      {showPlaceholder && (
        <View style={styles.placeholder}>
          <WaveformLogo
            size={logoSize}
            color={placeholderColor ?? PLACEHOLDER_COLOR}
          />
        </View>
      )}
      {uri != null && showPlaceholder && (
        <Animated.Image
          {...imageProps}
          source={{ uri }}
          style={[StyleSheet.absoluteFill, fadeStyle]}
          onLoad={handleImageLoad}
          onError={handleImageError}
          // We do our own crossfade via fadeStyle. Disabling Fresco's built-in
          // fade shrinks the window in which a recycled view can deliver a
          // decode-success callback to a released CloseableReference, which is
          // the trigger for the IllegalStateException in PipelineDraweeController.
          fadeDuration={0}
        />
      )}
      {uri != null && !showPlaceholder && (
        <RNImage
          {...imageProps}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          onError={handleImageError}
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
