import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import { addAlbumToQueue, toggleStar } from '../services/moreOptionsService';
import { type AlbumID3 } from '../services/subsonicService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { formatCompactDuration } from '../utils/formatters';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). */
const ROW_HEIGHT = 80;

export const AlbumRow = memo(function AlbumRow({ album }: { album: AlbumID3 }) {
  const { colors } = useTheme();
  const router = useRouter();
  const starred = useIsStarred('album', album.id);
  const downloaded = useDownloadStatus('album', album.id) === 'complete';
  const rating = useRating(album.id, album.userRating);
  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const onPress = useCallback(() => {
    router.push(`/album/${album.id}`);
  }, [album.id, router]);

  const handleAddToQueue = useCallback(() => {
    addAlbumToQueue(album);
  }, [album]);

  const handleToggleStar = useCallback(() => {
    toggleStar('album', album.id);
  }, [album.id]);

  const handleAddToPlaylist = useCallback(() => {
    addToPlaylistStore.getState().showAlbum(album);
  }, [album]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'album', item: album });
  }, [album]);

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
            {rating > 0 && (
              <View style={styles.indicator}>
                <StarRatingDisplay rating={rating} size={12} color={colors.primary} emptyColor={colors.primary} />
              </View>
            )}
            {starred && <Ionicons name="heart" size={14} color={colors.red} style={styles.indicator} />}
            {downloaded && <View style={styles.indicator}><DownloadedIcon size={14} circleColor={colors.primary} arrowColor="#fff" /></View>}
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
