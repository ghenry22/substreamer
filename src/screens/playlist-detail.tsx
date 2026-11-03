import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from "@react-native-vector-icons/ionicons/static";
import { FlashList } from '@shopify/flash-list';
import { LIST_DRAW_DISTANCE } from '../constants/layout';
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
import { DetailScreenBackground } from '../components/DetailScreenBackground';
import { PlayAllButton, ShufflePlayButton } from '../components/DetailHeroButtons';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useDetailFetch } from '../hooks/useDetailFetch';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useTransitionComplete } from '../hooks/useTransitionComplete';
import { ensureCached, refreshCoverArt } from '../services/imageCacheService';
import { enqueuePlaylistDownload, syncCachedPlaylistTracks } from '../services/musicCacheService';
import { playTrack } from '../services/playerService';
import { updatePlaylistDetails, updatePlaylistOrder } from '../services/subsonicService';
import { shuffleArray } from '../utils/arrayHelpers';
import { authStore } from '../store/authStore';
import { moreOptionsStore } from '../store/moreOptionsStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { fetchPlaylistDetail } from '../services/detailFetchService';
import { getDb } from '../store/persistence/db';
import { getPlaylistDetail } from '../db/repository/details';
import { syncStatusStore } from '../store/syncStatusStore';
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
          albumId={item.albumId}
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

/**
 * Editable playlist properties shown in the edit-mode list header: name +
 * description + a public/private toggle. Name and description MUST stay UNCONTROLLED
 * (defaultValue + ref): a keystroke that re-renders the screen recomputes the parent's
 * `listHeader` useMemo and yanks input focus in the reorderable list. Memoized on
 * stable props so a track reorder doesn't re-render the form. Only the Switch is
 * controlled — one tap, and the uncontrolled inputs survive its re-render.
 */
const PlaylistEditHeader = memo(function PlaylistEditHeader({
  colors,
  initialName,
  initialComment,
  isPublic,
  onChangePublic,
  nameRef,
  commentRef,
  t,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  initialName: string;
  initialComment: string;
  isPublic: boolean;
  onChangePublic: (value: boolean) => void;
  nameRef: MutableRefObject<string>;
  commentRef: MutableRefObject<string>;
  t: (key: string) => string;
}) {
  return (
    <View style={styles.editHeaderForm}>
      <TextInput
        defaultValue={initialName}
        onChangeText={(v) => {
          nameRef.current = v;
        }}
        placeholder={t('playlistName')}
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.editInput,
          { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border },
        ]}
        returnKeyType="done"
      />
      <TextInput
        defaultValue={initialComment}
        onChangeText={(v) => {
          commentRef.current = v;
        }}
        placeholder={t('descriptionOptional')}
        placeholderTextColor={colors.textSecondary}
        multiline
        style={[
          styles.editInput,
          styles.editInputMultiline,
          { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border },
        ]}
      />
      <View style={styles.publicRow}>
        <View style={styles.publicText}>
          <Text style={[styles.publicLabel, { color: colors.textPrimary }]}>
            {t('publicPlaylist')}
          </Text>
          <Text style={[styles.publicHint, { color: colors.textSecondary }]}>
            {t('publicPlaylistHint')}
          </Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={onChangePublic}
          trackColor={{ false: colors.border, true: colors.primary }}
          accessibilityLabel={t('publicPlaylist')}
        />
      </View>
    </View>
  );
});

export function PlaylistDetailScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistWithSongs | null>(null);
  const [hasCache, setHasCache] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);
  // Read the cached detail from the local DB first (fast) — the server fetch only runs
  // on a genuine miss, so a re-open is instant. The server refresh dual-writes normalized.
  useEffect(() => {
    if (!id) return;
    const db = getDb();
    if (!db) {
      setCacheChecked(true);
      return;
    }
    let alive = true;
    getPlaylistDetail(db, id)
      .then((d) => {
        if (!alive) return;
        if (d) {
          setPlaylist((prev) => prev ?? ({ ...d.playlist, entry: d.entry } as PlaylistWithSongs));
          // "Cached" only if we actually have the tracks — a playlist ROW exists from the
          // list sync, but its membership (`playlist_songs`) is only populated by a detail
          // fetch. An empty entry ⇒ fetch from the server (fixes the "No tracks" flash).
          setHasCache(d.entry.length > 0);
        }
        setCacheChecked(true);
      })
      .catch(() => {
        if (alive) setCacheChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  const transitionComplete = useTransitionComplete();
  const downloadStatus = useDownloadStatus('playlist', Platform.OS === 'ios' ? (id ?? '') : '');
  const isWide = useLayoutMode() === 'wide';
  const refreshControlKey = useRefreshControlKey();

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const username = authStore((s) => s.username);
  const [editing, setEditing] = useState(false);
  const [editedTracks, setEditedTracks] = useState<Child[]>([]);
  const [editedPublic, setEditedPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  // Name + comment are ref-backed (uncontrolled inputs) so typing doesn't
  // re-render the screen / the reorderable-list header — see PlaylistEditHeader.
  const nameRef = useRef('');
  const commentRef = useRef('');

  // Ownership drives both the edit gate and the "Shared" badge. Case-insensitive
  // because Subsonic usernames are commonly case-insensitive server-side (login
  // `Greg` vs stored `greg` must still count as own). Unknown owner ⇒ treat as own.
  const isOwn =
    playlist?.owner == null ||
    playlist.owner.toLowerCase() === (username ?? '').toLowerCase();
  const canEdit = !offlineMode && isOwn;

  /* ---- Data fetching ---- */
  const load = useCallback(async (playlistId: string, isRefresh: boolean) => {
    // See album-detail: local answers a normal open, pull-to-refresh forces the server.
    const data = await fetchPlaylistDetail(playlistId, { force: isRefresh });
    setPlaylist(data);
    if (isRefresh && data?.id) {
      refreshCoverArt(data.id, 'playlist-detail-pull').catch(() => { /* non-critical */ });
    }
    return data ? null : t('playlistNotFound');
  }, [t]);

  const { loading, refreshing, error, onRefresh } = useDetailFetch({
    id,
    hasCache,
    cacheChecked,
    missingIdMessage: t('missingPlaylistId'),
    failedMessage: t('failedToLoadPlaylist'),
    load,
  });

  const tracks = useMemo(() => playlist?.entry ?? [], [playlist?.entry]);

  /* ---- Edit mode handlers ---- */

  const handleStartEdit = useCallback(() => {
    setEditedTracks([...tracks]);
    nameRef.current = playlist?.name ?? '';
    commentRef.current = playlist?.comment ?? '';
    setEditedPublic(!!playlist?.public);
    setEditing(true);
  }, [tracks, playlist]);

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

    const name = nameRef.current.trim();
    // Empty string is a real "clear the comment" — do NOT coalesce to undefined.
    const comment = commentRef.current;
    if (!name) {
      processingOverlayStore.getState().showError(t('pleaseEnterPlaylistName'));
      return;
    }

    const originalIds = tracks.map((tr) => tr.id).join(',');
    const editedIds = editedTracks.map((tr) => tr.id).join(',');
    const tracksChanged = originalIds !== editedIds;
    // Normalize both sides so trailing space / undefined don't flag phantom edits.
    const propsChanged =
      name !== playlist.name.trim() ||
      comment !== (playlist.comment ?? '') ||
      editedPublic !== !!playlist.public;

    if (!tracksChanged && !propsChanged) {
      setEditing(false);
      setEditedTracks([]);
      return;
    }

    setSaving(true);
    processingOverlayStore.getState().show(t('saving'));
    try {
      // 1. Track order/membership (full replace). Stay in edit mode on failure.
      if (tracksChanged) {
        const replaceOk = await updatePlaylistOrder(
          id,
          name,
          editedTracks.map((tr) => tr.id),
        );
        if (!replaceOk) {
          processingOverlayStore.getState().showError(t('failedToSavePlaylist'));
          setSaving(false);
          return;
        }
        if (id in musicCacheStore.getState().cachedItems) {
          // The user's own edit may legitimately remove every track, so it opts out of
          // the empty/zero-overlap guard that protects against a suspect server answer.
          syncCachedPlaylistTracks(id, editedTracks.map((tr) => tr.id), { allowFullClear: true });
        }
      }

      // 2. Properties. Run AFTER the replace so it re-asserts name/comment/public
      //    (some servers reset those when createPlaylist replaces the tracks).
      let detailsOk = true;
      if (tracksChanged || propsChanged) {
        detailsOk = await updatePlaylistDetails(id, {
          name,
          comment,
          public: editedPublic,
        });
      }

      // Nothing persisted (only props were requested and they failed) — stay in
      // edit mode so the user can retry without losing their input.
      if (!detailsOk && !tracksChanged) {
        processingOverlayStore.getState().showError(t('failedToSavePlaylist'));
        setSaving(false);
        return;
      }

      // 3. Reconcile from server truth; patch the library list from the refetched
      //    values so it reflects reality even on a partial (tracks-ok/props-failed) save.
      const fresh = await fetchPlaylistDetail(id, { force: true });
      if (fresh?.id) {
        await ensureCached(fresh.id);
      }
      if (fresh) {
        setPlaylist(fresh);
        // `fetchPlaylistDetail` already upserted the normalized row every list reads
        // from; the car browse tree renders the name, so signal it too.
        syncStatusStore.getState().bumpLibraryUpdated();
      }

      setEditing(false);
      setEditedTracks([]);
      if (detailsOk) {
        processingOverlayStore.getState().showSuccess(t('playlistSaved'));
      } else {
        // Tracks were replaced but the property write failed.
        processingOverlayStore.getState().showError(t('playlistTracksSavedPropsFailed'));
      }
    } catch {
      processingOverlayStore.getState().showError(t('failedToSavePlaylist'));
    } finally {
      setSaving(false);
    }
  }, [playlist, id, tracks, editedTracks, editedPublic, t]);

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
            {canEdit && (
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
    canEdit,
    handleStartEdit,
    handleCancelEdit,
    handleSave,
  ]);

  /* ---- Normal-mode renderItem ---- */

  const renderItem = useCallback(
    ({ item }: { item: Child; index: number }) => (
      <View style={styles.trackItemWrap}>
        {/* Playlist tracks omit the position number: the cover thumbnail anchors the */}
        {/* row, and the number costs ~28px of the title column. Album-detail keeps */}
        {/* numbers because its tracks share one cover and carry no per-row thumbnail. */}
        <TrackRow
          track={item}
          colors={colors}
          songs={tracks}
          playlistId={id}
          showCoverArt
          showAlbumName
          optionsSource="playlist-detail"
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
    if (!playlist) return undefined;
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
          {editing ? (
            <PlaylistEditHeader
              colors={colors}
              initialName={playlist.name}
              initialComment={playlist.comment ?? ''}
              isPublic={editedPublic}
              onChangePublic={setEditedPublic}
              nameRef={nameRef}
              commentRef={commentRef}
              t={t}
            />
          ) : (
            <MarqueeText style={[styles.playlistName, { color: colors.textPrimary }]}>
              {playlist.name}
            </MarqueeText>
          )}
          <View style={styles.subtitleRow}>
            <View style={styles.subtitleText}>
              {!editing &&
                (!isOwn ? (
                  <View style={styles.sharedBadge}>
                    <Ionicons name="people-outline" size={13} color={colors.primary} />
                    <Text style={[styles.sharedBadgeText, { color: colors.primary }]}>
                      {t('sharedByOwner', { owner: playlist.owner })}
                    </Text>
                  </View>
                ) : typeof playlist.public === 'boolean' ? (
                  // Owner's own playlist: show its current visibility so it's
                  // clear without opening edit mode. Only when the server
                  // actually reported `public` — never guess "Private".
                  <View style={styles.sharedBadge}>
                    <Ionicons
                      name={playlist.public ? 'globe-outline' : 'lock-closed-outline'}
                      size={13}
                      color={colors.primary}
                    />
                    <Text style={[styles.sharedBadgeText, { color: colors.primary }]}>
                      {playlist.public ? t('publicPlaylist') : t('privatePlaylist')}
                    </Text>
                  </View>
                ) : (
                  playlist.owner && (
                    <Text style={[styles.ownerName, { color: colors.textSecondary }]}>
                      {t('byOwner', { owner: playlist.owner })}
                    </Text>
                  )
                ))}
              {!editing && playlist.comment ? (
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
              <ShufflePlayButton
                style={styles.heroButtonSpacing}
                onPress={() => {
                  const shuffled = shuffleArray(displayTracks);
                  playTrack(shuffled[0], shuffled, id);
                }}
              />
            )}
            {!editing && displayTracks.length > 0 && (
              <PlayAllButton
                style={styles.heroButtonSpacing}
                onPress={() => playTrack(displayTracks[0], displayTracks, id)}
              />
            )}
          </View>
        </View>
        <View style={styles.trackListSpacer} />
      </View>
    );
  }, [playlist, colors, tracks, editing, editedTracks, editedPublic, isOwn, t]);

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

  // paddingTop on both platforms, never contentInset+contentOffset: Fabric recycles
  // RCTScrollViewComponentView across screen pushes and ignores contentOffset on a
  // recycled instance, leaving the hero partly scrolled off the top.
  // See album-detail.tsx.
  const listContentStyle = {
    paddingTop: insets.top + HEADER_BAR_HEIGHT,
    paddingBottom: 32,
  };

  return (
    <>
      {Platform.OS === 'ios' && !editing && playlist && id && (
        <Stack.Toolbar placement="right">
          {canEdit && (
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
        <DetailScreenBackground coverArt={playlist?.coverArt} isWide={isWide} />

      {editing ? (
        <ReorderableList
          data={editedTracks}
          renderItem={renderEditItem}
          keyExtractor={keyExtractor}
          onReorder={handleReorder}
          onScrollBeginDrag={closeOpenRow}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
        />
      ) : (
        <FlashList
          data={tracks}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          drawDistance={LIST_DRAW_DISTANCE}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
          refreshControl={
            offlineMode ? undefined : (
              <RefreshControl
                key={refreshControlKey}
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
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
  heroButtonSpacing: {
    marginLeft: 10,
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
  sharedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  sharedBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  editHeaderForm: {
    marginBottom: 4,
  },
  editInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  editInputMultiline: {
    minHeight: 68,
    textAlignVertical: 'top',
  },
  publicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  publicText: {
    flex: 1,
  },
  publicLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  publicHint: {
    fontSize: 12,
    marginTop: 2,
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
    // No padding here — see album-detail trackItemWrap for the rationale.
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
