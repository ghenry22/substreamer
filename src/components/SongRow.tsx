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
import { useTheme } from '../hooks/useTheme';
import { addSongToQueue, toggleStar } from '../services/moreOptionsService';
import { type Child } from '../services/subsonicService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { formatTrackDuration } from '../utils/formatters';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). */
const ROW_HEIGHT = 80;

export const SongRow = memo(function SongRow({ song, onPress }: { song: Child; onPress?: () => void }) {
  const { colors } = useTheme();
  const starred = useIsStarred('song', song.id);
  const downloaded = useDownloadStatus('song', song.id) === 'complete';
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const rating = useRating(song.id, song.userRating);
  const duration =
    song.duration != null ? formatTrackDuration(song.duration) : '—';

  const handleAddToQueue = useCallback(() => {
    addSongToQueue(song);
  }, [song]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', song.id);
  }, [song.id]);

  const handleAddToPlaylist = useCallback(() => {
    addToPlaylistStore.getState().showSong(song);
  }, [song]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'song', item: song });
  }, [song]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'list-outline', color: colors.primary, label: 'Queue', onPress: handleAddToQueue }],
    [colors.primary, handleAddToQueue],
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
    <SwipeableRow
      rightActions={rightActions}
      leftActions={leftActions}
      enableFullSwipeRight
      enableFullSwipeLeft={!offlineMode}
      rowGap={8}
      onLongPress={handleLongPress}
      onPress={onPress}
    >
      <View style={styles.row}>
        <CachedImage coverArtId={song.coverArt} size={COVER_SIZE} style={styles.cover} resizeMode="cover" />
        <View style={styles.text}>
          <Text
            style={[styles.songName, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {song.title}
          </Text>
          <Text
            style={[styles.artistName, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {song.artist ?? 'Unknown Artist'}
          </Text>
          <View style={styles.meta}>
            <View style={styles.metaAlbum}>
              <Ionicons name="disc-outline" size={14} color={colors.primary} />
              <View style={styles.albumTextWrapper}>
                <Text
                  style={[styles.albumText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {song.album ?? 'Unknown Album'}
                </Text>
              </View>
            </View>
            {rating > 0 && (
              <View style={styles.indicator}>
                <StarRatingDisplay rating={rating} size={12} color={colors.primary} emptyColor={colors.primary} />
              </View>
            )}
            {starred && <Ionicons name="heart" size={14} color={colors.red} style={styles.indicator} />}
            {downloaded && <View style={styles.indicator}><DownloadedIcon size={14} circleColor={colors.primary} arrowColor="#fff" /></View>}
            <View style={styles.metaDuration}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.durationText, { color: colors.textSecondary }]}>
                {duration}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </SwipeableRow>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  text: {
    flex: 1,
    marginLeft: 12,
  },
  songName: {
    fontSize: 16,
    fontWeight: '600',
  },
  indicator: {
    marginLeft: 6,
  },
  artistName: {
    fontSize: 14,
    marginTop: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  metaAlbum: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  albumTextWrapper: {
    flex: 1,
    marginLeft: 3,
  },
  albumText: {
    fontSize: 13,
  },
  metaDuration: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  durationText: {
    fontSize: 13,
    marginLeft: 3,
  },
});
