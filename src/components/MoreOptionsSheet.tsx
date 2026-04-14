/**
 * MoreOptionsSheet – unified bottom sheet for all entity types.
 *
 * Reads from `moreOptionsStore` and renders entity-specific options:
 *   - Song/Track: Favorite, Add to Playlist, Play More Like This, Add to Queue, Go to Album, Go to Artist, Track Details, Download
 *   - Album: Favorite, Add to Queue, Go to Artist, Album Details
 *   - Artist: Favorite, Save Top Songs Playlist, Play Similar Artists
 *   - Playlist: Add to Queue
 *
 * Rendered once at the root layout level.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlbumDetailsModal } from './AlbumDetailsModal';
import { BottomSheet } from './BottomSheet';
import { TrackDetailsModal } from './TrackDetailsModal';
import { CachedImage } from './CachedImage';
import { ThemedAlert } from './ThemedAlert';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { StarRatingDisplay } from './StarRating';
import { useDownloadStatus, type DownloadStatus } from '../hooks/useDownloadStatus';
import { useIsStarred } from '../hooks/useIsStarred';
import { useRating } from '../hooks/useRating';
import { useTheme } from '../hooks/useTheme';
import { tabletLayoutStore } from '../store/tabletLayoutStore';
import {
  addAlbumToQueue,
  addPlaylistToQueue,
  addSongToQueue,
  cancelDownload,
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
  enqueueSongDownload,
  playMoreByArtist,
  playMoreLikeThis,
  playSimilarArtistsMix,
  removeDownload,
  saveArtistTopSongsPlaylist,
  toggleStar,
} from '../services/moreOptionsService';
import { deleteCachedItem } from '../services/musicCacheService';
import {
  deletePlaylist,
  isVariousArtists,
  type AlbumID3,
  type Child,
  type Playlist,
} from '../services/subsonicService';
import { addToPlaylistStore } from '../store/addToPlaylistStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { scrobbleExclusionStore, type ScrobbleExclusionType } from '../store/scrobbleExclusionStore';
import { createShareStore } from '../store/createShareStore';
import { getOverride, mbidOverrideStore } from '../store/mbidOverrideStore';
import { mbidSearchStore } from '../store/mbidSearchStore';
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
import { canUserShare, supports } from '../services/serverCapabilityService';
import { setRatingStore } from '../store/setRatingStore';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getTitle(entity: MoreOptionsEntity, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (entity.type) {
    case 'song':
      return entity.item.title ?? t('unknownSong');
    case 'album':
      return `${entity.item.name}${entity.item.year ? ` (${entity.item.year})` : ''}`;
    case 'artist':
      return entity.item.name;
    case 'playlist':
      return entity.item.name;
  }
}

function getSubtitle(entity: MoreOptionsEntity, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (entity.type) {
    case 'song':
      return entity.item.artist ?? t('unknownArtist');
    case 'album':
      return entity.item.artist ?? (entity.item as AlbumID3).displayArtist ?? t('unknownArtist');
    case 'artist': {
      const count = entity.item.albumCount;
      return t('albumCount', { count: count ?? 0 });
    }
    case 'playlist': {
      const sc = entity.item.songCount;
      return t('trackWithCount', { count: sc ?? 0 });
    }
  }
}

function getCoverArtId(entity: MoreOptionsEntity): string | undefined {
  return entity.item.coverArt;
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

function hasTrackDetails(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song';
}

function canShare(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album' || entity.type === 'playlist';
}

function canDownload(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album' || entity.type === 'playlist' || entity.type === 'song';
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

function canPlayMoreByArtist(entity: MoreOptionsEntity): boolean {
  if (entity.type === 'song') return Boolean(entity.item.artistId);
  if (entity.type === 'album') return Boolean(entity.item.artistId);
  if (entity.type === 'artist') return true;
  return false;
}

function isRatable(entity: MoreOptionsEntity): boolean {
  return entity.type === 'song' || entity.type === 'album' || entity.type === 'artist';
}

function canExcludeFromScrobbling(entity: MoreOptionsEntity): boolean {
  return entity.type === 'album' || entity.type === 'artist' || entity.type === 'playlist';
}

function getEntityUserRating(entity: MoreOptionsEntity | null): number | undefined {
  if (!entity) return undefined;
  if (entity.type === 'playlist') return undefined;
  return (entity.item as { userRating?: number }).userRating;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MoreOptionsSheet() {
  const visible = moreOptionsStore((s) => s.visible);
  const entity = moreOptionsStore((s) => s.entity);
  const source = moreOptionsStore((s) => s.source);
  const hide = moreOptionsStore((s) => s.hide);
  const isPlayerSource = source === 'player' || source === 'playerpanel' || source === 'playerexpanded';

  const starType: 'song' | 'album' | 'artist' =
    entity?.type === 'album' || entity?.type === 'artist' ? entity.type : 'song';
  const starred = useIsStarred(starType, entity?.item.id ?? '');
  const entityRating = useRating(entity?.item.id ?? '', getEntityUserRating(entity));

  const downloadType: 'song' | 'album' | 'playlist' =
    entity?.type === 'song' ? 'song' : entity?.type === 'playlist' ? 'playlist' : 'album';
  const downloadStatus: DownloadStatus = useDownloadStatus(
    downloadType,
    entity && canDownload(entity) ? entity.item.id : '',
  );

  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();
  const router = useRouter();
  const pathname = usePathname();

  const isScrobbleExcluded = scrobbleExclusionStore((s) => {
    if (!entity || !canExcludeFromScrobbling(entity)) return false;
    switch (entity.type) {
      case 'album': return entity.item.id in s.excludedAlbums;
      case 'artist': return entity.item.id in s.excludedArtists;
      case 'playlist': return entity.item.id in s.excludedPlaylists;
      default: return false;
    }
  });

  const [busy, setBusy] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsAlbum, setDetailsAlbum] = useState<AlbumID3 | null>(null);
  const [detailsTrack, setDetailsTrack] = useState<Child | null>(null);

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

  const handlePlayMoreByArtist = useCallback(() => {
    if (!entity) return;
    const artistId = entity.type === 'artist' ? entity.item.id : (entity.item as Child | AlbumID3).artistId;
    const artistName = entity.type === 'artist' ? entity.item.name : (entity.item as Child | AlbumID3).artist;
    if (!artistId || !artistName) return;
    handleClose();
    playMoreByArtist(artistId, artistName);
  }, [entity, handleClose]);

  const handleSetMbid = useCallback(() => {
    if (!entity) return;
    if (entity.type === 'artist') {
      const artistId = entity.item.id;
      const artistName = entity.item.name;
      const override = getOverride(mbidOverrideStore.getState().overrides, 'artist', artistId);
      const resolvedMbid = artistDetailStore.getState().artists[artistId]?.resolvedMbid;
      const currentMbid = override?.mbid ?? resolvedMbid ?? null;
      handleClose();
      setTimeout(() => {
        mbidSearchStore.getState().showArtist(artistId, artistName, currentMbid, entity.item.coverArt);
      }, 300);
    } else if (entity.type === 'album') {
      const album = entity.item as AlbumID3;
      const override = getOverride(mbidOverrideStore.getState().overrides, 'album', album.id);
      const currentMbid = override?.mbid ?? null;
      handleClose();
      setTimeout(() => {
        mbidSearchStore.getState().showAlbum(album.id, album.name, album.artist ?? null, currentMbid, album.coverArt);
      }, 300);
    }
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
    if (source === 'playerexpanded') {
      tabletLayoutStore.getState().setPlayerExpanded(false);
    }
    const artistId =
      entity.type === 'song'
        ? (entity.item as Child).artistId
        : entity.type === 'album'
          ? (entity.item as AlbumID3).artistId
          : undefined;
    if (artistId) {
      router.push(`/artist/${artistId}`);
    }
  }, [entity, handleClose, source, router]);

  const handleGoToAlbum = useCallback(() => {
    if (!entity || entity.type !== 'song') return;
    handleClose();
    if (source === 'playerexpanded') {
      tabletLayoutStore.getState().setPlayerExpanded(false);
    }
    const albumId = (entity.item as Child).albumId;
    if (albumId) {
      router.push(`/album/${albumId}`);
    }
  }, [entity, handleClose, source, router]);

  const handleShowDetails = useCallback(() => {
    if (entity?.type === 'album') {
      setDetailsAlbum(entity.item as AlbumID3);
    }
    handleClose();
    setTimeout(() => setDetailsVisible(true), 300);
  }, [entity, handleClose]);

  const handleShowTrackDetails = useCallback(() => {
    if (entity?.type === 'song') {
      setDetailsTrack(entity.item as Child);
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
        if (entity.type === 'song') {
          await enqueueSongDownload(entity.item as Child);
        } else if (entity.type === 'album') {
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
        createShareStore.getState().showAlbum(entity.item.id, entity.item.name, entity.item.artist, entity.item.coverArt);
      } else if (entity.type === 'playlist') {
        createShareStore.getState().showPlaylist(entity.item.id, entity.item.name, entity.item.coverArt);
      }
    }, 300);
  }, [entity, handleClose]);

  const handleSetRating = useCallback(() => {
    if (!entity || !isRatable(entity)) return;
    handleClose();
    setTimeout(() => {
      const coverArtId = (entity.item as { coverArt?: string }).coverArt;
      setRatingStore.getState().show(
        entity.type as 'song' | 'album' | 'artist',
        entity.item.id,
        getTitle(entity, t),
        entityRating,
        coverArtId,
      );
    }, 300);
  }, [entity, entityRating, handleClose]);

  const handleDeletePlaylist = useCallback(() => {
    if (!entity || entity.type !== 'playlist') return;
    const playlistId = entity.item.id;
    const playlistName = entity.item.name;
    const onDetailView = pathname === `/playlist/${playlistId}`;
    handleClose();

    setTimeout(() => {
      alert(
        t('deletePlaylist'),
        t('deletePlaylistConfirmMessage', { name: playlistName }),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('delete'),
            style: 'destructive',
            onPress: async () => {
              processingOverlayStore.getState().show(t('deleting'));
              try {
                const success = await deletePlaylist(playlistId);
                if (!success) throw new Error('API returned false');

                playlistDetailStore.getState().removePlaylist(playlistId);
                playlistLibraryStore.getState().removePlaylist(playlistId);
                if (playlistId in musicCacheStore.getState().cachedItems) {
                  deleteCachedItem(playlistId);
                }

                processingOverlayStore.getState().showSuccess(t('playlistDeleted'));

                if (onDetailView) {
                  setTimeout(() => router.back(), 800);
                }
              } catch {
                processingOverlayStore.getState().showError(t('failedToDeletePlaylist'));
              }
            },
          },
        ],
      );
    }, 350);
  }, [entity, handleClose, pathname, router]);

  const handleToggleScrobbleExclusion = useCallback(() => {
    if (!entity || !canExcludeFromScrobbling(entity)) return;
    const type = entity.type as ScrobbleExclusionType;
    const name = (entity.item as AlbumID3 | Playlist).name ?? '';
    if (isScrobbleExcluded) {
      scrobbleExclusionStore.getState().removeExclusion(type, entity.item.id);
    } else {
      scrobbleExclusionStore.getState().addExclusion(type, entity.item.id, name);
    }
    handleClose();
  }, [entity, isScrobbleExcluded, handleClose]);

  if (!entity) {
    return (
      <>
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
        {detailsTrack && (
          <TrackDetailsModal
            track={detailsTrack}
            visible={detailsVisible}
            onClose={() => {
              setDetailsVisible(false);
              setDetailsTrack(null);
            }}
          />
        )}
      </>
    );
  }

  const offline = offlineModeStore.getState().offlineMode;
  const starrable = !offline && isStarrable(entity);
  const showRating = !offline && isRatable(entity) && (
    entity.type === 'song' || supports('albumArtistRating')
  );
  const showArtistLink = !offline && hasArtistLink(entity);
  const showAlbumLink = hasAlbumLink(entity) &&
    (!offline || (entity.type === 'song' && entity.item.albumId != null &&
      entity.item.albumId in musicCacheStore.getState().cachedItems));
  const showAddToPlaylist = !offline && canAddToPlaylist(entity);
  const showAddQueueToPlaylist = !offline && isPlayerSource;
  const showAddToQueue = !isPlayerSource && canAddToQueue(entity);
  const showPlayMoreLikeThis = !offline && canPlayMoreLikeThis(entity);
  const showDetails = hasAlbumDetails(entity);
  const showTrackDetails = hasTrackDetails(entity);
  const showShare = !offline && canShare(entity) && canUserShare();
  const showDownload = canDownload(entity);
  const showDelete = !offline && canDeletePlaylist(entity);
  const isVA = entity?.type === 'artist' && isVariousArtists(entity.item.name);
  const showSaveTopSongsPlaylist = !offline && entity?.type === 'artist' && !isVA;
  const showPlaySimilarArtistsMix = !offline && canPlaySimilarArtistsMix(entity) && !isVA;
  const showPlayMoreByArtist = canPlayMoreByArtist(entity) && !isVA;
  const showSetMbid = (entity?.type === 'artist' || entity?.type === 'album') && !isVA;
  const showScrobbleExclusion = canExcludeFromScrobbling(entity);

  const hasAnyOption =
    starrable || showRating || showAddToPlaylist || showAddQueueToPlaylist ||
    showAddToQueue || showPlayMoreLikeThis || showPlaySimilarArtistsMix ||
    showPlayMoreByArtist || showDownload ||
    showAlbumLink || showArtistLink || showShare || showDetails || showTrackDetails || showDelete ||
    showSaveTopSongsPlaylist || showSetMbid || showScrobbleExclusion;

  return (
    <>
      <BottomSheet visible={visible} onClose={handleClose}>
          {isPlayerSource && showAddQueueToPlaylist ? (
            <>
              {/* Section 1: Player Queue */}
              <Text
                style={[styles.sheetTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {t('playerQueue')}
              </Text>
              <Pressable
                onPress={handleAddQueueToPlaylist}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="playlist-music-outline"
                  size={22}
                  color={colors.textPrimary}
                  style={styles.optionIcon}
                />
                <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                  {t('addQueueToPlaylist')}
                </Text>
              </Pressable>

              {/* Section divider */}
              <View style={styles.sectionDivider} />

              {/* Section 2: Song header and options */}
              <View style={styles.sheetHeader}>
                {getCoverArtId(entity) && (
                  <CachedImage coverArtId={getCoverArtId(entity)!} size={150} style={styles.sheetCoverArt} resizeMode="cover" />
                )}
                <View style={styles.sheetHeaderText}>
                  <Text
                    style={[styles.sheetTitle, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {getTitle(entity, t)}
                  </Text>
                  <Text
                    style={[styles.sheetSubtitle, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {getSubtitle(entity, t)}
                  </Text>
                </View>
              </View>

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
                    {starred ? t('removeFromFavorites') : t('addToFavorites')}
                  </Text>
                </Pressable>
              )}

              {/* Set Rating (player section) */}
              {showRating && (
                <Pressable
                  onPress={handleSetRating}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="star-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('setRating')}
                  </Text>
                  {entityRating > 0 && (
                    <View style={styles.ratingBadge}>
                      <StarRatingDisplay
                        rating={entityRating}
                        size={14}
                        color={colors.primary}
                        emptyColor={colors.primary}
                      />
                    </View>
                  )}
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
                  <MaterialCommunityIcons
                    name="playlist-star"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('saveTopSongsPlaylist')}
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
                  <MaterialCommunityIcons
                    name="account-group-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playSimilarArtists')}
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
                  <MaterialCommunityIcons
                    name="playlist-plus"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('addToPlaylist')}
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
                    name="radio-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playMoreLikeThis')}
                  </Text>
                </Pressable>
              )}

              {/* Play More by This Artist */}
              {showPlayMoreByArtist && (
                <Pressable
                  onPress={handlePlayMoreByArtist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account-music-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playMoreByThisArtist')}
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
                  <MaterialCommunityIcons
                    name="playlist-play"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('addToQueue')}
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
                    {t('goToAlbum')}
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
                    {t('goToArtist')}
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
                    {t('share')}
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
                    {t('albumDetails')}
                  </Text>
                </Pressable>
              )}

              {/* Track Details */}
              {showTrackDetails && (
                <Pressable
                  onPress={handleShowTrackDetails}
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
                    {t('trackDetails')}
                  </Text>
                </Pressable>
              )}

              {/* Set MusicBrainz ID (artist/album) */}
              {showSetMbid && (
                <Pressable
                  onPress={handleSetMbid}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="finger-print-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('setMusicBrainzId')}
                  </Text>
                </Pressable>
              )}

              {/* Exclude / Include in Scrobbling */}
              {showScrobbleExclusion && (
                <Pressable
                  onPress={handleToggleScrobbleExclusion}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name={isScrobbleExcluded ? 'eye-outline' : 'eye-off-outline'}
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {isScrobbleExcluded ? t('includeInScrobbling') : t('excludeFromScrobbling')}
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
                      ? t('cancelDownload')
                      : t('download')}
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
                    {t('removeDownload')}
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
                    {t('deletePlaylist')}
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {/* Title / Subtitle */}
              <View style={styles.sheetHeader}>
                {getCoverArtId(entity) && (
                  <CachedImage coverArtId={getCoverArtId(entity)!} size={150} style={styles.sheetCoverArt} resizeMode="cover" />
                )}
                <View style={styles.sheetHeaderText}>
                  <Text
                    style={[styles.sheetTitle, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {getTitle(entity, t)}
                  </Text>
                  <Text
                    style={[styles.sheetSubtitle, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {getSubtitle(entity, t)}
                  </Text>
                </View>
              </View>

              {/* Empty state when no options are available */}
              {!hasAnyOption && (
                <View style={styles.emptyOptions}>
                  <Ionicons name="cloud-offline-outline" size={32} color={colors.primary} />
                  <Text style={[styles.emptyOptionsText, { color: colors.textSecondary }]}>
                    {t('noOptionsOffline')}
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
                    {starred ? t('removeFromFavorites') : t('addToFavorites')}
                  </Text>
                </Pressable>
              )}

              {/* Set Rating */}
              {showRating && (
                <Pressable
                  onPress={handleSetRating}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="star-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('setRating')}
                  </Text>
                  {entityRating > 0 && (
                    <View style={styles.ratingBadge}>
                      <StarRatingDisplay
                        rating={entityRating}
                        size={14}
                        color={colors.primary}
                        emptyColor={colors.primary}
                      />
                    </View>
                  )}
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
                  <MaterialCommunityIcons
                    name="playlist-star"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('saveTopSongsPlaylist')}
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
                  <MaterialCommunityIcons
                    name="account-group-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playSimilarArtists')}
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
                  <MaterialCommunityIcons
                    name="playlist-plus"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('addToPlaylist')}
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
                    name="radio-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playMoreLikeThis')}
                  </Text>
                </Pressable>
              )}

              {/* Play More by This Artist */}
              {showPlayMoreByArtist && (
                <Pressable
                  onPress={handlePlayMoreByArtist}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account-music-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('playMoreByThisArtist')}
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
                  <MaterialCommunityIcons
                    name="playlist-play"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('addToQueue')}
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
                    {t('goToAlbum')}
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
                    {t('goToArtist')}
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
                    {t('share')}
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
                    {t('albumDetails')}
                  </Text>
                </Pressable>
              )}

              {/* Track Details */}
              {showTrackDetails && (
                <Pressable
                  onPress={handleShowTrackDetails}
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
                    {t('trackDetails')}
                  </Text>
                </Pressable>
              )}

              {/* Set MusicBrainz ID (artist/album) */}
              {showSetMbid && (
                <Pressable
                  onPress={handleSetMbid}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name="finger-print-outline"
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {t('setMusicBrainzId')}
                  </Text>
                </Pressable>
              )}

              {/* Exclude / Include in Scrobbling */}
              {showScrobbleExclusion && (
                <Pressable
                  onPress={handleToggleScrobbleExclusion}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    name={isScrobbleExcluded ? 'eye-outline' : 'eye-off-outline'}
                    size={22}
                    color={colors.textPrimary}
                    style={styles.optionIcon}
                  />
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                    {isScrobbleExcluded ? t('includeInScrobbling') : t('excludeFromScrobbling')}
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
                      ? t('cancelDownload')
                      : t('download')}
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
                    {t('removeDownload')}
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
                    {t('deletePlaylist')}
                  </Text>
                </Pressable>
              )}
            </>
          )}
      </BottomSheet>

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
      {detailsTrack && (
        <TrackDetailsModal
          track={detailsTrack}
          visible={detailsVisible}
          onClose={() => {
            setDetailsVisible(false);
            setDetailsTrack(null);
          }}
        />
      )}
      <ThemedAlert {...alertProps} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  sheetCoverArt: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.12)',
    marginRight: 12,
  },
  sheetHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  sheetSubtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  emptyOptions: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
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
  ratingBadge: {
    marginLeft: 'auto',
    paddingLeft: 8,
  },
});
