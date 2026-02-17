/**
 * Shared TrackRow component used by album-detail and playlist-detail screens.
 *
 * Displays a single track with an optional track number, title, optional artist
 * subtitle, starred indicator, user rating, and duration.
 *
 * Supports swipe-right to add to queue, swipe-left to toggle favorite,
 * and long-press to open the more options sheet.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useIsStarred } from '../hooks/useIsStarred';
import { addSongToQueue, toggleStar } from '../services/moreOptionsService';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { formatTrackDuration } from '../utils/formatters';

import type { ThemeColors } from '../constants/theme';
import type { Child } from '../services/subsonicService';

export interface TrackRowProps {
  track: Child;
  /** Formatted track number label, e.g. "3. " or "1. ". Omit to hide the number. */
  trackNumber?: string;
  colors: ThemeColors;
  /** Called when the row is tapped to start playback. */
  onPress?: () => void;
}

export const TrackRow = memo(function TrackRow({ track, trackNumber, colors, onPress }: TrackRowProps) {
  const duration = track.duration != null ? formatTrackDuration(track.duration) : '—';
  const starred = useIsStarred('song', track.id);
  const rating = track.userRating;

  const handleAddToQueue = useCallback(() => {
    addSongToQueue(track);
  }, [track]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', track.id);
  }, [track.id]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'song', item: track });
  }, [track]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'list-outline', color: colors.primary, label: 'Queue', onPress: handleAddToQueue }],
    [colors.primary, handleAddToQueue],
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
    <SwipeableRow
      rightActions={rightActions}
      leftActions={leftActions}
      enableFullSwipeRight
      enableFullSwipeLeft
      actionPanelBackground="transparent"
      onLongPress={handleLongPress}
      onPress={onPress}
    >
      <View
        style={[
          styles.trackRow,
          { borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.trackLeft}>
          {trackNumber != null && (
            <Text style={[styles.trackNum, { color: colors.textSecondary }]}>
              {trackNumber}
            </Text>
          )}
          <View style={styles.trackInfo}>
            <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
              {track.artist ?? 'Unknown Artist'}
            </Text>
          </View>
        </View>
        <View style={styles.trackRight}>
          {starred && (
            <Ionicons name="heart" size={14} color={colors.red} />
          )}
          {rating != null && rating > 0 && (
            <Text style={[styles.trackRating, { color: colors.textSecondary }]}>
              {rating}/5
            </Text>
          )}
          <Text style={[styles.trackDuration, { color: colors.textSecondary }]}>
            {duration}
          </Text>
        </View>
      </View>
    </SwipeableRow>
  );
});

const styles = StyleSheet.create({
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 80,
    paddingVertical: 18,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  trackNum: {
    fontSize: 15,
    minWidth: 28,
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  trackArtist: {
    fontSize: 14,
    marginTop: 2,
  },
  trackRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  trackRating: {
    fontSize: 12,
  },
  trackDuration: {
    fontSize: 15,
  },
});
