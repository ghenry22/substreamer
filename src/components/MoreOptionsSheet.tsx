/**
 * MoreOptionsSheet – unified bottom sheet for all entity types.
 *
 * Reads from `moreOptionsStore` and renders entity-specific options:
 *   - Song/Track: Favorite, Add to Playlist, Play More Like This, Add to Queue, Go to Album, Go to Artist
 *   - Album: Favorite, Add to Queue, Go to Artist, Album Details
 *   - Artist: Favorite, Save Top Songs Playlist, Play Similar Artists
 *   - Playlist: Add to Queue
 *
 * Rendered once at the root layout level.
 */

import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumDetailsModal } from './AlbumDetailsModal';
import { useDownloadStatus, type DownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import {
  addAlbumToQueue,
  addPlaylistToQueue,
  addSongToQueue,
  cancelDownload,
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
  playMoreLikeThis,
  playSimilarArtistsMix,
  removeDownload,
  saveArtistTopSongsPlaylist,
  toggleStar,
} from '../services/moreOptionsService';
import { deleteCachedItem } from '../services/musicCacheService';
import {
  deletePlaylist,
  type AlbumID3,
  type Child,
  type Playlist,
} from '../services/subsonicService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { createShareStore } from '../store/createShareStore';
import { musicCacheStore } from '../store/musicCacheStore';
import {
  moreOptionsStore,
  type MoreOptionsEntity,
} from '../store/moreOptionsStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playerStore } from '../store/playerStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { processingOverlayStore } from '../store/processingOverlayStore';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getTitle(entity: MoreOptionsEntity): string {
  switch (entity.type) {
    case 'song':
      return entity.item.title ?? 'Unknown Song';
    case 'album':
      return `${entity.item.name}${entity.item.year ? ` (${entity.item.year})` : ''}`;
    case 'artist':
      return entity.item.name;
    case 'playlist':
      return entity.item.name;
  }
}

function getSubtitle(entity: MoreOptionsEntity): string {
  switch (entity.type) {
    case 'song':
      return entity.item.artist ?? 'Unknown Artist';
    case 'album':
      return entity.item.artist ?? (entity.item as AlbumID3).displayArtist ?? 'Unknown Artist';
    case 'artist': {
      const count = entity.item.albumCount;
      return count === 1 ? '1 album' : `${count ?? 0} albums`;
    }
    case 'playlist': {
      const sc = entity.item.songCount;
      return sc === 1 ? '1 track' : `${sc ?? 0} tracks`;
    }
  }
}

function isStarrable(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song' || entity.type === 'album' || entity.type === 'artist';
}

function hasArtistLink(entity: MoreOptionsEntity): boolean {
  if (entity.type === 'song') return Boolean(entity.item.artistId);
  if (entity.type === 'album') return Boolean(entity.item.artistId);
  return false;
}

function hasAlbumLink(entity: MoreOptionsEntity): boolean {
  if (entity.type === 'song') return Boolean(entity.item.albumId);
  return false;
}

function canAddToQueue(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song' || entity.type === 'album' || entity.type === 'playlist';
}

function hasAlbumDetails(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album';
}

function canShare(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album' || entity.type === 'playlist';
}

function canDownload(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album' || entity.type === 'playlist';
}

function canAddToPlaylist(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song' || entity.type === 'album';
}

function canDeletePlaylist(entity: MoreOptionsEntity): boolean {
  return entity.type === 'playlist';
}

function canPlayMoreLikeThis(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song';
}

function canPlaySimilarArtistsMix(entity: MoreOptionsEntity): boolean {
  return entity.type === 'artist';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MoreOptionsSheet() {
  const visible = moreOptionsStore((s) => s.visible);
  const entity = moreOptionsStore((s) => s.entity);
  const source = moreOptionsStore((s) => s.source);
  const hide = moreOptionsStore((s) => s.hide);

  const starType: 'song' | 'album' | 'artist' =
    entity?.type === 'album' || entity?.type === 'artist' ? entity.type : 'song';
  const starred = useIsStarred(starType, entity?.item.id ?? '');

  const downloadType: 'album' | 'playlist' =
    entity?.type === 'playlist' ? 'playlist' : 'album';
  const downloadStatus: DownloadStatus = useDownloadStatus(
    downloadType,
    entity && canDownload(entity) ? entity.item.id : '',
  );

  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsAlbum, setDetailsAlbum] = useState<AlbumID3 | null>(null);

  const handleClose = useCallback(() => {
    hide();
  }, [hide]);

  /* ---- Actions ---- */

  const handleToggleStar = useCallback(async () => {
    if (!entity || busy) return;
    if (!isStarrable(entity)) return;
    setBusy(true);
    try {
      await toggleStar(entity.type as 'song' | 'album' | 'artist', entity.item.id);
    } catch {
      // Silently fail
    } finally {
      setBusy(false);
      handleClose();
    }
  }, [entity, busy, handleClose]);

  const handleAddToPlaylist = useCallback(() => {
    if (!entity) return;
    handleClose();
    setTimeout(() => {
      if (entity.type === 'song') {
        addToPlaylistStore.getState().showSong(entity.item as Child);
      } else if (entity.type === 'album') {
        addToPlaylistStore.getState().showAlbum(entity.item as AlbumID3);
      }
    }, 300);
  }, [entity, handleClose]);

  const handleSaveTopSongsPlaylist = useCallback(() => {
    if (!entity || entity.type !== 'artist') return;
    handleClose();
    saveArtistTopSongsPlaylist(entity.item);
  }, [entity, handleClose]);

  const handlePlayMoreLikeThis = useCallback(() => {
    if (!entity || entity.type !== 'song') return;
    handleClose();
    playMoreLikeThis(entity.item as Child);
  }, [entity, handleClose]);

  const handlePlaySimilarArtistsMix = useCallback(() => {
    if (!entity || entity.type !== 'artist') return;
    handleClose();
    playSimilarArtistsMix(entity.item);
  }, [entity, handleClose]);

  const handleAddQueueToPlaylist = useCallback(() => {
    handleClose();
    const queue = playerStore.getState().queue;
    setTimeout(() => {
      addToPlaylistStore.getState().showQueue(queue);
    }, 300);
  }, [handleClose]);

  const handleAddToQueue = useCallback(async () => {
    if (!entity) return;
    handleClose();
    try {
      switch (entity.type) {
        case 'song':
          await addSongToQueue(entity.item as Child);
          break;
        case 'album':
          await addAlbumToQueue(entity.item as AlbumID3);
          break;
        case 'playlist':
          await addPlaylistToQueue(entity.item as Playlist);
          break;
      }
    } catch {
      // Silently fail
    }
  }, [entity, handleClose]);

  const handleGoToArtist = useCallback(() => {
    if (!entity) return;
    handleClose();
    const artistId =
      entity.type === 'song'
        ? (entity.item as Child).artistId
        : entity.type === 'album'
          ? (entity.item as AlbumID3).artistId
          : undefined;
    if (artistId) {
      router.push(`/artist/${artistId}`);
    }
  }, [entity, handleClose, router]);

  const handleGoToAlbum = useCallback(() => {
    if (!entity || entity.type !== 'song') return;
    handleClose();
    const albumId = (entity.item as Child).albumId;
    if (albumId) {
      router.push(`/album/${albumId}`);
    }
  }, [entity, handleClose, router]);

  const handleShowDetails = useCallback(() => {
    if (entity?.type === 'album') {
      setDetailsAlbum(entity.item as AlbumID3);
    }
    handleClose();
    setTimeout(() => setDetailsVisible(true), 300);
  }, [entity, handleClose]);

  const handleDownload = useCallback(async () => {
    if (!entity || !canDownload(entity)) return;
    handleClose();
    try {
      if (downloadStatus === 'complete') {
        removeDownload(entity.item.id);
      } else if (downloadStatus === 'queued' || downloadStatus === 'downloading') {
        const queueItem = musicCacheStore.getState().downloadQueue.find(
          (q) => q.itemId === entity.item.id,
        );
        if (queueItem) cancelDownload(queueItem.queueId);
      } else {
        if (entity.type === 'album') {
          await enqueueAlbumDownload(entity.item.id);
        } else {
          await enqueuePlaylistDownload(entity.item.id);
        }
      }
    } catch {
      /* best-effort */
    }
  }, [entity, downloadStatus, handleClose]);

  const handleShare = useCallback(() => {
    if (!entity) return;
    handleClose();
    setTimeout(() => {
      if (entity.type === 'album') {
        createShareStore.getState().showAlbum(entity.item.id, entity.item.name);
      } else if (entity.type === 'playlist') {
        createShareStore.getState().showPlaylist(entity.item.id, entity.item.name);
      }
    }, 300);
  }, [entity, handleClose]);

  const handleDeletePlaylist = useCallback(() => {
    if (!entity || entity.type !== 'playlist') return;
    const playlistId = entity.item.id;
    const playlistName = entity.item.name;
    const onDetailView = pathname === `/playlist/${playlistId}`;
    handleClose();

    setTimeout(() => {
      Alert.alert(
        'Delete Playlist',
        `Are you sure you want to delete "${playlistName}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              processingOverlayStore.getState().show('Deleting…');
              try {
                const success = await deletePlaylist(playlistId);
                if (!success) throw new Error('API returned false');

                playlistDetailStore.getState().removePlaylist(playlistId);
                playlistLibraryStore.getState().removePlaylist(playlistId);
                if (playlistId in musicCacheStore.getState().cachedItems) {
                  deleteCachedItem(playlistId);
                }

                processingOverlayStore.getState().showSuccess('Playlist Deleted');

                if (onDetailView) {
                  setTimeout(() => router.back(), 800);
                }
              } catch {
                processingOverlayStore.getState().showError('Failed to delete playlist');
              }
            },
          },
        ],
      );
    }, 350);
  }, [entity, handleClose, pathname, router]);

  if (!entity) {
    return (
      <>
        <Modal visible={false} transparent>
          <View />
        </Modal>
        {detailsAlbum && (
          <AlbumDetailsModal
            album={detailsAlbum}
            visible={detailsVisible}
            onClose={() => {
              setDetailsVisible(false);
              setDetailsAlbum(null);
            }}
          />
        )}
      </>
    );
  }

  const offline = offlineModeStore.getState().offlineMode;
  const starrable = !offline && isStarrable(entity);
  const showArtistLink = !offline && hasArtistLink(entity);
  const showAlbumLink = hasAlbumLink(entity) &&
    (!offline || (entity.type === 'song' && entity.item.albumId != null &&
      entity.item.albumId in musicCacheStore.getState().cachedItems));
  const showAddToPlaylist = !offline && canAddToPlaylist(entity);
  const showAddQueueToPlaylist = !offline && source === 'player';
  const showAddToQueue = source !== 'player' && canAddToQueue(entity);
  const showPlayMoreLikeThis = !offline && canPlayMoreLikeThis(entity);
  const showDetails = hasAlbumDetails(entity);
  const showShare = !offline && canShare(entity);
  const showDownload = canDownload(entity);
  const showDelete = !offline && canDeletePlaylist(entity);
  const showSaveTopSongsPlaylist = !offline && entity?.type === 'artist';
  const showPlaySimilarArtistsMix = !offline && canPlaySimilarArtistsMix(entity);

  const hasAnyOption =
    starrable || showAddToPlaylist || showAddQueueToPlaylist ||
    showAddToQueue || showPlayMoreLikeThis || showPlaySimilarArtistsMix || showDownload ||
    showAlbumLink || showArtistLink || showShare || showDetails || showDelete ||
    showSaveTopSongsPlaylist;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
        {/* Backdrop */}
        <Pressable style={styles.backdrop} onPress={handleClose} />

        {/* Sheet */}
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          {/* Handle indicator */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {source === 'player' && showAddQueueToPlaylist ? (
            <>
              {/* Section 1: Player Queue */}
              <Text
                style={[styles.sheetTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                Player Queue
              </Text>
              <Pressable
                onPress={handleAddQueueToPlaylist}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
              >
                <Ionicons
                  name="albums-outline"
                  size={22}
                  color={colors.textPrimary}
                  style={styles.optionIcon}
                />
                <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                  Add Queue to Playlist
                </Text>
              </Pressable>

              {/* Section divider */}
              <View style={styles.sectionDivider} />

              {/* Section 2: Song header and options */}
              <Text
                style={[styles.sheetTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {getTitle(entity)}
              </Text>
              <Text
                style={[styles.sheetSubtitle, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {getSubtitle(entity)}
              </Text>

              {/* Favorite / Unfavorite */}
              {starrable && (
                <Pressable
                  onPress={handleToggleStar}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primary}
                      style={styles.optionIcon}
                    />
                  ) : (
                    <Ionicons
                      name={starred ? 'heart' : 'heart-outline'}
                      size={22}
                      color={starred ? colors.red : colors.textPrimary}
                      style={styles.optionIcon}
                    />
                  )}
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {starred ? 'Remove from Favorites' : 'Add to Favorites'}
                  </Text>
                </Pressable>
              )}

              {/* Save Top Songs Playlist (artist only) */}
              {showSaveTopSongsPlaylist && (
                <Pressable
                  onPress={handleSaveTopSongsPlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="musical-notes-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Save Top Songs Playlist
                  </Text>
                </Pressable>
              )}

              {/* Play Similar Artists (artist only) */}
              {showPlaySimilarArtistsMix && (
                <Pressable
                  onPress={handlePlaySimilarArtistsMix}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="shuffle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Play Similar Artists
                  </Text>
                </Pressable>
              )}

              {/* Add to Playlist */}
              {showAddToPlaylist && (
                <Pressable
                  onPress={handleAddToPlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="add-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Add to Playlist
                  </Text>
                </Pressable>
              )}

              {/* Play More Like This */}
              {showPlayMoreLikeThis && (
                <Pressable
                  onPress={handlePlayMoreLikeThis}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="shuffle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Play More Like This
                  </Text>
                </Pressable>
              )}

              {/* Add to Queue */}
              {showAddToQueue && (
                <Pressable
                  onPress={handleAddToQueue}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="list-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Add to Queue
                  </Text>
                </Pressable>
              )}

              {/* Go to Album (songs only) */}
              {showAlbumLink && (
                <Pressable
                  onPress={handleGoToAlbum}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="disc-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Go to Album
                  </Text>
                </Pressable>
              )}

              {/* Go to Artist */}
              {showArtistLink && (
                <Pressable
                  onPress={handleGoToArtist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Go to Artist
                  </Text>
                </Pressable>
              )}

              {/* Share */}
              {showShare && (
                <Pressable
                  onPress={handleShare}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="share-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Share
                  </Text>
                </Pressable>
              )}

              {/* Album Details */}
              {showDetails && (
                <Pressable
                  onPress={handleShowDetails}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Album Details
                  </Text>
                </Pressable>
              )}

              {/* Download / Cancel Download */}
              {showDownload && downloadStatus !== 'complete' && (
                <Pressable
                  onPress={handleDownload}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name={
                      downloadStatus === 'queued' || downloadStatus === 'downloading'
                        ? 'close-circle-outline'
                        : 'arrow-down-circle-outline'
                    }
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {downloadStatus === 'queued' || downloadStatus === 'downloading'
                      ? 'Cancel Download'
                      : 'Download'}
                  </Text>
                </Pressable>
              )}

              {/* Remove Download */}
              {showDownload && downloadStatus === 'complete' && (
                <Pressable
                  onPress={handleDownload}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={colors.red}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.red }]}>
                    Remove Download
                  </Text>
                </Pressable>
              )}

              {/* Delete Playlist */}
              {showDelete && (
                <Pressable
                  onPress={handleDeletePlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={colors.red}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.red }]}>
                    Delete Playlist
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {/* Title / Subtitle */}
              <Text
                style={[styles.sheetTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {getTitle(entity)}
              </Text>
              <Text
                style={[styles.sheetSubtitle, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {getSubtitle(entity)}
              </Text>

              {/* Empty state when no options are available */}
              {!hasAnyOption && (
                <View style={styles.emptyOptions}>
                  <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
                  <Text style={[styles.emptyOptionsText, { color: colors.textSecondary }]}>
                    No additional options available in offline mode
                  </Text>
                </View>
              )}

              {/* Favorite / Unfavorite */}
              {starrable && (
                <Pressable
                  onPress={handleToggleStar}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primary}
                      style={styles.optionIcon}
                    />
                  ) : (
                    <Ionicons
                      name={starred ? 'heart' : 'heart-outline'}
                      size={22}
                      color={starred ? colors.red : colors.textPrimary}
                      style={styles.optionIcon}
                    />
                  )}
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {starred ? 'Remove from Favorites' : 'Add to Favorites'}
                  </Text>
                </Pressable>
              )}

              {/* Save Top Songs Playlist (artist only) */}
              {showSaveTopSongsPlaylist && (
                <Pressable
                  onPress={handleSaveTopSongsPlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="musical-notes-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Save Top Songs Playlist
                  </Text>
                </Pressable>
              )}

              {/* Play Similar Artists (artist only) */}
              {showPlaySimilarArtistsMix && (
                <Pressable
                  onPress={handlePlaySimilarArtistsMix}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="shuffle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Play Similar Artists
                  </Text>
                </Pressable>
              )}

              {/* Add to Playlist */}
              {showAddToPlaylist && (
                <Pressable
                  onPress={handleAddToPlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="add-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Add to Playlist
                  </Text>
                </Pressable>
              )}

              {/* Play More Like This */}
              {showPlayMoreLikeThis && (
                <Pressable
                  onPress={handlePlayMoreLikeThis}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="shuffle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Play More Like This
                  </Text>
                </Pressable>
              )}

              {/* Add to Queue */}
              {showAddToQueue && (
                <Pressable
                  onPress={handleAddToQueue}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="list-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Add to Queue
                  </Text>
                </Pressable>
              )}

              {/* Go to Album (songs only) */}
              {showAlbumLink && (
                <Pressable
                  onPress={handleGoToAlbum}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="disc-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Go to Album
                  </Text>
                </Pressable>
              )}

              {/* Go to Artist */}
              {showArtistLink && (
                <Pressable
                  onPress={handleGoToArtist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Go to Artist
                  </Text>
                </Pressable>
              )}

              {/* Share */}
              {showShare && (
                <Pressable
                  onPress={handleShare}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="share-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Share
                  </Text>
                </Pressable>
              )}

              {/* Album Details */}
              {showDetails && (
                <Pressable
                  onPress={handleShowDetails}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    Album Details
                  </Text>
                </Pressable>
              )}

              {/* Download / Cancel Download */}
              {showDownload && downloadStatus !== 'complete' && (
                <Pressable
                  onPress={handleDownload}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name={
                      downloadStatus === 'queued' || downloadStatus === 'downloading'
                        ? 'close-circle-outline'
                        : 'arrow-down-circle-outline'
                    }
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {downloadStatus === 'queued' || downloadStatus === 'downloading'
                      ? 'Cancel Download'
                      : 'Download'}
                  </Text>
                </Pressable>
              )}

              {/* Remove Download */}
              {showDownload && downloadStatus === 'complete' && (
                <Pressable
                  onPress={handleDownload}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={colors.red}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.red }]}>
                    Remove Download
                  </Text>
                </Pressable>
              )}

              {/* Delete Playlist */}
              {showDelete && (
                <Pressable
                  onPress={handleDeletePlaylist}
                  style={({ pressed }) => [
                    styles.option,
                    styles.deleteOption,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={colors.red}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.red }]}>
                    Delete Playlist
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </Modal>

      {detailsAlbum && (
        <AlbumDetailsModal
          album={detailsAlbum}
          visible={detailsVisible}
          onClose={() => {
            setDetailsVisible(false);
            setDetailsAlbum(null);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  sheetSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  emptyOptions: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  emptyOptionsText: {
    fontSize: 14,
    textAlign: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  optionPressed: {
    opacity: 0.6,
  },
  deleteOption: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
    paddingTop: 16,
  },
  sectionDivider: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
    paddingTop: 16,
  },
  optionIcon: {
    width: 28,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
});
