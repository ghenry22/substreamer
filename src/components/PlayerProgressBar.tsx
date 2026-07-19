/**
 * PlayerProgressBar – seekable progress bar for the full player view.
 *
 * Displays a horizontal track with a filled portion, a draggable thumb,
 * and elapsed / remaining time labels below.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { type ThemeColors } from '../constants/theme';
import { isRadioId } from '../services/subsonicService';
import { radioNowPlayingStore } from '../store/radioNowPlayingStore';
import { playerStore } from '../store/playerStore';
import { formatTrackDuration } from '../utils/formatters';

const TRACK_HEIGHT = 4;
const TRACK_HIT_SLOP = 14;
const THUMB_SIZE = 14;
const ACTIVE_THUMB_SIZE = 18;

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val));

export interface PlayerProgressBarProps {
  /** Current playback position in seconds. */
  position: number;
  /** Total duration of the current track in seconds. */
  duration: number;
  /** Absolute buffered edge from the start of the track, in seconds. */
  bufferedPosition?: number;
  /** Theme colors. */
  colors: ThemeColors;
  /** Called when the user finishes seeking (finger released). */
  onSeek: (seconds: number) => void;
  /** Whether the player is currently buffering. */
  isBuffering?: boolean;
  /** Playback error message to display, or null when healthy. */
  error?: string | null;
  /** Whether the player is currently auto-retrying after an error. */
  retrying?: boolean;
  /** Called when the user taps the manual retry button. */
  onRetry?: () => void;
}

export function PlayerProgressBar({
  position,
  duration,
  bufferedPosition = 0,
  colors,
  onSeek,
  isBuffering = false,
  error = null,
  retrying = false,
  onRetry,
}: PlayerProgressBarProps) {
  const { t } = useTranslation();
  // Live radio: every full-player surface renders this bar for the CURRENT
  // track only, so the store lookup is safe here and saves threading a `live`
  // prop through five player layouts. Live streams have no timeline — swap the
  // seek bar for a LIVE indicator + ICY now-playing title.
  const live = playerStore((s) => (s.currentTrack ? isRadioId(s.currentTrack.id) : false));
  const nowPlaying = radioNowPlayingStore((s) => s.title);
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFraction, setDragFraction] = useState(0);
  const [pendingSeekFraction, setPendingSeekFraction] = useState<number | null>(
    null,
  );
  const thumbScale = useSharedValue(1);

  const thumbAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: thumbScale.value }],
  }));

  const dragFractionRef = useRef(dragFraction);
  dragFractionRef.current = dragFraction;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  /** Convert an absolute screen pageX to a 0–1 fraction across the track. */
  const fractionFromPageX = (pageX: number) =>
    clamp((pageX - trackPageX.current) / (trackWidth.current || 1), 0, 1);

  const handleTapSeek = useCallback((absoluteX: number) => {
    const frac = fractionFromPageX(absoluteX);
    setPendingSeekFraction(frac);
    onSeekRef.current(frac * durationRef.current);
  }, []);

  const handlePanStart = useCallback((absoluteX: number) => {
    const frac = fractionFromPageX(absoluteX);
    setDragFraction(frac);
    setIsDragging(true);
    setPendingSeekFraction(null);
  }, []);

  const handlePanUpdate = useCallback((absoluteX: number) => {
    setDragFraction(fractionFromPageX(absoluteX));
  }, []);

  const handlePanEnd = useCallback(() => {
    const seekPos = dragFractionRef.current * durationRef.current;
    setPendingSeekFraction(dragFractionRef.current);
    setIsDragging(false);
    onSeekRef.current(seekPos);
  }, []);

  const handlePanCancel = useCallback(() => {
    setIsDragging(false);
  }, []);

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      'worklet';
      runOnJS(handleTapSeek)(e.absoluteX);
    });

  const panGesture = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-10, 10])
    .onStart((e) => {
      'worklet';
      thumbScale.value = withSpring(ACTIVE_THUMB_SIZE / THUMB_SIZE);
      runOnJS(handlePanStart)(e.absoluteX);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(handlePanUpdate)(e.absoluteX);
    })
    .onEnd(() => {
      'worklet';
      thumbScale.value = withSpring(1);
      runOnJS(handlePanEnd)();
    })
    .onFinalize((_, success) => {
      'worklet';
      if (!success) {
        thumbScale.value = withSpring(1);
        runOnJS(handlePanCancel)();
      }
    });

  const seekGesture = Gesture.Race(panGesture, tapGesture);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      trackWidth.current = e.nativeEvent.layout.width;
      trackRef.current?.measureInWindow((x) => {
        if (x != null) trackPageX.current = x;
      });
    },
    [],
  );

  // Clear the pending seek fraction once the store position catches up.
  useEffect(() => {
    if (pendingSeekFraction != null && duration > 0) {
      const seekPos = pendingSeekFraction * duration;
      if (Math.abs(position - seekPos) < 2) {
        setPendingSeekFraction(null);
      }
    }
  }, [position, duration, pendingSeekFraction]);

  // Fallback timeout: if the seek didn't take effect (e.g. the native player
  // silently ignored it because the target was beyond the buffer), clear the
  // pending state after 1 s so the progress bar resumes normal updates.
  useEffect(() => {
    if (pendingSeekFraction != null) {
      const timer = setTimeout(() => {
        setPendingSeekFraction(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [pendingSeekFraction]);

  const fraction = isDragging
    ? dragFraction
    : pendingSeekFraction != null
      ? pendingSeekFraction
      : duration > 0
        ? clamp(position / duration, 0, 1)
        : 0;

  const bufferedFraction =
    duration > 0 ? clamp(bufferedPosition / duration, 0, 1) : 0;

  const displayPosition = isDragging
    ? dragFraction * duration
    : pendingSeekFraction != null
      ? pendingSeekFraction * duration
      : position;
  const remaining = Math.max(0, duration - displayPosition);

  if (live) {
    return (
      <View style={styles.container}>
        <View style={styles.liveRow}>
          <View style={[styles.livePill, { backgroundColor: colors.red + '22' }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.red }]} />
            <Text style={[styles.liveText, { color: colors.red }]}>{t('liveStream')}</Text>
          </View>
          {error != null && !retrying ? (
            <View style={styles.centerStatus}>
              <Text
                style={[styles.statusLabel, { color: colors.red }]}
                numberOfLines={1}
              >
                {error}
              </Text>
              {onRetry != null && (
                <Pressable
                  onPress={onRetry}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.retryButton,
                    { borderColor: colors.red },
                    pressed && styles.retryPressed,
                  ]}
                >
                  <Text style={[styles.retryText, { color: colors.red }]}>
                    {t('retry')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : retrying ? (
            <Text style={[styles.statusLabel, { color: colors.red }]}>
              {t('reconnecting')}
            </Text>
          ) : (
            <Text
              style={[styles.liveTitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {isBuffering ? t('buffering') : nowPlaying ?? ''}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Track + thumb */}
      <GestureDetector gesture={seekGesture}>
        <View
          ref={trackRef}
          style={[styles.trackHitArea, { paddingVertical: TRACK_HIT_SLOP }]}
          onLayout={handleLayout}
        >
          <View
            style={[styles.track, { backgroundColor: colors.border }]}
            pointerEvents="none"
          >
            {/* Buffered range (behind played fill) */}
            <View
              style={[
                styles.bufferedFill,
                {
                  width: `${bufferedFraction * 100}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
            {/* Played range */}
            <View
              style={[
                styles.fill,
                { width: `${fraction * 100}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          {/* Thumb */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                backgroundColor: colors.textPrimary,
                left: `${fraction * 100}%`,
              },
              thumbAnimStyle,
            ]}
          />
        </View>
      </GestureDetector>
      {/* Time labels */}
      <View style={styles.times}>
        <Text style={[styles.timeText, { color: colors.textSecondary }]}>
          {formatTrackDuration(displayPosition)}
        </Text>
        {error != null && !retrying ? (
          <View style={styles.centerStatus}>
            <Text
              style={[styles.statusLabel, { color: colors.red }]}
              numberOfLines={1}
            >
              {error}
            </Text>
            {onRetry != null && (
              <Pressable
                onPress={onRetry}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.retryButton,
                  { borderColor: colors.red },
                  pressed && styles.retryPressed,
                ]}
              >
                <Text style={[styles.retryText, { color: colors.red }]}>
                  {t('retry')}
                </Text>
              </Pressable>
            )}
          </View>
        ) : retrying ? (
          <Text style={[styles.statusLabel, { color: colors.red }]}>
            Retrying…
          </Text>
        ) : (
          <Text
            style={[
              styles.statusLabel,
              { color: colors.textSecondary, opacity: isBuffering ? 1 : 0 },
            ]}
          >
            {t('buffering')}
          </Text>
        )}
        <Text style={[styles.timeText, { color: colors.textSecondary }]}>
          {formatTrackDuration(remaining)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  trackHitArea: {
    width: '100%',
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  bufferedFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    opacity: 0.25,
    borderRadius: TRACK_HEIGHT / 2,
  },
  fill: {
    height: '100%',
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    marginLeft: -(THUMB_SIZE / 2),
    top: TRACK_HIT_SLOP - THUMB_SIZE / 2 + TRACK_HEIGHT / 2,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  centerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  statusLabel: {
    fontSize: 12,
    flexShrink: 1,
  },
  retryButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  retryPressed: {
    opacity: 0.6,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Match the seek bar's footprint (track hit area + time labels) closely
    // enough that swapping modes doesn't shift the surrounding layout.
    minHeight: TRACK_HEIGHT + 2 * TRACK_HIT_SLOP + 20,
    gap: 10,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  liveTitle: {
    flex: 1,
    fontSize: 13,
  },
});
