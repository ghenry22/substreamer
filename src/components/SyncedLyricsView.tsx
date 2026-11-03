import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSharedValue } from 'react-native-reanimated';

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
  /** Background for the floating "Re-sync" pill that appears when the user
   *  has scrolled away from the active line. */
  pillBackgroundColor: string;
}

const USER_SCROLL_LOCKOUT_MS = 3000;
const INTERLUDE_MIN_GAP_MS = 5000;
/** Spacer height so the first/last line can land at the active-slot
 *  position even at song start/end. */
const SPACER_HEIGHT = 400;
/** Vertical position of the active line within the viewport, measured from
 *  the top (0 = top, 1 = bottom). 0.35 keeps the active line in the upper
 *  third so the user sees plenty of upcoming lyrics below — matches Apple
 *  Music's layout. */
const ACTIVE_LINE_VIEWPORT_RATIO = 0.35;

/**
 * Apple-Music-style synced lyrics view.
 *
 * Keep-it-simple architecture:
 *
 *   1. Subscribe to `playerStore` — position updates naturally at 250 ms
 *      (rate of `PlaybackProgressUpdated` polling in `playerService`).
 *   2. On every update, binary-search the active line index and set React
 *      state. A shared-value mirror feeds the per-line worklet opacity.
 *   3. When the active index changes, ask React Native where that line's
 *      <View> is *relative to the ScrollView* via `measureLayout`, then
 *      scroll so the line's vertical centre sits at the viewport centre.
 *
 * No Reanimated worklet-thread scroll. No rAF polling. No per-line offset
 * table. The native measurement does the geometry for us.
 *
 * Uses a regular `ScrollView` + `useRef` because Reanimated 4's
 * `useAnimatedRef` on `Animated.ScrollView` keeps `.current` null, making
 * its `scrollTo` a silent no-op (software-mansion/react-native-reanimated#8240).
 */
export const SyncedLyricsView = memo(function SyncedLyricsView({
  lines,
  offsetMs,
  source,
  textColor,
  pillBackgroundColor,
}: SyncedLyricsViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const lineRefs = useRef<(ViewInstance | null)[]>([]);

  // Foreground/background gate. This is a background-audio app, so the JS
  // thread keeps running while backgrounded and the native player keeps
  // emitting progress events — but the rAF extrapolation loop and any scroll
  // work must suspend so we don't drive Reanimated commits + ScrollView
  // geometry off-screen. That sustained off-screen work is what the OS
  // watchdog terminates the app for (the reported "crash when backgrounded
  // with lyrics open").
  const appActiveRef = useRef(AppState.currentState === 'active');

  // Active line: React state drives the scroll effect; shared value feeds
  // the per-line opacity/scale worklets in LyricsLineRow.
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexSV = useSharedValue(-1);

  // Precompute start times (applying offset).
  const lineStarts = useMemo(
    () => lines.map((l) => l.startMs + offsetMs),
    [lines, offsetMs],
  );

  // Derive activeIndex from playerStore. The store ticks at ~250 ms via
  // `PlaybackProgressUpdated`, which is ample precision for a line-level
  // scroll — sub-line timing is carried by the per-line worklet animation.
  useEffect(() => {
    const compute = () => {
      const ms = playerStore.getState().position * 1000;
      let idx = -1;
      if (lineStarts.length > 0 && ms >= lineStarts[0]) {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (lineStarts[mid] <= ms) lo = mid;
          else hi = mid - 1;
        }
        idx = lo;
      }
      setActiveIndex((prev) => (prev === idx ? prev : idx));
    };
    compute();
    return playerStore.subscribe(compute);
  }, [lineStarts]);

  // Mirror activeIndex into the shared value for the per-line worklets.
  useEffect(() => {
    activeIndexSV.value = activeIndex;
  }, [activeIndex, activeIndexSV]);

  // User-scroll suspension.
  const userScrollingRef = useRef(false);
  const userScrollEndAtRef = useRef(0);
  const lockoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Shown whenever the user has scrolled away from the active line. */
  const [showResyncPill, setShowResyncPill] = useState(false);

  // Centre the active line at the active-slot position. `measureLayout`
  // asks native for the line's y + height relative to the ScrollView's
  // content — no spacer math required on our side.
  const scrollToActiveLine = useCallback(() => {
    if (!appActiveRef.current) return;
    if (activeIndex < 0) return;
    const lineRef = lineRefs.current[activeIndex];
    const scroll = scrollRef.current;
    if (!lineRef || !scroll) return;
    // `measureLayout` wants the target ancestor's node handle. Both View
    // and ScrollView accept themselves via `findNodeHandle`-like coercion
    // at runtime; the type system wants a number but the RN runtime is
    // forgiving here — the official RN docs show passing the ref directly.
    lineRef.measureLayout(
      scroll as unknown as number,
      (_x, y, _w, h) => {
        const vh = viewportHRef.current;
        if (vh <= 0) return;
        const lineCentre = y + h / 2;
        const targetY = Math.max(0, lineCentre - vh * ACTIVE_LINE_VIEWPORT_RATIO);
        scroll.scrollTo({ x: 0, y: targetY, animated: true });
      },
      () => {
        // measureLayout can fail if the view isn't mounted yet; silent.
      },
    );
  }, [activeIndex]);

  // Re-centre on the active line, but honour the user-scroll lockout so we
  // never yank the list out from under someone mid-read. Shared by the
  // active-line-advance effect and the foreground-resume re-centre.
  const maybeAutoScroll = useCallback(() => {
    if (userScrollingRef.current) return;
    if (Date.now() - userScrollEndAtRef.current < USER_SCROLL_LOCKOUT_MS) return;
    scrollToActiveLine();
    setShowResyncPill(false);
  }, [scrollToActiveLine]);

  // Latest-callback ref so the AppState listener (registered once) can call
  // the current maybeAutoScroll after a foreground transition.
  const maybeAutoScrollRef = useRef(maybeAutoScroll);
  maybeAutoScrollRef.current = maybeAutoScroll;

  const handleScrollBeginDrag = useCallback(() => {
    userScrollingRef.current = true;
    setShowResyncPill(true);
    if (lockoutTimerRef.current) {
      clearTimeout(lockoutTimerRef.current);
      lockoutTimerRef.current = null;
    }
  }, []);

  const handleScrollEndDrag = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>) => {
      userScrollingRef.current = false;
      userScrollEndAtRef.current = Date.now();
      // Auto-resume sync once the lockout expires, provided the user
      // hasn't started dragging again by then.
      if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
      lockoutTimerRef.current = setTimeout(() => {
        lockoutTimerRef.current = null;
        if (!userScrollingRef.current) {
          scrollToActiveLine();
          setShowResyncPill(false);
        }
      }, USER_SCROLL_LOCKOUT_MS);
    },
    [scrollToActiveLine],
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleScrollEndDrag(e);
    },
    [handleScrollEndDrag],
  );

  // Explicit user tap on the Re-sync pill — bypass the lockout, scroll
  // immediately, hide the pill.
  const handleResyncPress = useCallback(() => {
    userScrollEndAtRef.current = 0;
    if (lockoutTimerRef.current) {
      clearTimeout(lockoutTimerRef.current);
      lockoutTimerRef.current = null;
    }
    setShowResyncPill(false);
    scrollToActiveLine();
  }, [scrollToActiveLine]);

  // Clean up the lockout timer on unmount.
  useEffect(() => {
    return () => {
      if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
    };
  }, []);

  // Auto-scroll when the active line advances.
  useEffect(() => {
    if (activeIndex < 0) return;
    maybeAutoScroll();
  }, [activeIndex, maybeAutoScroll]);

  // Viewport height captured from the outer container's onLayout — used
  // by the scroll effect above to compute the midpoint target.
  const viewportHRef = useRef(0);
  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      viewportHRef.current = e.nativeEvent.layout.height;
    },
    [],
  );

  const handleLinePress = useCallback(
    (index: number) => {
      const ms = lineStarts[index];
      if (ms == null) return;
      impactAsync(ImpactFeedbackStyle.Light);
      seekTo(ms / 1000);
    },
    [lineStarts],
  );

  const tapDisabled = source === 'fake';

  // Shared value mirror of the extrapolated ms, driven by a JS-thread rAF
  // loop. Used by LyricsInterludeRow for breathing-dot timing.
  //
  // The loop runs only while the app is in the foreground. Backgrounded, the
  // JS thread keeps executing (background audio) and the native player keeps
  // emitting progress events — an ungated loop would keep writing the shared
  // value and waking the Reanimated UI thread to recompute every line's
  // worklet styles at the display refresh rate, off-screen and indefinitely.
  // That sustained off-screen commit work is what crashes the app when
  // backgrounded with lyrics open.
  const extrapolatedMs = useSharedValue(0);
  useEffect(() => {
    let rafId: number | null = null;
    let sampledSec = playerStore.getState().position;
    let sampledAt = Date.now();
    const resample = () => {
      const s = playerStore.getState();
      sampledSec = s.position;
      sampledAt = Date.now();
    };
    const tick = () => {
      const s = playerStore.getState();
      const elapsedSec =
        s.playbackState === 'playing' ? (Date.now() - sampledAt) / 1000 : 0;
      extrapolatedMs.value = (sampledSec + elapsedSec) * 1000;
      rafId = requestAnimationFrame(tick);
    };
    const start = () => {
      if (rafId != null) return;
      resample();
      tick();
    };
    const stop = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    const unsub = playerStore.subscribe(resample);
    const appSub = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      appActiveRef.current = active;
      if (active) {
        start();
        // While backgrounded the active index kept advancing but auto-scroll
        // was suppressed, so the view is parked on a stale line. Re-centre,
        // but via maybeAutoScroll so a user who scrolled away just before
        // backgrounding isn't yanked back inside the lockout window.
        maybeAutoScrollRef.current();
      } else {
        stop();
      }
    });
    if (appActiveRef.current) start();
    return () => {
      unsub();
      appSub.remove();
      stop();
    };
  }, [extrapolatedMs]);

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
      >
        <View style={styles.spacer} />
        {lines.map((line, i) => {
          const fromMs = lineStarts[i];
          const toMs = lineStarts[i + 1];
          const showInterlude = toMs != null && toMs - fromMs > INTERLUDE_MIN_GAP_MS;
          return (
            <View
              key={i}
              ref={(r) => {
                lineRefs.current[i] = r;
              }}
            >
              <LyricsLineRow
                index={i}
                text={line.text}
                activeIndex={activeIndexSV}
                textColor={textColor}
                disabled={tapDisabled}
                onPress={handleLinePress}
              />
              {showInterlude && (
                <LyricsInterludeRow
                  pairIndex={i}
                  activeIndex={activeIndexSV}
                  fromMs={fromMs}
                  toMs={toMs}
                  extrapolatedMs={extrapolatedMs}
                  textColor={textColor}
                />
              )}
            </View>
          );
        })}
        <View style={styles.spacer} />
      </ScrollView>
      {showResyncPill && (
        <View style={styles.resyncWrap} pointerEvents="box-none">
          <Pressable
            onPress={handleResyncPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('lyricsResync')}
            style={({ pressed }) => [
              styles.resyncPill,
              { backgroundColor: pillBackgroundColor },
              pressed && styles.resyncPressed,
            ]}
          >
            <Ionicons name="sync" size={14} color={textColor} />
            <Text style={[styles.resyncText, { color: textColor }]}>
              {t('lyricsResync')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  resyncWrap: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  resyncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  resyncPressed: {
    opacity: 0.6,
  },
  resyncText: {
    fontSize: 13,
    fontWeight: '600',
  },
  spacer: {
    // Fixed-height spacer so the first / last line can land at the centre
    // of any reasonable viewport. Measuring the viewport and computing a
    // dynamic half-height adds complexity without gain — 400pt comfortably
    // exceeds the half-height of any phone/tablet.
    height: SPACER_HEIGHT,
  },
});
