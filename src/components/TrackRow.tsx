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

import { CachedImage } from './CachedImage';
import { DownloadedIcon } from './DownloadedIcon';
import { StarRatingDisplay } from './StarRating';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useRating } from '../hooks/useRating';
import { addSongToQueue, toggleStar } from '../services/moreOptionsService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { formatTrackDuration } from '../utils/formatters';

import type { ThemeColors } from '../constants/theme';
import type { Child } from '../services/subsonicService';

const COVER_SIZE = 300;

export interface TrackRowProps {
  track: Child;
  /** Formatted track number label, e.g. "3. " or "1. ". Omit to hide the number. */
  trackNumber?: string;
  colors: ThemeColors;
  /** Called when the row is tapped to start playback. */
  onPress?: () => void;
  /** Show the album cover art thumbnail at the left of the row. */
  showCoverArt?: boolean;
  /** Show the album name with a disc icon below the artist name. */
  showAlbumName?: boolean;
}

export const TrackRow = memo(function TrackRow({ track, trackNumber, colors, onPress, showCoverArt, showAlbumName }: TrackRowProps) {
  const duration = track.duration != null ? formatTrackDuration(track.duration) : '—';
  const starred = useIsStarred('song', track.id);
  const downloaded = useDownloadStatus('song', track.id) === 'complete';
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const rating = useRating(track.id, track.userRating);

  const handleAddToQueue = useCallback(() => {
    addSongToQueue(track);
  }, [track]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', track.id);
  }, [track.id]);

  const handleAddToPlaylist = useCallback(() => {
    addToPlaylistStore.getState().showSong(track);
  }, [track]);

  const handleLongPress = useCallback(() => {
    moreOptionsStore.getState().show({ type: 'song', item: track });
  }, [track]);

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
      restingBackgroundColor="transparent"
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
          {showCoverArt && (
            <CachedImage
              coverArtId={track.coverArt}
              size={COVER_SIZE}
              style={styles.cover}
              resizeMode="cover"
            />
          )}
          <View style={styles.trackInfo}>
            <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
              {track.artist ?? 'Unknown Artist'}
            </Text>
            {showAlbumName && (
              <View style={styles.metaAlbum}>
                <Ionicons name="disc-outline" size={14} color={colors.primary} />
                <View style={styles.albumTextWrapper}>
                  <Text
                    style={[styles.albumText, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {track.album ?? 'Unknown Album'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
        <View style={styles.trackRight}>
          {rating > 0 && (
            <StarRatingDisplay
              rating={rating}
              size={12}
              color={colors.primary}
              emptyColor={colors.primary}
            />
          )}
          {downloaded && (
            <DownloadedIcon size={14} circleColor={colors.primary} arrowColor="#fff" />
          )}
          {starred && (
            <Ionicons name="heart" size={14} color={colors.red} />
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
    paddingHorizontal: 12,
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
  cover: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.12)',
    marginRight: 12,
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
  metaAlbum: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    minWidth: 0,
  },
  albumTextWrapper: {
    flex: 1,
    marginLeft: 3,
  },
  albumText: {
    fontSize: 13,
  },
  trackRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  trackDuration: {
    fontSize: 15,
  },
});
