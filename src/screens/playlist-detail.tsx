import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DraggableFlatList, {
  ScaleDecorator,
  ShadowDecorator,
  type RenderItemParams,
  type DragEndParams,
} from 'react-native-draggable-flatlist';

import { CachedImage } from '../components/CachedImage';
import { DownloadButton } from '../components/DownloadButton';
import { MarqueeText } from '../components/MarqueeText';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { closeOpenRow, SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import { useColorExtraction } from '../hooks/useColorExtraction';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { cacheAllSizes, refreshCachedImage } from '../services/imageCacheService';
import { enqueuePlaylistDownload, syncCachedPlaylistTracks } from '../services/musicCacheService';
import { playTrack } from '../services/playerService';
import { updatePlaylistOrder } from '../services/subsonicService';
import { minDelay } from '../utils/stringHelpers';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { processingOverlayStore } from '../store/processingOverlayStore';

import { formatCompactDuration } from '../utils/formatters';

import { type Child, type PlaylistWithSongs } from '../services/subsonicService';

const HERO_PADDING = 24;
const HERO_COVER_SIZE = 600;
const HEADER_BAR_HEIGHT = 44;
const EDIT_ROW_HEIGHT = 64;

export function PlaylistDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedEntry = playlistDetailStore((s) => (id ? s.playlists[id] : undefined));
  const [playlist, setPlaylist] = useState<PlaylistWithSongs | null>(cachedEntry?.playlist ?? null);
  const [loading, setLoading] = useState(!cachedEntry);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transitionComplete = useTransitionComplete();
  const downloadStatus = useDownloadStatus('playlist', Platform.OS === 'ios' ? (id ?? '') : '');

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const [editing, setEditing] = useState(false);
  const [editedTracks, setEditedTracks] = useState<Child[]>([]);
  const [saving, setSaving] = useState(false);

  const { coverBackgroundColor, gradientOpacity } = useColorExtraction(
    playlist?.coverArt,
    colors.background,
  );

  /* ---- Data fetching ---- */
  const { fetchPlaylist } = playlistDetailStore.getState();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError('Missing playlist id');
      if (!isRefresh) setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const delay = isRefresh ? minDelay() : null;
      const data = await fetchPlaylist(id);
      setPlaylist(data);
      if (!data) setError('Playlist not found');
      if (isRefresh && data?.coverArt) {
        refreshCachedImage(data.coverArt).catch(() => { /* non-critical */ });
      }
      await delay;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load playlist');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [id, fetchPlaylist]);

  useEffect(() => { if (!cachedEntry) fetchData(); }, [fetchData, cachedEntry]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const tracks = useMemo(() => playlist?.entry ?? [], [playlist?.entry]);

  /* ---- Edit mode handlers ---- */

  const handleStartEdit = useCallback(() => {
    setEditedTracks([...tracks]);
    setEditing(true);
  }, [tracks]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditedTracks([]);
  }, []);

  const handleReorder = useCallback(({ data }: DragEndParams<Child>) => {
    setEditedTracks(data);
  }, []);

  const handleDeleteTrack = useCallback(
    (index: number) => {
      setEditedTracks((prev) => prev.filter((_, i) => i !== index));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!playlist || !id) return;

    const originalIds = tracks.map((t) => t.id).join(',');
    const editedIds = editedTracks.map((t) => t.id).join(',');
    if (originalIds === editedIds) {
      setEditing(false);
      setEditedTracks([]);
      return;
    }

    setSaving(true);
    processingOverlayStore.getState().show('Saving…');
    try {
      const success = await updatePlaylistOrder(
        id,
        playlist.name,
        editedTracks.map((t) => t.id),
      );
      if (!success) {
        processingOverlayStore.getState().showError('Failed to save playlist');
        setSaving(false);
        return;
      }

      if (id in musicCacheStore.getState().cachedItems) {
        syncCachedPlaylistTracks(id, editedTracks.map((t) => t.id));
      }

      const fresh = await fetchPlaylist(id);
      if (fresh?.coverArt) {
        await cacheAllSizes(fresh.coverArt);
      }
      if (fresh) setPlaylist(fresh);

      setEditing(false);
      setEditedTracks([]);
      processingOverlayStore.getState().showSuccess('Playlist Saved');
    } catch {
      processingOverlayStore.getState().showError('Failed to save playlist');
    } finally {
      setSaving(false);
    }
  }, [playlist, id, tracks, editedTracks, fetchPlaylist]);

  /* ---- Header ---- */

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (!playlist || !id) return;

    if (editing) {
      navigation.setOptions({
        headerLeft: () => (
          <Pressable onPress={handleCancelEdit} hitSlop={8}>
            <Text style={[styles.headerButtonText, { color: colors.textPrimary }]}>
              Cancel
            </Text>
          </Pressable>
        ),
        headerRight: () => (
          <Pressable onPress={handleSave} disabled={saving} hitSlop={8} style={{ opacity: 1 }}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text
                style={[
                  styles.headerButtonText,
                  { color: colors.textPrimary, fontWeight: '700' },
                ]}
              >
                Save
              </Text>
            )}
          </Pressable>
        ),
      });
    } else {
      navigation.setOptions({
        headerLeft: undefined,
        headerRight: () => (
          <View style={styles.headerRight}>
            {!offlineMode && (
              <Pressable onPress={handleStartEdit} hitSlop={8} style={styles.headerIcon}>
                <Ionicons name="pencil-outline" size={22} color={colors.textPrimary} />
              </Pressable>
            )}
            <DownloadButton itemId={id} type="playlist" />
            <MoreOptionsButton
              onPress={() =>
                moreOptionsStore.getState().show({ type: 'playlist', item: playlist })
              }
              color={colors.textPrimary}
            />
          </View>
        ),
      });
    }
  }, [
    playlist,
    id,
    navigation,
    colors.textPrimary,
    colors.primary,
    editing,
    saving,
    offlineMode,
    handleStartEdit,
    handleCancelEdit,
    handleSave,
  ]);

  /* ---- Normal-mode renderItem ---- */

  const renderItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <View style={styles.trackItemWrap}>
        <TrackRow
          track={item}
          trackNumber={`${index + 1}. `}
          colors={colors}
          onPress={() => playTrack(item, tracks)}
          showCoverArt
          showAlbumName
        />
      </View>
    ),
    [colors, tracks],
  );

  /* ---- Edit-mode renderItem ---- */

  const renderEditItem = useCallback(
    ({ item, getIndex, drag }: RenderItemParams<Child>) => {
      const index = getIndex() ?? 0;
      const rightActions: SwipeAction[] = [
        { icon: 'trash-outline', color: colors.red, label: 'Remove', onPress: () => handleDeleteTrack(index), removesRow: true },
      ];
      return (
        <ScaleDecorator activeScale={1.03}>
          <ShadowDecorator>
            <SwipeableRow rightActions={rightActions} enableFullSwipeRight>
              <View
                style={[
                  styles.editRow,
                  { borderBottomColor: colors.border, backgroundColor: colors.background },
                ]}
              >
                <CachedImage
                  coverArtId={item.coverArt}
                  size={300}
                  style={styles.editCover}
                  resizeMode="cover"
                />

                <View style={styles.editTrackInfo}>
                  <Text
                    style={[styles.editTrackTitle, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {index + 1}. {item.title}
                  </Text>
                  <Text
                    style={[styles.editTrackArtist, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {item.artist ?? 'Unknown Artist'}
                  </Text>
                </View>

                <Pressable onPressIn={drag} hitSlop={8} style={styles.editDragHandle}>
                  <Ionicons name="reorder-three" size={28} color={colors.textSecondary} />
                </Pressable>
              </View>
            </SwipeableRow>
          </ShadowDecorator>
        </ScaleDecorator>
      );
    },
    [colors, handleDeleteTrack],
  );

  const keyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  /* ---- List header ---- */

  const listHeader = useMemo(() => {
    if (!playlist) return null;
    const displayTracks = editing ? editedTracks : tracks;
    const songCount = editing ? editedTracks.length : playlist.songCount;
    const duration = editing
      ? editedTracks.reduce((sum, t) => sum + (t.duration ?? 0), 0)
      : playlist.duration;

    return (
      <View>
        <View style={styles.hero}>
          <View style={styles.heroImageWrap}>
            <CachedImage
              coverArtId={playlist.coverArt}
              size={HERO_COVER_SIZE}
              style={styles.heroImage}
              resizeMode="contain"
            />
          </View>
        </View>
        <View style={styles.info}>
          <View style={styles.infoText}>
            <MarqueeText style={[styles.playlistName, { color: colors.textPrimary }]}>
              {playlist.name}
            </MarqueeText>
            {playlist.owner && (
              <Text style={[styles.ownerName, { color: colors.textSecondary }]}>
                by {playlist.owner}
              </Text>
            )}
            {playlist.comment ? (
              <Text style={[styles.comment, { color: colors.textSecondary }]}>
                {playlist.comment}
              </Text>
            ) : null}
            <View style={styles.meta}>
              <Ionicons name="musical-notes-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {songCount} {songCount === 1 ? 'song' : 'songs'}
              </Text>
              <View style={styles.metaSpacer} />
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {formatCompactDuration(duration)}
              </Text>
            </View>
          </View>
          {!editing && displayTracks.length > 0 && (
            <Pressable
              onPress={() => playTrack(displayTracks[0], displayTracks)}
              style={({ pressed }) => [
                styles.playAllButton,
                { backgroundColor: colors.primary },
                pressed && styles.playAllButtonPressed,
              ]}
            >
              <Ionicons name="play" size={28} color="#fff" style={styles.playAllIcon} />
            </Pressable>
          )}
        </View>
        <View style={styles.trackListSpacer} />
      </View>
    );
  }, [playlist, colors, tracks, editing, editedTracks]);

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyTracks}>
        <Text style={[styles.emptyTracksTitle, { color: colors.textPrimary }]}>
          No tracks
        </Text>
        <Text style={[styles.emptyTracksSubtitle, { color: colors.textSecondary }]}>
          When you add tracks to this playlist they will appear here. If you already have tracks, check your server is reachable and pull to refresh.
        </Text>
      </View>
    ),
    [colors.textPrimary, colors.textSecondary],
  );

  const gradientStart = coverBackgroundColor ?? colors.background;

  const gradientAnimatedStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  if (loading || !transitionComplete) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !playlist) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error ?? 'Playlist not found'}
        </Text>
      </View>
    );
  }

  const gradientEnd = colors.background;

  const gradientFillStyle = [
    StyleSheet.absoluteFillObject,
    { top: -insets.top, left: 0, right: 0, bottom: 0 },
  ];

  const listContentStyle = {
    paddingBottom: 32,
    ...(Platform.OS !== 'ios' ? { paddingTop: insets.top + HEADER_BAR_HEIGHT } : undefined),
  };

  const iosInset =
    Platform.OS === 'ios' ? { top: insets.top + HEADER_BAR_HEIGHT } : undefined;
  const iosOffset =
    Platform.OS === 'ios'
      ? { x: 0, y: -(insets.top + HEADER_BAR_HEIGHT) }
      : undefined;

  return (
    <>
      {Platform.OS === 'ios' && !editing && playlist && id && (
        <Stack.Toolbar placement="right">
          {!offlineMode && (
            <Stack.Toolbar.Button icon="pencil" onPress={handleStartEdit} />
          )}
          {downloadStatus === 'none' ? (
            <Stack.Toolbar.Button
              icon="arrow.down.circle"
              onPress={() => enqueuePlaylistDownload(id)}
            />
          ) : (
            <Stack.Toolbar.View>
              <DownloadButton itemId={id} type="playlist" />
            </Stack.Toolbar.View>
          )}
          <Stack.Toolbar.Button
            icon="ellipsis"
            onPress={() => moreOptionsStore.getState().show({ type: 'playlist', item: playlist })}
          />
        </Stack.Toolbar>
      )}
      {Platform.OS === 'ios' && editing && (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button onPress={handleCancelEdit}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button onPress={handleSave} disabled={saving}>Save</Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      )}
      <View style={styles.container}>
        <View style={[gradientFillStyle, { backgroundColor: colors.background }]} />
      <Animated.View
        style={[gradientFillStyle, gradientAnimatedStyle]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[gradientStart, gradientEnd]}
          locations={[0, 0.5]}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      {editing ? (
        <DraggableFlatList
          data={editedTracks}
          renderItem={renderEditItem}
          keyExtractor={keyExtractor}
          onDragEnd={handleReorder}
          onScrollBeginDrag={closeOpenRow}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
          contentInset={iosInset}
          contentOffset={iosOffset}
        />
      ) : (
        <FlashList
          data={tracks}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
          contentInset={iosInset}
          contentOffset={iosOffset}
          refreshControl={
            offlineMode ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
              />
            )
          }
        />
      )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    paddingTop: HERO_PADDING / 2,
    paddingHorizontal: HERO_PADDING,
    paddingBottom: HERO_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(128,128,128,0.12)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  infoText: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    padding: 4,
    marginLeft: 4,
    marginRight: 4,
    opacity: 1,
  },
  headerButtonText: {
    fontSize: 17,
    fontWeight: '400',
  },
  playAllButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  playAllButtonPressed: {
    opacity: 0.7,
  },
  playAllIcon: {
    marginLeft: 3,
  },
  playlistName: {
    fontSize: 24,
    fontWeight: '700',
  },
  ownerName: {
    fontSize: 16,
    marginTop: 4,
  },
  comment: {
    fontSize: 14,
    marginTop: 6,
    fontStyle: 'italic',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  metaText: {
    fontSize: 14,
    marginLeft: 4,
  },
  metaSpacer: {
    width: 14,
  },
  trackItemWrap: {
    paddingHorizontal: 16,
  },
  trackListSpacer: {
    height: 8,
  },
  emptyTracks: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  emptyTracksTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyTracksSubtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
  },

  /* ---- Edit mode ---- */
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: EDIT_ROW_HEIGHT,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.12)',
    marginRight: 10,
  },
  editTrackInfo: {
    flex: 1,
    minWidth: 0,
  },
  editTrackTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  editTrackArtist: {
    fontSize: 13,
    marginTop: 2,
  },
  editDragHandle: {
    width: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
