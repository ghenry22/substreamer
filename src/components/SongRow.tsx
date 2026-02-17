import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { addSongToQueue, toggleStar } from '../services/moreOptionsService';
import { type Child } from '../services/subsonicService';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { formatTrackDuration } from '../utils/formatters';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). Exported for getItemLayout. */
export const ROW_HEIGHT = 80;

export const SongRow = memo(function SongRow({ song, onPress }: { song: Child; onPress?: () => void }) {
  const { colors } = useTheme();
  const starred = useIsStarred('song', song.id);
  const duration =
    song.duration != null ? formatTrackDuration(song.duration) : '—';

  const handleAddToQueue = useCallback(() => {
    addSongToQueue(song);
  }, [song]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', song.id);
  }, [song.id]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'song', item: song });
  }, [song]);

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
      onLongPress={handleLongPress}
      onPress={onPress}
    >
      <View style={[styles.row, { backgroundColor: colors.card }]}>
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
    borderRadius: 12,
    marginBottom: 8,
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
