import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { isRadioId } from '../services/subsonicService';
import { buildAutoName, capturePlayerSnapshot, commitBookmark } from '../services/bookmarkService';
import { bookmarkSheetStore } from '../store/bookmarkSheetStore';
import { bookmarksStore } from '../store/bookmarksStore';
import { playbackToastStore } from '../store/playbackToastStore';
import { playerStore } from '../store/playerStore';

export interface BookmarkButtonProps {
  size?: number;
  /** Container padding/spacing — varies per player surface. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Saves a play-queue bookmark. Auto-names and commits immediately when the
 * auto-name preference is on; otherwise opens the manual-name sheet. Shared
 * across player surfaces.
 */
export const BookmarkButton = memo(function BookmarkButton({
  size = 24,
  style,
}: BookmarkButtonProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const autoName = bookmarksStore((s) => s.autoName);
  const queueLength = playerStore((s) => s.queue.length);
  const isRadio = playerStore((s) => (s.currentTrack ? isRadioId(s.currentTrack.id) : false));
  const disabled = queueLength === 0;

  const handlePress = useCallback(() => {
    // Capture the queue/position NOW, at tap time, regardless of which path we
    // take — the manual-name sheet commits this same snapshot on Save.
    const snapshot = capturePlayerSnapshot();
    if (!snapshot) return;
    const existingNames = Object.values(bookmarksStore.getState().bookmarks).map((b) => b.name);
    const suggested = buildAutoName(t, i18n.language, existingNames);
    if (autoName) {
      commitBookmark(snapshot, suggested);
      playbackToastStore.getState().flashSuccess(t('bookmarkSaved'));
    } else {
      bookmarkSheetStore.getState().showCreate(suggested, snapshot);
    }
  }, [autoName, t, i18n.language]);

  // A live stream has no resumable position — bookmarking makes no sense.
  if (isRadio) return null;

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('addBookmark')}
      style={({ pressed }) => [
        style,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name="bookmark-outline" size={size} color={colors.textSecondary} />
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
