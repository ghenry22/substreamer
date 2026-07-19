import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

export interface StationLogoProps {
  /** Logo/favicon URL, or null to render the generic placeholder directly. */
  uri: string | null;
  size?: number;
  /** Ionicons name shown while loading / when the image fails. */
  fallbackIcon?: string;
  active?: boolean;
}

/**
 * Round station logo with a graceful fallback: radio stations have no
 * server-side artwork, so the URL is a derived favicon that often 404s —
 * failures fall back to the tinted radio glyph used before logos existed.
 */
export const StationLogo = memo(function StationLogo({
  uri,
  size = 36,
  fallbackIcon = 'radio-outline',
  active = false,
}: StationLogoProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);

  // A recycled row can swap to a different station — retry the new URL.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const showImage = uri != null && !failed;
  const radius = size / 2;

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: colors.primary + '18',
        },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name={(active ? 'radio' : fallbackIcon) as 'radio-outline'}
          size={Math.round(size * 0.55)}
          color={colors.primary}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
