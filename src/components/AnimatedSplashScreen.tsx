import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

type MigrationPhase = 'idle' | 'running' | 'done';

type Props = {
  onFinish: () => void;
};

export default function AnimatedSplashScreen({ onFinish }: Props) {
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const logoImageOpacity = useRef(new Animated.Value(1)).current;
  const animatedLogoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const logoTranslateY = useRef(new Animated.Value(0)).current;
  const migrationOpacity = useRef(new Animated.Value(0)).current;

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

  const fadeOut = useCallback(
    () =>
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    [containerOpacity],
  );

  const handleRippleComplete = useCallback(() => {
    const completedVersion = migrationStore.getState().completedVersion;
    const pending = getPendingTasks(completedVersion);

    if (pending.length === 0) {
      fadeOut().start(() => complete());
      return;
    }

    setMigrationPhase('running');

    Animated.parallel([
      Animated.spring(logoScale, {
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

      runMigrations(completedVersion).then((finalVersion) => {
        migrationStore.getState().setCompletedVersion(finalVersion);
        setMigrationPhase('done');

        setTimeout(() => {
          fadeOut().start(() => complete());
        }, 1200);
      });
    });
  }, [complete, fadeOut, logoScale, logoTranslateY, migrationOpacity]);

  // The useHideAnimation hook provides container + logo props that
  // exactly replicate the native splash layout. When it determines
  // everything is ready (layout rendered, logo image loaded) it hides
  // the native splash and fires our animate callback.
  const { container, logo } = BootSplash.useHideAnimation({
    manifest: require('../../assets/bootsplash/manifest.json'),
    logo: require('../../assets/bootsplash/logo.png'),
    navigationBarTranslucent: true,

    animate: () => {
      // Swap: hide the static logo Image, show the animated bars, start ripple.
      logoImageOpacity.setValue(0);
      animatedLogoOpacity.setValue(1);
      setRippling(true);
    },
  });

  // Safety timeout
  useEffect(() => {
    const timeout = setTimeout(complete, SAFETY_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [complete]);

  return (
    <Animated.View
      {...container}
      style={[container.style, { opacity: containerOpacity }]}
    >
      <Animated.View
        style={[
          styles.logoWrap,
          {
            transform: [
              { scale: logoScale },
              { translateY: logoTranslateY },
            ],
          },
        ]}
      >
        {/* Static bootsplash logo Image – visible until animate() fires */}
        <Animated.Image
          {...logo}
          style={[logo.style, { opacity: logoImageOpacity, position: 'absolute' }]}
        />

        {/* Animated waveform bars – hidden until animate() swaps them in */}
        <Animated.View style={{ opacity: animatedLogoOpacity }}>
          <AnimatedWaveformLogo
            size={130}
            color="#FFFFFF"
            onComplete={rippling ? handleRippleComplete : undefined}
          />
        </Animated.View>
      </Animated.View>

      {/* Migration status */}
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
