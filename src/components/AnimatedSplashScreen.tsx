import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import BootSplash from 'react-native-bootsplash';

import AnimatedWaveformLogo from './AnimatedWaveformLogo';
import { getPendingTasks, runMigrations } from '../services/migrationService';
import { migrationStore } from '../store/migrationStore';

const PRIMARY = '#1D9BF0';
const SUCCESS = '#00BA7C';

/**
 * Max time (ms) before we force-finish, even if an animation or
 * migration task stalls. Increased from 5 s to accommodate migrations.
 */
const SAFETY_TIMEOUT = 15_000;

/**
 * Scale of native splash logo content vs container. Must match logoScale (0.80)
 * in scripts/generate-assets.js for splash-logo.svg. If that changes, update here.
 */
const NATIVE_CONTENT_SCALE = 0.8;

type MigrationPhase = 'idle' | 'running' | 'done';

type Props = {
  onFinish: () => void;
};

export default function AnimatedSplashScreen({ onFinish }: Props) {
  const containerOpacity = useSharedValue(1);
  const logoImageOpacity = useSharedValue(1);
  const animatedLogoOpacity = useSharedValue(0);
  const logoContentScale = useSharedValue(NATIVE_CONTENT_SCALE);
  const logoScale = useSharedValue(1);
  const logoTranslateY = useSharedValue(0);
  const migrationOpacity = useSharedValue(0);

  const onFinishRef = useRef(onFinish);
  const didFinish = useRef(false);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('idle');
  const [rippling, setRippling] = useState(false);
  onFinishRef.current = onFinish;

  const complete = useCallback(() => {
    if (!didFinish.current) {
      didFinish.current = true;
      onFinishRef.current();
    }
  }, []);

  const fadeOut = useCallback(() => {
    containerOpacity.value = withTiming(
      0,
      { duration: 500, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(complete)();
      },
    );
  }, [containerOpacity, complete]);

  const startMigrations = useCallback(
    (completedVersion: number) => {
      runMigrations(completedVersion).then((finalVersion) => {
        migrationStore.getState().setCompletedVersion(finalVersion);
        setMigrationPhase('done');

        setTimeout(() => {
          fadeOut();
        }, 1200);
      });
    },
    [fadeOut],
  );

  const handleRippleComplete = useCallback(() => {
    const completedVersion = migrationStore.getState().completedVersion;
    const pending = getPendingTasks(completedVersion);

    if (pending.length === 0) {
      fadeOut();
      return;
    }

    setMigrationPhase('running');

    // Parallel: assign all three concurrently
    logoScale.value = withSpring(0.6);
    logoTranslateY.value = withSpring(-60);
    migrationOpacity.value = withTiming(1, { duration: 400 }, (finished) => {
      if (finished) runOnJS(startMigrations)(completedVersion);
    });
  }, [fadeOut, logoScale, logoTranslateY, migrationOpacity, startMigrations]);

  // The useHideAnimation hook provides container + logo props that
  // exactly replicate the native splash layout. When it determines
  // everything is ready (layout rendered, logo image loaded) it hides
  // the native splash and fires our animate callback.
  const { container, logo } = BootSplash.useHideAnimation({
    manifest: require('../../assets/bootsplash/manifest.json'),
    logo: require('../../assets/bootsplash/logo.png'),
    navigationBarTranslucent: true,

    animate: () => {
      logoImageOpacity.value = 0;
      animatedLogoOpacity.value = 1;
      logoContentScale.value = withTiming(
        1,
        { duration: 300, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setRippling)(true);
        },
      );
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

  const migrationStyle = useAnimatedStyle(() => ({
    opacity: migrationOpacity.value,
  }));

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
            size={130}
            color="#FFFFFF"
            onComplete={rippling ? handleRippleComplete : undefined}
          />
        </Animated.View>
      </Animated.View>

      {/* Migration status */}
      <Animated.View
        style={[styles.migrationWrap, migrationStyle]}
        pointerEvents="none"
      >
        {migrationPhase === 'done' ? (
          <Ionicons name="checkmark-circle" size={28} color={SUCCESS} />
        ) : (
          <ActivityIndicator size="small" color="#FFFFFF" />
        )}
        <Text style={styles.migrationText}>
          {migrationPhase === 'done'
            ? 'Migrations complete'
            : 'Running migrations\u2026'}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
