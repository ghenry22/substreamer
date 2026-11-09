import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

interface GlassSurfaceProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius; use a big number (999) for a pill / circle. */
  radius?: number;
  /** 0..1 — how milky the glass is. */
  strength?: number;
  /** Optional colour that tints the glass (e.g. the cover colour). */
  tint?: string;
  /** Solid-ish colour under the glass layers (gives dark/white body). */
  base?: string;
}

/**
 * "Liquid glass" surface: blur (iOS) + translucent milky fill + a bright
 * specular rim that is strongest at the top-left, plus a soft inner
 * highlight. Android has no cheap backdrop blur without a blur target, so
 * there it relies on the layered translucent fill and rim, which already
 * reads as glass over the dark gradient backdrop.
 */
function GlassSurfaceBase({
  children,
  style,
  radius = 24,
  strength = 1,
  tint,
  base,
}: GlassSurfaceProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const k = Math.max(0, Math.min(strength, 1.5));

  const fillTop = dark ? `rgba(255,255,255,${0.2 * k})` : `rgba(255,255,255,${0.7 * k})`;
  const fillBottom = dark ? `rgba(255,255,255,${0.05 * k})` : `rgba(255,255,255,${0.3 * k})`;
  const rimStrong = dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.95)';
  const rimSoft = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.35)';

  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: base }, style]}>
      {Platform.OS === 'ios' && (
        <BlurView
          tint={dark ? 'dark' : 'light'}
          intensity={55}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {/* Milky body */}
      <LinearGradient
        colors={[fillTop, fillBottom]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {tint ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.16 }]}
          pointerEvents="none"
        />
      ) : null}
      {/* Soft inner light along the top edge (refraction of the "sky") */}
      <LinearGradient
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Specular rim: bright top-left, fading to the bottom-right */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1.2,
            borderColor: rimSoft,
            borderTopColor: rimStrong,
            borderLeftColor: rimStrong,
          },
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

export const GlassSurface = memo(GlassSurfaceBase);
