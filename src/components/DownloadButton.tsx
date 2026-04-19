/**
 * Self-contained download button for album/playlist detail headers.
 *
 * Subscribes directly to musicCacheStore and useDownloadStatus so it
 * manages its own re-renders. This avoids the parent screen needing
 * to pass progress via navigation.setOptions — which previously
 * remounted the CircularProgress on every update, losing animation
 * state and causing jumps.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { CircularProgress } from './CircularProgress';
import { DownloadedIcon } from './DownloadedIcon';
import { useDownloadStatus } from '../hooks/useDownloadStatus';
import { useTheme } from '../hooks/useTheme';
import {
  cancelDownload,
  deleteCachedItem,
  enqueueAlbumDownload,
  enqueuePlaylistDownload,
} from '../services/musicCacheService';
import { musicCacheStore } from '../store/musicCacheStore';

interface DownloadButtonProps {
  itemId: string;
  type: 'album' | 'playlist';
  size?: number;
  /** Override the default enqueue action (e.g. for starred songs). */
  onDownload?: () => void;
  /** Override the default delete action (e.g. for starred songs). */
  onDelete?: () => void;
}

export const DownloadButton = memo(function DownloadButton({
  itemId,
  type,
  size = 24,
  onDownload,
  onDelete,
}: DownloadButtonProps) {
  const { colors } = useTheme();
  const downloadStatus = useDownloadStatus(type, itemId);

  const downloadProgress = musicCacheStore((s) => {
    if (!itemId) return 0;
    const item = s.downloadQueue.find((q) => q.itemId === itemId);
    if (!item || item.totalSongs === 0) return 0;
    return item.completedSongs / item.totalSongs;
  });

  const [showingRing, setShowingRing] = useState(false);
  const prevStatus = useRef(downloadStatus);

  useEffect(() => {
    if (downloadStatus === 'downloading' && prevStatus.current !== 'downloading') {
      setShowingRing(true);
    }
    if (downloadStatus !== 'downloading' && downloadStatus !== 'complete') {
      setShowingRing(false);
    }
    prevStatus.current = downloadStatus;
  }, [downloadStatus]);

  const handleRingComplete = useCallback(() => {
    setShowingRing(false);
  }, []);

  const handlePress = useCallback(() => {
    if (!itemId) return;
    if (downloadStatus === 'complete') {
      if (onDelete) onDelete();
      else deleteCachedItem(itemId);
    } else if (downloadStatus === 'queued' || downloadStatus === 'downloading') {
      const queueItem = musicCacheStore.getState().downloadQueue.find(
        (q) => q.itemId === itemId,
      );
      if (queueItem) cancelDownload(queueItem.queueId);
    } else {
      if (onDownload) onDownload();
      else if (type === 'album') enqueueAlbumDownload(itemId);
      else enqueuePlaylistDownload(itemId);
    }
  }, [itemId, type, downloadStatus, onDownload, onDelete]);

  const showCircular = downloadStatus === 'downloading' || (downloadStatus === 'complete' && showingRing);
  const progressSize = Math.round(size * 0.9);

  // Once the item moves to cachedItems the queue entry is gone, so
  // downloadProgress drops to 0. Force 1.0 so the ring completes its
  // fill animation and fires the completion pulse.
  const effectiveProgress = (downloadStatus === 'complete' && showingRing) ? 1 : downloadProgress;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {showCircular ? (
        <CircularProgress
          progress={effectiveProgress}
          size={progressSize}
          strokeWidth={2.5}
          color={colors.primary}
          trackColor={colors.textSecondary}
          onComplete={handleRingComplete}
        />
      ) : downloadStatus === 'complete' ? (
        <DownloadedIcon size={size} circleColor={colors.primary} arrowColor="#fff" />
      ) : downloadStatus === 'queued' ? (
        <ActivityIndicator size={size} color={colors.primary} />
      ) : (
        <Ionicons
          name="arrow-down-circle-outline"
          size={size}
          color={colors.textPrimary}
        />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    padding: 4,
    opacity: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
