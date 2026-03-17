import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { DownloadedIcon } from './DownloadedIcon';
import { StarRatingDisplay } from './StarRating';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useRating } from '../hooks/useRating';
import { removeItemFromQueue, toggleStar } from '../services/moreOptionsService';
import { type Child } from '../services/subsonicService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { formatTrackDuration } from '../utils/formatters';

import type { ThemeColors } from '../constants/theme';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COVER_SIZE = 40;

/** Total row height (paddingVertical 20*2 + cover 40 = 80). */
const QUEUE_ROW_HEIGHT = 80;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface QueueItemRowProps {
  track: Child;
  index: number;
  isActive: boolean;
  colors: Pick<ThemeColors, 'textPrimary' | 'textSecondary' | 'primary' | 'border' | 'red'>;
  onPress: (index: number) => void;
  onLongPress?: (track: Child) => void;
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
  onLongPress,
}: QueueItemRowProps) {
  const handlePress = useCallback(() => {
    onPress(index);
  }, [index, onPress]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(track);
  }, [onLongPress, track]);

  const starred = useIsStarred('song', track.id);
  const downloaded = useDownloadStatus('song', track.id) === 'complete';
  const rating = useRating(track.id, track.userRating);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const handleRemove = useCallback(() => {
    removeItemFromQueue(index);
  }, [index]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', track.id);
  }, [track.id]);

  const handleAddToPlaylist = useCallback(() => {
    addToPlaylistStore.getState().showSong(track);
  }, [track]);

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
    () =>
      offlineMode
        ? []
        : [
            {
              icon: 'add-outline',
              color: colors.primary,
              label: 'Playlist',
              onPress: handleAddToPlaylist,
            },
            {
              icon: starred ? 'heart' : 'heart-outline',
              color: colors.red,
              label: starred ? 'Remove' : 'Add',
              onPress: handleToggleStar,
            },
          ],
    [starred, colors.red, colors.primary, handleToggleStar, handleAddToPlaylist, offlineMode],
  );

  return (
    <SwipeableRow rightActions={rightActions} leftActions={leftActions} enableFullSwipeRight enableFullSwipeLeft={!offlineMode} restingBackgroundColor="transparent" onPress={handlePress} onLongPress={onLongPress ? handleLongPress : undefined}>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        {/* Cover art with now-playing overlay */}
        <View style={styles.coverWrap}>
          <CachedImage
            coverArtId={track.coverArt}
            size={50}
            style={styles.cover}
            resizeMode="cover"
          />
          {isActive && (
            <View style={styles.activeOverlay}>
              <Ionicons name="play" size={22} color={colors.primary} style={{ opacity: 1 }} />
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

        {/* Downloaded + Starred indicators + Duration */}
        <View style={styles.trailing}>
          {rating > 0 && (
            <StarRatingDisplay rating={rating} size={12} color={colors.primary} emptyColor={colors.primary} />
          )}
          {downloaded && (
            <DownloadedIcon size={14} circleColor={colors.primary} arrowColor="#fff" />
          )}
          {starred && (
            <Ionicons name="heart" size={14} color={colors.red} />
          )}
          <Text style={[styles.duration, { color: isActive ? colors.primary : colors.textSecondary }]}>
            {durationText}
          </Text>
        </View>
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
    paddingVertical: 20,
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
    fontWeight: '600',
  },
  artist: {
    fontSize: 14,
    marginTop: 2,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  duration: {
    fontSize: 15,
  },
});
