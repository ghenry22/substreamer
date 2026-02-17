import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useIsStarred } from '../hooks/useIsStarred';
import { removeItemFromQueue, toggleStar } from '../services/moreOptionsService';
import { type Child } from '../services/subsonicService';
import { formatTrackDuration } from '../utils/formatters';

import type { ThemeColors } from '../constants/theme';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COVER_SIZE = 40;

/** Total row height (paddingVertical 14*2 + cover 40 = 68). Exported for estimatedItemSize. */
export const QUEUE_ROW_HEIGHT = 68;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface QueueItemRowProps {
  track: Child;
  index: number;
  isActive: boolean;
  colors: Pick<ThemeColors, 'textPrimary' | 'textSecondary' | 'primary' | 'border' | 'red'>;
  onPress: (index: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const QueueItemRow = memo(function QueueItemRow({
  track,
  index,
  isActive,
  colors,
  onPress,
}: QueueItemRowProps) {
  const handlePress = useCallback(() => {
    onPress(index);
  }, [index, onPress]);

  const starred = useIsStarred('song', track.id);

  const handleRemove = useCallback(() => {
    removeItemFromQueue(index);
  }, [index]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', track.id);
  }, [track.id]);

  const titleColor = isActive ? colors.primary : colors.textPrimary;
  const subtitleColor = isActive ? colors.primary : colors.textSecondary;
  const durationText =
    track.duration != null ? formatTrackDuration(track.duration) : '—';

  const rightActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: 'trash-outline',
        color: colors.red,
        label: 'Remove',
        onPress: handleRemove,
        removesRow: true,
      },
    ],
    [colors.red, handleRemove],
  );

  const leftActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: starred ? 'heart' : 'heart-outline',
        color: colors.red,
        label: starred ? 'Remove' : 'Add',
        onPress: handleToggleStar,
      },
    ],
    [starred, colors.red, handleToggleStar],
  );

  return (
    <SwipeableRow rightActions={rightActions} leftActions={leftActions} onPress={handlePress}>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        {/* Cover art with now-playing overlay */}
        <View style={styles.coverWrap}>
          <CachedImage
            coverArtId={track.coverArt}
            size={150}
            style={styles.cover}
            resizeMode="cover"
          />
          {isActive && (
            <View style={styles.activeOverlay}>
              <Ionicons name="play" size={22} color={colors.primary} />
            </View>
          )}
        </View>

        {/* Track info */}
        <View style={styles.info}>
          <Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
            {track.title}
          </Text>
          {track.artist && (
            <Text style={[styles.artist, { color: subtitleColor }]} numberOfLines={1}>
              {track.artist}
            </Text>
          )}
        </View>

        {/* Duration */}
        <Text style={[styles.duration, { color: isActive ? colors.primary : colors.textSecondary }]}>
          {durationText}
        </Text>
      </View>
    </SwipeableRow>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coverWrap: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
  },
  activeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  title: {
    fontSize: 16,
  },
  artist: {
    fontSize: 13,
    marginTop: 2,
  },
  duration: {
    fontSize: 15,
    marginLeft: 12,
  },
});
