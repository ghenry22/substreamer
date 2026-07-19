import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { toggleStar } from '../services/moreOptionsService';
import { isRadioId } from '../services/subsonicService';
import { offlineModeStore } from '../store/offlineModeStore';

export interface FavoriteButtonProps {
  trackId: string;
  size?: number;
  /** Container padding/spacing — varies per player surface. */
  style?: StyleProp<ViewStyle>;
}

/** Heart toggle for a song. Disabled offline. Shared across all player surfaces. */
export const FavoriteButton = memo(function FavoriteButton({
  trackId,
  size = 24,
  style,
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const starred = useIsStarred('song', trackId);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleToggle = useCallback(() => {
    toggleStar('song', trackId);
  }, [trackId]);

  // Radio stations can't be starred server-side — hide the heart entirely.
  // (After the hooks: the guard must not change the hook call order.)
  if (isRadioId(trackId)) return null;

  return (
    <Pressable
      onPress={handleToggle}
      disabled={offlineMode}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={starred ? t('removeFromFavorites') : t('addToFavorites')}
      style={({ pressed }) => [
        style,
        pressed && !offlineMode && styles.pressed,
        offlineMode && styles.disabled,
      ]}
    >
      <Ionicons
        name={starred ? 'heart' : 'heart-outline'}
        size={size}
        color={starred ? colors.red : colors.textSecondary}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
