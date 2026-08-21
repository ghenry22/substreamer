import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CachedImage } from './CachedImage';
import { NowPlayingIndicator } from './NowPlayingIndicator';
import { RowMetaLine } from './RowMetaLine';
import { SwipeableRow, type SwipeAction } from './SwipeableRow';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useRating } from '../hooks/useRating';
import { useSongCoverArt } from '../hooks/useSongCoverArt';
import { addSongToQueue, toggleStar } from '../services/moreOptionsService';
import { playTrack } from '../services/playerService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { completeSongFromCache } from '../store/musicCacheStore';
import { type MoreOptionsSource, moreOptionsStore } from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playerStore } from '../store/playerStore';
import { formatTrackDuration } from '../utils/formatters';

import type { ThemeColors } from '../constants/theme';
import type { Child } from '../services/subsonicService';

import { absoluteFill } from '../utils/styles';
const COVER_SIZE = 300;

export interface TrackRowProps {
  track: Child;
  /** Formatted track number label, e.g. "3. " or "1. ". Omit to hide the number. */
  trackNumber?: string;
  colors: ThemeColors;
  /** Overrides the default `playTrack(track, songs ?? [track], playlistId)` tap behaviour. */
  onPress?: () => void;
  /** Queue context for the default tap behaviour. Defaults to `[track]` (play just this song). */
  songs?: Child[];
  /** Playlist id threaded to `playTrack` for the default tap behaviour. */
  playlistId?: string;
  /** Show the album cover art thumbnail at the left of the row. */
  showCoverArt?: boolean;
  /** Show the album name with a disc icon below the artist name. */
  showAlbumName?: boolean;
  /** Show the composer with a leading icon below the artist name (Album View). */
  showComposer?: boolean;
  /** Context passed to the options sheet, which varies its actions by origin. */
  optionsSource?: MoreOptionsSource;
}

export const TrackRow = memo(function TrackRow({ track, trackNumber, colors, onPress, songs, playlistId, showCoverArt, showAlbumName, showComposer, optionsSource }: TrackRowProps) {
  const { t } = useTranslation();
  const duration = track.duration != null ? formatTrackDuration(track.duration) : '—';
  const starred = useIsStarred('song', track.id);
  const downloadStatus = useDownloadStatus('song', track.id);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const rating = useRating(track.id, track.userRating);
  // Selects a boolean, not the track: non-active rows then re-render only when
  // currentTrack moves to or from this row, not on every track change.
  const isActive = playerStore((s) => s.currentTrack?.id === track.id);
  const songCoverArtId = useSongCoverArt(track);
  // Offline, a track that isn't fully cached is inert — tapping it would route to the
  // first playable track in the queue with no on-screen signal why. 'complete' is true
  // exactly when getLocalTrackUri(id) is non-null, the same predicate
  // playerService.childToTrack filters the offline queue on.
  const isOfflineUnplayable = offlineMode && downloadStatus !== 'complete';

  const handleAddToQueue = useCallback(() => {
    addSongToQueue(track);
  }, [track]);

  const handleToggleStar = useCallback(() => {
    toggleStar('song', track.id);
  }, [track.id]);

  const handleAddToPlaylist = useCallback(() => {
    addToPlaylistStore.getState().showSong(track);
  }, [track]);

  // The row may have been built from a narrow list projection. The sheet gates
  // "Go to Artist" on `artistId` and renders the details modal off this object, so
  // the track is completed as the sheet opens — one song, not one per rendered row.
  const handleLongPress = useCallback(() => {
    moreOptionsStore
      .getState()
      .show({ type: 'song', item: completeSongFromCache(track) }, optionsSource);
  }, [track, optionsSource]);

  // Derive the tap action from props rather than take an inline closure from the
  // parent, or this memoized row re-renders on every parent render.
  const playFromContext = useCallback(() => {
    playTrack(track, songs ?? [track], playlistId);
  }, [track, songs, playlistId]);
  const handlePress = onPress ?? playFromContext;

  const rightActions: SwipeAction[] = useMemo(
    () => [{ icon: 'playlist-play', iconFamily: 'mdi' as const, color: colors.primary, label: t('queue'), onPress: handleAddToQueue }],
    [colors.primary, handleAddToQueue, t],
  );

  const leftActions: SwipeAction[] = useMemo(
    () =>
      offlineMode
        ? []
        : [
            {
              icon: 'playlist-plus',
              iconFamily: 'mdi' as const,
              color: colors.primary,
              label: t('playlist'),
              onPress: handleAddToPlaylist,
            },
            {
              icon: starred ? 'heart' : 'heart-outline',
              color: colors.red,
              label: starred ? t('remove') : t('add'),
              onPress: handleToggleStar,
            },
          ],
    [starred, colors.red, colors.primary, handleToggleStar, handleAddToPlaylist, offlineMode, t],
  );

  return (
    <SwipeableRow
      rightActions={rightActions}
      leftActions={leftActions}
      enableFullSwipeRight
      enableFullSwipeLeft={!offlineMode}
      restingBackgroundColor="transparent"
      onLongPress={handleLongPress}
      onPress={handlePress}
      disabled={isOfflineUnplayable}
    >
      <View
        style={[
          styles.trackRow,
          { borderBottomColor: colors.border },
          isOfflineUnplayable && styles.trackRowDisabled,
        ]}
        accessibilityState={isOfflineUnplayable ? { disabled: true } : undefined}
      >
        {/* Leading slot: cover, or track number. The active row's now-playing */}
        {/* indicator replaces the number outright, or overlays the cover. */}
        {showCoverArt ? (
          <View style={styles.coverWrap}>
            <CachedImage
              coverArtId={songCoverArtId}
              size={COVER_SIZE}
              style={styles.cover}
              resizeMode="cover"
            />
            {isActive && (
              <View style={styles.activeOverlay}>
                <NowPlayingIndicator size={26} color={colors.primary} />
              </View>
            )}
          </View>
        ) : isActive ? (
          <View style={styles.numberIndicator}>
            <NowPlayingIndicator size={20} color={colors.primary} />
          </View>
        ) : trackNumber != null ? (
          <Text style={[styles.trackNum, { color: colors.textSecondary }]}>
            {trackNumber}
          </Text>
        ) : null}
        <View style={styles.trackInfo}>
          {/* Line 1: title fills, duration pinned to the right edge. */}
          <View style={styles.line}>
            <Text
              style={[
                styles.trackTitle,
                { color: isActive ? colors.primary : colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {track.title}
            </Text>
            <RowMetaLine
              slots={['duration']}
              durationText={duration}
              durationFontSize={14}
              durationColor={isActive ? colors.primary : undefined}
            />
          </View>
          {/* Line 2: artist fills, status icons pinned to the right edge. */}
          <View style={[styles.line, styles.artistLine]}>
            <Text
              style={[
                styles.trackArtist,
                { color: isActive ? colors.primary : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {track.artist ?? t('unknownArtist')}
            </Text>
            <RowMetaLine
              slots={['rating', 'download', 'heart']}
              rating={rating}
              starred={starred}
              downloadStatus={
                downloadStatus === 'complete' || downloadStatus === 'partial'
                  ? downloadStatus
                  : 'none'
              }
            />
          </View>
          {showComposer && track.displayComposer ? (
            <View style={styles.metaComposer}>
              <Ionicons name="create-outline" size={14} color={colors.primary} />
              <View style={styles.composerTextWrapper}>
                <Text
                  style={[styles.composerText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                  accessibilityLabel={`${t('detailComposer')}: ${track.displayComposer}`}
                >
                  {track.displayComposer}
                </Text>
              </View>
            </View>
          ) : null}
          {showAlbumName && (
            <View style={styles.metaAlbum}>
              <Ionicons name="disc-outline" size={14} color={colors.primary} />
              <View style={styles.albumTextWrapper}>
                <Text
                  style={[styles.albumText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {track.album ?? t('unknownAlbum')}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </SwipeableRow>
  );
});

const styles = StyleSheet.create({
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 80,
    paddingVertical: 12,
    // Matches the `info` block padding (16) on album-detail / playlist-detail so the
    // row's first column lines up with the title text above. The `trackItemWrap` on
    // those screens carries no horizontal padding, so this is the only source of it.
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackRowDisabled: {
    opacity: 0.4,
  },
  trackNum: {
    fontSize: 14,
    minWidth: 28,
  },
  // Width matches `trackNum.minWidth` so swapping the indicator in for the
  // position number doesn't shift the title column.
  numberIndicator: {
    minWidth: 28,
    alignItems: 'flex-start',
  },
  coverWrap: {
    width: 48,
    height: 48,
    marginRight: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  activeOverlay: {
    ...absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfo: {
    flex: 1,
    minWidth: 0,
  },
  // Each text line splits into left-flexed text + a right-pinned RowMetaLine. The
  // text needs `flex: 1` + numberOfLines={1} so it truncates instead of pushing the
  // trailing block off-screen.
  line: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  artistLine: {
    marginTop: 2,
  },
  trackTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '600',
  },
  trackArtist: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
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
    fontSize: 12,
  },
  metaComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    minWidth: 0,
  },
  composerTextWrapper: {
    flex: 1,
    marginLeft: 3,
  },
  composerText: {
    fontSize: 12,
  },
});
