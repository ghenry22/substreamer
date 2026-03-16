import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CachedImage } from './CachedImage';
import { DownloadedIcon } from './DownloadedIcon';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useTheme } from '../hooks/useTheme';
import { addPlaylistToQueue } from '../services/moreOptionsService';
import { type Playlist } from '../services/subsonicService';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { formatCompactDuration } from '../utils/formatters';

const COVER_SIZE = 300;

/** Total row height (padding 12*2 + image 56 = 80). */
const ROW_HEIGHT = 80;

export const PlaylistRow = memo(function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const { colors } = useTheme();
  const router = useRouter();
  const downloaded = useDownloadStatus('playlist', playlist.id) === 'complete';

  const onPress = useCallback(() => {
    router.push(`/playlist/${playlist.id}`);
  }, [playlist.id, router]);

  const handleAddToQueue = useCallback(() => {
    addPlaylistToQueue(playlist);
  }, [playlist]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'playlist', item: playlist });
  }, [playlist]);

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'list-outline', color: colors.primary, label: 'Queue', onPress: handleAddToQueue }],
    [colors.primary, handleAddToQueue],
  );

  return (
    <SwipeableRow
      rightActions={rightActions}
      enableFullSwipeRight
      rowGap={8}
      onLongPress={handleLongPress}
      onPress={onPress}
    >
      <View style={styles.row}>
        <CachedImage coverArtId={playlist.coverArt} size={COVER_SIZE} style={styles.cover} resizeMode="cover" />
        <View style={styles.text}>
          <Text
            style={[styles.playlistName, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {playlist.name}
          </Text>
          <View style={styles.meta}>
            <View style={styles.metaLeft}>
              <Ionicons name="musical-notes-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {playlist.songCount} {playlist.songCount === 1 ? 'track' : 'tracks'}
              </Text>
            </View>
            {downloaded && <View style={styles.indicator}><DownloadedIcon size={14} circleColor={colors.primary} arrowColor="#fff" /></View>}
            <View style={styles.metaRight}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {formatCompactDuration(playlist.duration)}
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
  playlistName: {
    fontSize: 16,
    fontWeight: '600',
  },
  indicator: {
    marginLeft: 6,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
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
