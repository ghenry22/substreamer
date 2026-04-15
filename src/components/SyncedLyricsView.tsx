import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

import { LyricsInterludeRow } from './LyricsInterludeRow';
import { LyricsLineRow } from './LyricsLineRow';
import { seekTo } from '../services/playerService';
import { type LyricsLine } from '../services/subsonicService';
import { playerStore } from '../store/playerStore';
import { impactAsync, ImpactFeedbackStyle } from '../utils/haptics';

interface SyncedLyricsViewProps {
  lines: LyricsLine[];
  offsetMs: number;
  /** 'fake' disables tap-to-seek since timings are synthesized, not real. */
  source: 'structured' | 'fake';
  textColor: string;
  backgroundColor: string;
}

const EDGE_FADE_HEIGHT = 64;
const USER_SCROLL_LOCKOUT_MS = 3000;
const ACTIVE_LINE_VIEWPORT_RATIO = 0.4;
const INTERLUDE_MIN_GAP_MS = 5000;

/**
 * Apple-Music-style synced lyrics view.
 *
 * Subscribes imperatively to `playerStore` (to avoid the 250ms re-render tick),
 * pushes timing into shared values, binary-searches for the active line on the
 * UI thread, and auto-scrolls via `useAnimatedReaction`. User scroll suspends
 * auto-scroll for 3s after the last interaction.
 */
export const SyncedLyricsView = memo(function SyncedLyricsView({
  lines,
  offsetMs,
  source,
  textColor,
  backgroundColor,
}: SyncedLyricsViewProps) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [viewportH, setViewportH] = useState(0);

  // Timing driver — imperative subscribe, not a hook-based selector.
  const currentMs = useSharedValue(0);
  const sampledAt = useSharedValue(Date.now());
  const isPlayingSV = useSharedValue(false);

  useEffect(() => {
    const apply = () => {
      const s = playerStore.getState();
      currentMs.value = s.position * 1000;
      sampledAt.value = Date.now();
      isPlayingSV.value = s.playbackState === 'playing';
    };
    apply();
    return playerStore.subscribe(apply);
  }, [currentMs, sampledAt, isPlayingSV]);

  // Pre-compute line start times (applying offset). Re-runs only when lines change.
  const lineStartsSV = useSharedValue<number[]>([]);
  useEffect(() => {
    lineStartsSV.value = lines.map((l) => l.startMs + offsetMs);
  }, [lines, offsetMs, lineStartsSV]);

  // Per-line y-offset collected via onLayout, for auto-scroll targeting.
  const lineOffsetsSV = useSharedValue<number[]>([]);
  // Reset offsets when the set of lines changes.
  useEffect(() => {
    lineOffsetsSV.value = new Array(lines.length).fill(0);
  }, [lines.length, lineOffsetsSV]);

  const handleLineLayout = useCallback(
    (index: number, y: number, _h: number) => {
      // Mutate a copy so Reanimated detects the change.
      const next = lineOffsetsSV.value.slice();
      next[index] = y;
      lineOffsetsSV.value = next;
    },
    [lineOffsetsSV],
  );

  // Extrapolated position in ms, accounting for time since the last sample
  // while playback is running so the active line stays in lockstep with audio.
  const extrapolatedMs = useDerivedValue(() => {
    if (!isPlayingSV.value) return currentMs.value;
    return currentMs.value + (Date.now() - sampledAt.value);
  });

  // Binary-search the largest index where lineStartsSV[i] <= extrapolatedMs.
  // Returns −1 when before the first line.
  const activeIndex = useDerivedValue(() => {
    const starts = lineStartsSV.value;
    const now = extrapolatedMs.value;
    if (starts.length === 0 || now < starts[0]) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (starts[mid] <= now) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  });

  // User-scroll suspension.
  const userScrolling = useSharedValue(false);
  const userScrollEndAt = useSharedValue(0);

  const handleScrollBeginDrag = useCallback(() => {
    userScrolling.value = true;
  }, [userScrolling]);

  const handleScrollEndDrag = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>) => {
      userScrolling.value = false;
      userScrollEndAt.value = Date.now();
    },
    [userScrolling, userScrollEndAt],
  );

  const handleMomentumScrollEnd = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>) => {
      userScrolling.value = false;
      userScrollEndAt.value = Date.now();
    },
    [userScrolling, userScrollEndAt],
  );

  // Auto-scroll when activeIndex advances, suppressed during + 3s after user drag.
  useAnimatedReaction(
    () => ({
      i: activeIndex.value,
      scrolling: userScrolling.value,
      endedAt: userScrollEndAt.value,
      h: viewportH,
    }),
    (curr, prev) => {
      if (prev && curr.i === prev.i) return;
      if (curr.i < 0) return;
      if (curr.scrolling) return;
      if (Date.now() - curr.endedAt < USER_SCROLL_LOCKOUT_MS) return;
      const offsets = lineOffsetsSV.value;
      const target = offsets[curr.i];
      if (target == null) return;
      const y = Math.max(0, target - curr.h * ACTIVE_LINE_VIEWPORT_RATIO);
      scrollTo(scrollRef, 0, y, true);
    },
    [viewportH],
  );

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportH(e.nativeEvent.layout.height);
  }, []);

  const handleLinePress = useCallback(
    (index: number) => {
      const starts = lineStartsSV.value;
      const ms = starts[index];
      if (ms == null) return;
      impactAsync(ImpactFeedbackStyle.Light);
      seekTo(ms / 1000);
    },
    [lineStartsSV],
  );

  // Spacers keep the first line reachable at the active position and the last
  // line scrollable up to the active position.
  const topSpacer = Math.max(0, viewportH * ACTIVE_LINE_VIEWPORT_RATIO);
  const bottomSpacer = Math.max(0, viewportH * (1 - ACTIVE_LINE_VIEWPORT_RATIO));

  const gradientColors = useMemo<[string, string]>(
    () => [backgroundColor, `${backgroundColor}00`],
    [backgroundColor],
  );
  const gradientColorsReversed = useMemo<[string, string]>(
    () => [`${backgroundColor}00`, backgroundColor],
    [backgroundColor],
  );

  const tapDisabled = source === 'fake';

  // Precompute per-pair gap info so interlude rows can be inlined between
  // lines only where the gap actually warrants one.
  const lineMeta = useMemo(
    () => lines.map((l) => l.startMs + offsetMs),
    [lines, offsetMs],
  );

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
      >
        <View style={{ height: topSpacer }} />
        {lines.map((line, i) => {
          const fromMs = lineMeta[i];
          const toMs = lineMeta[i + 1];
          const showInterlude = toMs != null && toMs - fromMs > INTERLUDE_MIN_GAP_MS;
          return (
            <View key={i}>
              <LyricsLineRow
                index={i}
                text={line.text}
                activeIndex={activeIndex}
                textColor={textColor}
                disabled={tapDisabled}
                onPress={handleLinePress}
                onLayout={handleLineLayout}
              />
              {showInterlude && (
                <LyricsInterludeRow
                  pairIndex={i}
                  activeIndex={activeIndex}
                  fromMs={fromMs}
                  toMs={toMs}
                  extrapolatedMs={extrapolatedMs}
                  textColor={textColor}
                />
              )}
            </View>
          );
        })}
        <View style={{ height: bottomSpacer }} />
      </Animated.ScrollView>

      <LinearGradient
        colors={gradientColors}
        style={[styles.topFade, { height: EDGE_FADE_HEIGHT }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={gradientColorsReversed}
        style={[styles.bottomFade, { height: EDGE_FADE_HEIGHT }]}
        pointerEvents="none"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
