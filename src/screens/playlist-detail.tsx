import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { CachedImage } from '../components/CachedImage';
import { EmptyState } from '../components/EmptyState';
import { DownloadButton } from '../components/DownloadButton';
import { MarqueeText } from '../components/MarqueeText';
import { BottomChrome } from '../components/BottomChrome';
import { MoreOptionsButton } from '../components/MoreOptionsButton';
import { closeOpenRow, SwipeableRow, type SwipeAction } from '../components/SwipeableRow';
import { TrackRow } from '../components/TrackRow';
import {
  DARK_MIX,
  GRADIENT_LOCATIONS,
  GRADIENT_MIX_CURVE,
  LIGHT_MIX,
} from '../components/GradientBackground';
import { SKIP_COLOR_EXTRACTION, useImagePalette } from '../hooks/useImagePalette';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { mixHexColors } from '../utils/colors';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { cacheAllSizes, refreshCachedImage } from '../services/imageCacheService';
import { enqueuePlaylistDownload, syncCachedPlaylistTracks } from '../services/musicCacheService';
import { playTrack } from '../services/playerService';
import { updatePlaylistOrder } from '../services/subsonicService';
import { shuffleArray } from '../utils/arrayHelpers';
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

const EditTrackRow = memo(function EditTrackRow({
  item,
  index,
  colors,
  onDelete,
}: {
  item: Child;
  index: number;
  colors: ReturnType<typeof useTheme>['colors'];
  onDelete: (index: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useReorderableDrag();

  const handleDelete = useCallback(() => onDelete(index), [onDelete, index]);

  const rightActions: SwipeAction[] = useMemo(
    () => [
      {
        icon: 'trash-outline',
        color: colors.red,
        label: t('remove'),
        onPress: handleDelete,
        removesRow: true,
      },
    ],
    [colors.red, handleDelete, t],
  );

  return (
    <SwipeableRow
      rightActions={rightActions}
      enableFullSwipeRight
      restingBackgroundColor={colors.background}
    >
      <View style={[styles.editRow, { borderBottomColor: colors.border }]}>
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
            {item.artist ?? t('unknownArtist')}
          </Text>
        </View>

        <Pressable onPressIn={drag} hitSlop={8} style={styles.editDragHandle}>
          <Ionicons name="reorder-three" size={28} color={colors.textSecondary} />
        </Pressable>
      </View>
    </SwipeableRow>
  );
});

export function PlaylistDetailScreen() {
  const { t } = useTranslation();
  const { colors, theme } = useTheme();
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
  const isWide = useLayoutMode() === 'wide';
  const refreshControlKey = useRefreshControlKey();

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const [editing, setEditing] = useState(false);
  const [editedTracks, setEditedTracks] = useState<Child[]>([]);
  const [saving, setSaving] = useState(false);

  const { primary, secondary, gradientOpacity } = useImagePalette(
    isWide ? SKIP_COLOR_EXTRACTION : playlist?.coverArt,
  );

  const themeGradientColors = useMemo(() => {
    if (!isWide) return null;
    const peak = theme === 'dark' ? DARK_MIX : LIGHT_MIX;
    return GRADIENT_MIX_CURVE.map((m) =>
      mixHexColors(colors.background, colors.primary, peak * m),
    ) as [string, string, ...string[]];
  }, [isWide, theme, colors.primary, colors.background]);

  /* ---- Data fetching ---- */
  const { fetchPlaylist } = playlistDetailStore.getState();

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) {
      setError(t('missingPlaylistId'));
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
      if (!data) setError(t('playlistNotFound'));
      if (isRefresh && data?.coverArt) {
        refreshCachedImage(data.coverArt).catch(() => { /* non-critical */ });
      }
      await delay;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadPlaylist'));
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

  const handleReorder = useCallback(({ from, to }: ReorderableListReorderEvent) => {
    setEditedTracks((prev) => reorderItems(prev, from, to));
  }, []);

  const handleDeleteTrack = useCallback(
    (index: number) => {
      setEditedTracks((prev) => prev.filter((_, i) => i !== index));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!playlist || !id) return;

    const originalIds = tracks.map((tr) => tr.id).join(',');
    const editedIds = editedTracks.map((tr) => tr.id).join(',');
    if (originalIds === editedIds) {
      setEditing(false);
      setEditedTracks([]);
      return;
    }

    setSaving(true);
    processingOverlayStore.getState().show(t('saving'));
    try {
      const success = await updatePlaylistOrder(
        id,
        playlist.name,
        editedTracks.map((tr) => tr.id),
      );
      if (!success) {
        processingOverlayStore.getState().showError(t('failedToSavePlaylist'));
        setSaving(false);
        return;
      }

      if (id in musicCacheStore.getState().cachedItems) {
        syncCachedPlaylistTracks(id, editedTracks.map((tr) => tr.id));
      }

      const fresh = await fetchPlaylist(id);
      if (fresh?.coverArt) {
        await cacheAllSizes(fresh.coverArt);
      }
      if (fresh) setPlaylist(fresh);

      setEditing(false);
      setEditedTracks([]);
      processingOverlayStore.getState().showSuccess(t('playlistSaved'));
    } catch {
      processingOverlayStore.getState().showError(t('failedToSavePlaylist'));
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
              {t('cancel')}
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
                {t('save')}
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
          onPress={() => playTrack(item, tracks, id)}
          showCoverArt
          showAlbumName
        />
      </View>
    ),
    [colors, tracks],
  );

  /* ---- Edit-mode renderItem ---- */

  const renderEditItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <EditTrackRow
        item={item}
        index={index}
        colors={colors}
        onDelete={handleDeleteTrack}
      />
    ),
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
      ? editedTracks.reduce((sum, tr) => sum + (tr.duration ?? 0), 0)
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
          <MarqueeText style={[styles.playlistName, { color: colors.textPrimary }]}>
            {playlist.name}
          </MarqueeText>
          <View style={styles.subtitleRow}>
            <View style={styles.subtitleText}>
              {playlist.owner && (
                <Text style={[styles.ownerName, { color: colors.textSecondary }]}>
                  {t('byOwner', { owner: playlist.owner })}
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
                  {t('songCount', { count: songCount })}
                </Text>
                <View style={styles.metaSpacer} />
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  {formatCompactDuration(duration)}
                </Text>
              </View>
            </View>
            {!editing && displayTracks.length > 1 && (
              <Pressable
                onPress={() => {
                  const shuffled = shuffleArray(displayTracks);
                  playTrack(shuffled[0], shuffled, id);
                }}
                style={({ pressed }) => [
                  styles.shufflePlayButton,
                  pressed && styles.shufflePlayButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('shufflePlay')}
              >
                <Ionicons name="shuffle" size={18} color="#000" />
              </Pressable>
            )}
            {!editing && displayTracks.length > 0 && (
              <Pressable
                onPress={() => playTrack(displayTracks[0], displayTracks, id)}
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
        </View>
        <View style={styles.trackListSpacer} />
      </View>
    );
  }, [playlist, colors, tracks, editing, editedTracks, t]);

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyTracks}>
        <Text style={[styles.emptyTracksTitle, { color: colors.textPrimary }]}>
          {t('noTracks')}
        </Text>
        <Text style={[styles.emptyTracksSubtitle, { color: colors.textSecondary }]}>
          {t('noTracksPlaylistSubtitle')}
        </Text>
      </View>
    ),
    [colors.textPrimary, colors.textSecondary, t],
  );

  // 2-stop gradient: extracted secondary (prefer) → theme background.
  // On smaller screens the richer 3-stop bi-tone read as too busy over
  // the hero, so we drop the more-vibrant `primary` from the render and
  // use `secondary` (the most-common hue distinct from primary) as the
  // calmer top colour. `primary` still extracts and is available in the
  // hook for future tablet/landscape layouts with more room.
  const gradientTopColor = secondary ?? primary ?? colors.background;
  const gradientColors: readonly [string, string, ...string[]] = [gradientTopColor, colors.background];
  const gradientLocations: readonly [number, number, ...number[]] = [0, 0.5];

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
        <EmptyState
          icon="list-outline"
          title={t('couldntLoadPlaylist')}
          subtitle={`${t('loadPlaylistError')}\n\n${error ?? t('unknownError')}`}
        />
      </View>
    );
  }

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
            <Stack.Toolbar.Button onPress={handleCancelEdit}>{t('cancel')}</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button onPress={handleSave} disabled={saving}>{t('save')}</Stack.Toolbar.Button>
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
          colors={gradientColors}
          locations={gradientLocations}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
        {themeGradientColors && (
          <LinearGradient
            colors={themeGradientColors}
            locations={[...GRADIENT_LOCATIONS]}
            style={gradientFillStyle}
            pointerEvents="none"
          />
        )}

      {editing ? (
        <ReorderableList
          data={editedTracks}
          renderItem={renderEditItem}
          keyExtractor={keyExtractor}
          onReorder={handleReorder}
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
                key={refreshControlKey}
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={Platform.OS === 'android' ? insets.top + HEADER_BAR_HEIGHT : 0}
              />
            )
          }
        />
      )}
        <BottomChrome withSafeAreaPadding />
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
    maxWidth: 448,
    alignSelf: 'center',
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
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
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
    fontSize: 16,
    fontWeight: '400',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  subtitleText: {
    flex: 1,
  },
  shufflePlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginLeft: 10,
  },
  shufflePlayButtonPressed: {
    opacity: 0.7,
  },
  playAllButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
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
    fontSize: 16,
    textAlign: 'center',
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
    fontSize: 16,
    fontWeight: '600',
  },
  editTrackArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  editDragHandle: {
    width: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
