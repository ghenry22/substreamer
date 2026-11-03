import Ionicons from "@react-native-vector-icons/ionicons/static";
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
import {
  getPendingTasks,
  runMigrations,
} from '../services/migrationService';
import { finishLogout } from '../services/logoutService';
import { rehydrateAllStores } from '../store/persistence/rehydrate';
import { isReidRequired } from '../services/navidromeReid/reidMarker';
import { probeServerVersion } from '../services/navidromeReid/reidProbe';
import { awaitReidDecision, runNavidromeReidIfNeeded } from '../services/navidromeReid/runNavidromeReid';
import { authStore } from '../store/authStore';
import { isLogoutPending } from '../store/logoutPending';
import { migrationStore } from '../store/migrationStore';
// Synchronous adapter: the splash reads `completedVersion` before the store
// has hydrated, so it must be a synchronous SQLite read.
import { kvStorageSync as kvStorage } from '../store/persistence';

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

/**
 * Read completedVersion directly from SQLite (synchronous) rather than from the Zustand
 * store, which may not have rehydrated from persistence yet. Without this,
 * completedVersion reads as 0 and all migrations appear pending on every launch.
 */
function readCompletedVersion(): number {
  try {
    const raw = kvStorage.getItem('substreamer-migration') as string | null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.state?.completedVersion ?? 0;
    }
  } catch { /* fall back to 0 — migrations will re-run safely */ }
  return 0;
}

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
          // Kick off async hydration (SQLite IO on a background thread). It's
          // fire-and-forget here: stores populate reactively, and the
          // `_layout` effect independently AWAITS rehydration before
          // `onStartup()` — that is the authoritative ordering gate against
          // the "full library resync" banner.
          //
          // SKIPPED when the re-key is about to run. Twelve stores hydrating
          // concurrently, chunked across timer yields, comfortably outlives the version
          // probe and would read `cached_songs` and `favorite_songs` WHILE the pass is
          // rewriting their ids — landing a mixture of retired and canonical ids in
          // memory, some of it through the SYNC adapter. The pass does its own
          // `rehydrateAllStores()` at the end, once the ids have settled. A hydration
          // can still be running from the splash's no-migration branch below or the
          // headless bootstrap; the pass waits for its one writer, the download
          // metadata conversion, before its first write.
          if (!isReidRequired()) void rehydrateAllStores();
          // The chain has finished, which is the only moment the re-key can trust the
          // schema. Deliberately NOT keyed off the splash finishing: the safety timeout
          // fires that unconditionally, mid-migration on any large library.
          //
          // Ask the server its CURRENT version before deciding. The persisted copy is the
          // pre-upgrade one on exactly the launch this pass exists for. Bounded well under
          // the safety timeout, and a failure still leaves library writes refused, so a
          // slow server delays the decision rather than losing it.
          // Hold the splash until the pass has DECIDED, not until it finishes. Firing
          // and forgetting let the splash go while the pass was still working out
          // whether it needed the screen, so an install with nothing to re-key showed
          // the interstitial for an instant and hid it again.
          //
          // Checked BEFORE starting it, and only when a pass will actually run: for the
          // overwhelming majority — not Navidrome, or already done — there is nothing to
          // wait for, and adding a hop would delay every launch for no one's benefit. An
          // `ask` prompt raises the gate synchronously, so it holds the app by itself.
          const decide = (): void => {
            const willRun = isReidRequired();
            const pass = runNavidromeReidIfNeeded();
            if (!willRun) { setMigrationPhase('done'); return; }
            void awaitReidDecision(pass).then(() => setMigrationPhase('done'));
          };
          const probe = probeServerVersion();
          if (probe) void probe.then(decide); else decide();
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

  // A logout killed part way is finished first, then the chain runs from the counter the
  // wipe left. The reset puts `rehydrated` back to false, which would hold the auth
  // redirect for the rest of the launch.
  const beginMigrations = useCallback(
    (completedVersion: number) => {
      if (!isLogoutPending()) { startMigrations(completedVersion); return; }
      void finishLogout().then(() => {
        authStore.getState().setRehydrated(true);
        startMigrations(readCompletedVersion());
      });
    },
    [startMigrations],
  );

  const handleRippleComplete = useCallback(() => {
    const completedVersion = readCompletedVersion();
    const pending = getPendingTasks(completedVersion);

    if (pending.length === 0 && !isLogoutPending()) {
      // No migrations to run, but the per-row stores still need to be
      // hydrated from SQLite on every launch. Fire async hydration (IO on a
      // background thread) and fade out; the stores populate reactively and
      // the `_layout` effect independently awaits hydration before
      // `onStartup()`.
      void rehydrateAllStores();
      // Nothing pending still means the chain is complete, and this is the common launch
      // — a re-key triggered by the user's SERVER changing, not by our schema, has to be
      // reachable here too. The fade waits on the probe: this path fades immediately, so
      // deciding after it would let the splash finish first and the app launch unguarded.
      const decide = (): void => {
        // See the other decide(): only wait when a pass is genuinely about to run.
        const willRun = isReidRequired();
        const pass = runNavidromeReidIfNeeded();
        if (!willRun) { fadeOut(); return; }
        void awaitReidDecision(pass).then(fadeOut);
      };
      const probe = probeServerVersion();
      if (probe) void probe.then(decide); else decide();
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
        if (finished) runOnJS(beginMigrations)(completedVersion);
      },
    );

    // Start breathing dots
    startBreathingDots();
  }, [fadeOut, logoScale, logoTranslateY, statusOpacity, beginMigrations, startBreathingDots]);

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

  // Safety timeout: a backstop against an ANIMATION that never lands, not against a slow
  // migration. Held while the chain runs, because a library big enough to take longer than
  // this would otherwise drop the splash mid-chain — and `_layout` reads the splash going
  // away as "startup may proceed", launching the app into a half-migrated database and
  // firing every startup effect before the re-key's interstitial has had a chance to rise.
  // The chain cannot hang here silently: both arms of `startMigrations` set 'done'.
  useEffect(() => {
    if (migrationPhase === 'running') return undefined;
    const timeout = setTimeout(complete, SAFETY_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [complete, migrationPhase]);

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
