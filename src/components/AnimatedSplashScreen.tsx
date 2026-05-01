import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import BootSplash from 'react-native-bootsplash';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import AnimatedWaveformLogo, { type WaveformHandle } from './AnimatedWaveformLogo';
import { getPendingTasks, runMigrations } from '../services/migrationService';
import { rehydrateAllStores } from '../store/persistence/rehydrate';
import { migrationStore } from '../store/migrationStore';
import { kvStorage } from '../store/persistence';

/**
 * Max time (ms) before we force-finish, even if an animation or
 * migration task stalls. Increased from 5 s to accommodate migrations.
 */
const SAFETY_TIMEOUT = 15_000;

/**
 * Minimum time (ms) the splash screen stays visible after the native splash
 * is dismissed. Under normal motion the animation chain already exceeds this,
 * so it only takes effect when reduce-motion skips animations instantly.
 */
const MIN_VISIBLE_MS = 2_000;

/**
 * Scale of native splash logo content vs container. Must match logoScale (0.80)
 * in scripts/generate-assets.js for splash-logo.svg. If that changes, update here.
 */
const NATIVE_CONTENT_SCALE = 0.8;

const DOT_SIZE = 8;
const DOT_GAP = 10;

type MigrationPhase = 'idle' | 'running' | 'done';

type Props = {
  onFinish: () => void;
};

export default function AnimatedSplashScreen({ onFinish }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const containerOpacity = useSharedValue(1);
  const logoImageOpacity = useSharedValue(1);
  const animatedLogoOpacity = useSharedValue(0);
  const logoContentScale = useSharedValue(NATIVE_CONTENT_SCALE);
  const logoScale = useSharedValue(1);
  const logoTranslateY = useSharedValue(0);

  // Status area shared values
  const statusOpacity = useSharedValue(0);
  const dot0Scale = useSharedValue(0.4);
  const dot1Scale = useSharedValue(0.4);
  const dot2Scale = useSharedValue(0.4);
  const dotsOpacity = useSharedValue(1);
  const dotsScale = useSharedValue(1);
  const checkOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.3);
  const validatingOpacity = useSharedValue(1);
  const completeOpacity = useSharedValue(0);

  const onFinishRef = useRef(onFinish);
  const didFinish = useRef(false);
  const animateCompleted = useRef(false);
  const waveformCompleted = useRef(false);
  const visibleSince = useRef(0);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('idle');
  // Imperative handle: the ripple sequence only arms when bootsplash's
  // `animate()` callback fires. Otherwise the forward sweep plays while
  // animatedLogoOpacity is still 0 and the user only sees the reverse sweep.
  const waveformRef = useRef<WaveformHandle>(null);
  onFinishRef.current = onFinish;

  const complete = useCallback(() => {
    if (!didFinish.current) {
      didFinish.current = true;
      onFinishRef.current();
    }
  }, []);

  const doFadeOut = useCallback(() => {
    containerOpacity.value = withTiming(
      0,
      { duration: 500, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(complete)();
      },
    );
  }, [containerOpacity, complete]);

  const fadeOut = useCallback(() => {
    const elapsed = Date.now() - visibleSince.current;
    const remaining = MIN_VISIBLE_MS - elapsed;
    if (remaining > 0) {
      setTimeout(doFadeOut, remaining);
    } else {
      doFadeOut();
    }
  }, [doFadeOut]);

  const startBreathingDots = useCallback(() => {
    const breathe = withRepeat(
      withSequence(
        withTiming(1, { duration: 400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.4, { duration: 400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    dot0Scale.value = breathe;
    dot1Scale.value = withDelay(150, breathe);
    dot2Scale.value = withDelay(300, breathe);
  }, [dot0Scale, dot1Scale, dot2Scale]);

  const startMigrations = useCallback(
    (completedVersion: number) => {
      runMigrations(completedVersion)
        .then((finalVersion) => {
          migrationStore.getState().setCompletedVersion(finalVersion);
          rehydrateAllStores();
          setMigrationPhase('done');
        })
        .catch((e) => {
          // Defensive: runMigrations catches its own task-level errors
          // and returns partial progress, so this should never fire.
          // If it does, still transition to 'done' so the splash does
          // not hang on the 15s safety timeout.
          console.warn('[splash] runMigrations rejected unexpectedly', e);
          setMigrationPhase('done');
        });
    },
    [],
  );

  // Done transition: dots → checkmark, text cross-fade, then fadeOut
  useEffect(() => {
    if (migrationPhase !== 'done') return;

    // Cancel breathing dots
    cancelAnimation(dot0Scale);
    cancelAnimation(dot1Scale);
    cancelAnimation(dot2Scale);

    // Dots shrink + fade out
    dotsOpacity.value = withTiming(0, { duration: 300 });
    dotsScale.value = withTiming(0.6, { duration: 300 });

    // Checkmark pops in with spring after 150ms overlap
    checkOpacity.value = withDelay(
      150,
      withTiming(1, { duration: 300 }),
    );
    checkScale.value = withDelay(
      150,
      withSpring(1, { damping: 12, stiffness: 180 }),
    );

    // Text cross-fade
    validatingOpacity.value = withTiming(0, { duration: 250 });
    completeOpacity.value = withDelay(
      200,
      withTiming(1, { duration: 250 }),
    );

    // Hold then fade out
    const timeout = setTimeout(() => {
      fadeOut();
    }, 1200);

    return () => clearTimeout(timeout);
  }, [migrationPhase, dot0Scale, dot1Scale, dot2Scale, dotsOpacity, dotsScale, checkOpacity, checkScale, validatingOpacity, completeOpacity, fadeOut]);

  const handleRippleComplete = useCallback(() => {
    // Read completedVersion directly from SQLite (synchronous) rather than
    // from the Zustand store, which may not have rehydrated from persistence
    // yet. Without this, completedVersion reads as 0 and all migrations
    // appear pending on every launch.
    let completedVersion = 0;
    try {
      const raw = kvStorage.getItem('substreamer-migration') as string | null;
      if (raw) {
        const parsed = JSON.parse(raw);
        completedVersion = parsed?.state?.completedVersion ?? 0;
      }
    } catch { /* fall back to 0 — migrations will re-run safely */ }
    const pending = getPendingTasks(completedVersion);

    if (pending.length === 0) {
      // No migrations to run, but the per-row stores still need to be
      // hydrated from SQLite on every launch.
      rehydrateAllStores();
      fadeOut();
      return;
    }

    setMigrationPhase('running');

    // Logo transforms (unchanged)
    logoScale.value = withSpring(0.6);
    logoTranslateY.value = withSpring(-60);

    // Status area fades in, then starts migrations
    statusOpacity.value = withTiming(
      1,
      { duration: 500, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(startMigrations)(completedVersion);
      },
    );

    // Start breathing dots
    startBreathingDots();
  }, [fadeOut, logoScale, logoTranslateY, statusOpacity, startMigrations, startBreathingDots]);

  // Two-flag rendezvous: both the BootSplash animate() callback and the
  // waveform completion must fire before we proceed. Whichever arrives
  // second triggers handleRippleComplete. This eliminates a race condition
  // where reduce-motion causes the waveform to finish instantly (before
  // animate() has been called), losing the completion callback.
  const tryProceed = useCallback(() => {
    if (animateCompleted.current && waveformCompleted.current) {
      handleRippleComplete();
    }
  }, [handleRippleComplete]);

  const onAnimateComplete = useCallback(() => {
    animateCompleted.current = true;
    tryProceed();
  }, [tryProceed]);

  const onWaveformComplete = useCallback(() => {
    waveformCompleted.current = true;
    tryProceed();
  }, [tryProceed]);

  const { container, logo } = BootSplash.useHideAnimation({
    manifest: require('../../assets/bootsplash/manifest.json'),
    logo: require('../../assets/bootsplash/logo.png'),

    animate: () => {
      visibleSince.current = Date.now();
      logoImageOpacity.value = 0;
      animatedLogoOpacity.value = 1;
      logoContentScale.value = withTiming(
        1,
        { duration: 300, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onAnimateComplete)();
        },
      );
      // Mount-time animation start is the wrong trigger here: the bootsplash
      // keeps the waveform invisible until this callback fires, so kick off
      // the ripple sweeps NOW to keep the forward sweep on-screen.
      waveformRef.current?.start();
    },
  });

  // Safety timeout
  useEffect(() => {
    const timeout = setTimeout(complete, SAFETY_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [complete]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const logoWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: logoScale.value },
      { translateY: logoTranslateY.value },
    ],
  }));

  const logoImageStyle = useAnimatedStyle(() => ({
    opacity: logoImageOpacity.value,
  }));

  const animatedLogoStyle = useAnimatedStyle(() => ({
    opacity: animatedLogoOpacity.value,
    transform: [{ scale: logoContentScale.value }],
  }));

  const statusStyle = useAnimatedStyle(() => ({
    opacity: statusOpacity.value,
  }));

  const dotsContainerStyle = useAnimatedStyle(() => ({
    opacity: dotsOpacity.value,
    transform: [{ scale: dotsScale.value }],
  }));

  const dot0Style = useAnimatedStyle(() => ({
    transform: [{ scale: dot0Scale.value }],
  }));

  const dot1Style = useAnimatedStyle(() => ({
    transform: [{ scale: dot1Scale.value }],
  }));

  const dot2Style = useAnimatedStyle(() => ({
    transform: [{ scale: dot2Scale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  const validatingStyle = useAnimatedStyle(() => ({
    opacity: validatingOpacity.value,
  }));

  const completeStyle = useAnimatedStyle(() => ({
    opacity: completeOpacity.value,
  }));

  const statusBottom = Math.max(insets.bottom, 24) + 40;

  return (
    <Animated.View
      {...container}
      style={[container.style, containerStyle]}
    >
      <Animated.View
        style={[styles.logoWrap, logoWrapStyle]}
      >
        {/* Static bootsplash logo Image – visible until animate() fires */}
        <Animated.Image
          {...logo}
          style={[logo.style, { position: 'absolute' as const }, logoImageStyle]}
        />

        {/* Animated waveform bars – hidden until animate() swaps them in */}
        <Animated.View style={animatedLogoStyle}>
          <AnimatedWaveformLogo
            ref={waveformRef}
            size={130}
            color="#FFFFFF"
            onComplete={onWaveformComplete}
            autoStart={false}
          />
        </Animated.View>
      </Animated.View>

      {/* Status area — bottom-aligned */}
      <Animated.View
        style={[styles.statusWrap, { bottom: statusBottom }, statusStyle]}
        pointerEvents="none"
      >
        <Text style={styles.titleText}>{t('startingUp')}</Text>

        {/* Indicator row — fixed height for dots/checkmark swap */}
        <View style={styles.indicatorRow}>
          <Animated.View style={[styles.dotsRow, dotsContainerStyle]}>
            <Animated.View style={[styles.dot, dot0Style]} />
            <Animated.View style={[styles.dot, dot1Style]} />
            <Animated.View style={[styles.dot, dot2Style]} />
          </Animated.View>
          <Animated.View style={[styles.checkWrap, checkStyle]}>
            <Ionicons name="checkmark" size={24} color="#FFFFFF" />
          </Animated.View>
        </View>

        {/* Subtitle row — fixed height for text cross-fade */}
        <View style={styles.subtitleRow}>
          <Animated.Text style={[styles.subtitleText, styles.subtitleAbsolute, validatingStyle]}>
            {t('migrationValidating')}
          </Animated.Text>
          <Animated.Text style={[styles.subtitleText, styles.subtitleAbsolute, completeStyle]}>
            {t('migrationComplete')}
          </Animated.Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  indicatorRow: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotsRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: DOT_GAP,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#FFFFFF',
  },
  checkWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitleRow: {
    height: 20,
    marginTop: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subtitleText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '500',
  },
  subtitleAbsolute: {
    position: 'absolute',
    alignSelf: 'center',
  },
});
