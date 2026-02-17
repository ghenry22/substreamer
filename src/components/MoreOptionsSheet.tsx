/**
 * MoreOptionsSheet – unified bottom sheet for all entity types.
 *
 * Reads from `moreOptionsStore` and renders entity-specific options:
 *   - Song/Track: Favorite, Add to Queue, Go to Album, Go to Artist
 *   - Album: Favorite, Add to Queue, Go to Artist, Album Details
 *   - Artist: Favorite
 *   - Playlist: Add to Queue
 *
 * Rendered once at the root layout level.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumDetailsModal } from './AlbumDetailsModal';
import { useIsStarred } from '../hooks/useIsStarred';
import { useTheme } from '../hooks/useTheme';
import {
  addAlbumToQueue,
  addPlaylistToQueue,
  addSongToQueue,
  toggleStar,
} from '../services/moreOptionsService';
import {
  type AlbumID3,
  type Child,
  type Playlist,
} from '../services/subsonicService';
import {
  moreOptionsStore,
  type MoreOptionsEntity,
} from '../store/moreOptionsStore';

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MoreOptionsSheet() {
  const visible = moreOptionsStore((s) => s.visible);
  const entity = moreOptionsStore((s) => s.entity);
  const hide = moreOptionsStore((s) => s.hide);

  const starType: 'song' | 'album' | 'artist' =
    entity?.type === 'album' || entity?.type === 'artist' ? entity.type : 'song';
  const starred = useIsStarred(starType, entity?.item.id ?? '');

  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);

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
    handleClose();
    setTimeout(() => setDetailsVisible(true), 300);
  }, [handleClose]);

  if (!entity) {
    return (
      <>
        <Modal visible={false} transparent>
          <View />
        </Modal>
      </>
    );
  }

  const starrable = isStarrable(entity);
  const showArtistLink = hasArtistLink(entity);
  const showAlbumLink = hasAlbumLink(entity);
  const showAddToQueue = canAddToQueue(entity);
  const showDetails = hasAlbumDetails(entity);

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
        </View>
      </Modal>

      {/* Album Details Modal (re-used from existing component) */}
      {entity.type === 'album' && (
        <AlbumDetailsModal
          album={entity.item as AlbumID3}
          visible={detailsVisible}
          onClose={() => setDetailsVisible(false)}
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
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  optionPressed: {
    opacity: 0.6,
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
