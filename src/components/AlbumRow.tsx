import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import { addAlbumToQueue, toggleStar } from '../services/moreOptionsService';
import { type AlbumID3 } from '../services/subsonicService';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { formatCompactDuration } from '../utils/formatters';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). Exported for getItemLayout. */
export const ROW_HEIGHT = 80;

export const AlbumRow = memo(function AlbumRow({ album }: { album: AlbumID3 }) {
  const { colors } = useTheme();
  const router = useRouter();
  const starred = useIsStarred('album', album.id);

  const onPress = useCallback(() => {
    router.push(`/album/${album.id}`);
  }, [album.id, router]);

  const handleAddToQueue = useCallback(() => {
    addAlbumToQueue(album);
  }, [album]);

  const handleToggleStar = useCallback(() => {
    toggleStar('album', album.id);
  }, [album.id]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'album', item: album });
  }, [album]);

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
        <CachedImage coverArtId={album.coverArt} size={COVER_SIZE} style={styles.cover} resizeMode="cover" />
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.albumName, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {album.name}
            </Text>
            {album.year != null && album.year > 0 && (
              <Text style={[styles.year, { color: colors.textSecondary }]}>
                ({album.year})
              </Text>
            )}
          </View>
          <Text
            style={[styles.artistName, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {album.artist ?? 'Unknown Artist'}
          </Text>
          <View style={styles.meta}>
            <View style={styles.metaLeft}>
              <Ionicons name="musical-notes-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {album.songCount} {album.songCount === 1 ? 'track' : 'tracks'}
              </Text>
            </View>
            <View style={styles.metaRight}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {formatCompactDuration(album.duration)}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  albumName: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  year: {
    fontSize: 14,
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
  metaLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  metaRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  metaText: {
    fontSize: 13,
    marginLeft: 3,
  },
});
