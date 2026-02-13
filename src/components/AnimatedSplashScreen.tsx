import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import WaveformLogo from './WaveformLogo';
import { getPendingTasks, runMigrations } from '../services/migrationService';
import { migrationStore } from '../store/migrationStore';

const PRIMARY = '#1D9BF0';
const SUCCESS = '#00BA7C';

/**
 * Max time (ms) before we force-finish, even if an animation or
 * migration task stalls. Increased from 5 s to accommodate migrations.
 */
const SAFETY_TIMEOUT = 15_000;

type MigrationPhase = 'idle' | 'running' | 'done';

type Props = {
  onFinish: () => void;
};

export default function AnimatedSplashScreen({ onFinish }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const logoTranslateY = useRef(new Animated.Value(0)).current;
  const migrationOpacity = useRef(new Animated.Value(0)).current;
  const onFinishRef = useRef(onFinish);
  const didFinish = useRef(false);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('idle');
  onFinishRef.current = onFinish;

  useEffect(() => {
    const complete = () => {
      if (!didFinish.current) {
        didFinish.current = true;
        onFinishRef.current();
      }
    };

    const fadeOut = () =>
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    SplashScreen.hideAsync();

    // ── Phase 1: Logo intro (unchanged from original) ──────────────

    const pulse = (toValue: number) =>
      Animated.spring(scale, {
        toValue,
        useNativeDriver: true,
        friction: 6,
        tension: 120,
      });

    const introAnim = Animated.sequence([
      // Grow from nothing to pulse peak
      Animated.spring(scale, {
        toValue: 1.15,
        useNativeDriver: true,
        friction: 6,
        tension: 80,
      }),
      // Settle to resting size
      pulse(1),
      // Two additional pulses
      Animated.sequence([pulse(1.15), pulse(1)]),
      Animated.sequence([pulse(1.15), pulse(1)]),
    ]);

    introAnim.start(({ finished: introFinished }) => {
      if (!introFinished) return;

      // ── Check for pending migrations ───────────────────────────

      const completedVersion = migrationStore.getState().completedVersion;
      const pending = getPendingTasks(completedVersion);

      if (pending.length === 0) {
        // Phase 2a: no migrations – fade out immediately
        fadeOut().start(() => complete());
        return;
      }

      // ── Phase 2b: migrations needed ────────────────────────────

      // Show the migration UI (rendered at opacity 0, faded in below)
      setMigrationPhase('running');

      // Transition: shrink logo, slide it up, fade in migration text
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 0.6,
          useNativeDriver: true,
          friction: 8,
          tension: 60,
        }),
        Animated.spring(logoTranslateY, {
          toValue: -60,
          useNativeDriver: true,
          friction: 8,
          tension: 60,
        }),
        Animated.timing(migrationOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start(({ finished: transitionFinished }) => {
        if (!transitionFinished) return;

        // Run all pending migration tasks
        runMigrations(completedVersion).then((finalVersion) => {
          migrationStore.getState().setCompletedVersion(finalVersion);
          setMigrationPhase('done');

          // Hold briefly so the user can read "Update complete"
          setTimeout(() => {
            fadeOut().start(() => complete());
          }, 1200);
        });
      });
    });

    const timeout = setTimeout(complete, SAFETY_TIMEOUT);

    return () => {
      introAnim.stop();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <Animated.View
        style={[
          styles.logoWrap,
          { transform: [{ scale }, { translateY: logoTranslateY }] },
        ]}
      >
        <WaveformLogo size={130} color="#FFFFFF" />
      </Animated.View>

      {/* Migration status – always mounted (at opacity 0) so the fade-in
          animation is smooth. Content swaps when phase changes. */}
      <Animated.View
        style={[styles.migrationWrap, { opacity: migrationOpacity }]}
        pointerEvents="none"
      >
        {migrationPhase === 'done' ? (
          <Ionicons name="checkmark-circle" size={28} color={SUCCESS} />
        ) : (
          <ActivityIndicator size="small" color="#FFFFFF" />
        )}
        <Text style={styles.migrationText}>
          {migrationPhase === 'done'
            ? 'Update complete'
            : 'Updating Substreamer\u2026'}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  migrationWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '56%',
    alignItems: 'center',
  },
  migrationText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
  },
});
