import Ionicons from "@react-native-vector-icons/ionicons/static";
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumInfoContent } from '@/components/AlbumInfoContent';
import { LyricsContent } from '@/components/LyricsContent';
import { QueueItemRow } from '@/components/QueueItemRow';
import { AutoplayQueueFooter } from '@/components/AutoplayQueueFooter';
import { closeOpenRow } from '@/components/SwipeableRow';
import { type ThemeColors } from '@/constants/theme';
import { usePlayerAlbumInfo } from '@/hooks/usePlayerAlbumInfo';
import { usePlayerLyrics } from '@/hooks/usePlayerLyrics';
import { type Child } from '@/services/subsonicService';
import { sanitizeBiographyText } from '@/utils/formatters';
import { isAutoplaySectionStart } from '@/utils/queueOrigins';

import type { QueueTrackOrigin } from '@/types/queue';

export type PlayerMode = 'queue' | 'info' | 'lyrics';

export interface PlayerModeContentProps {
  /** Active content view — owned by the parent screen (the centered toggle). */
  mode: PlayerMode;
  currentTrack: Child;
  queue: Child[];
  queueOrigins: QueueTrackOrigin[];
  currentTrackIndex: number | null;
  colors: ThemeColors;
  /** Muted-primary variant for the active queue row highlight. */
  queueColors: ThemeColors;
  onQueueItemPress: (index: number) => void;
  onQueueItemLongPress: (track: Child) => void;
  onShareQueue: () => void;
  onClearQueue: () => void;
}

/**
 * Inline "Up Next" content host for the tablet-portrait player. Renders the
 * Queue / Album Info / Lyrics views (selected by the parent's centered toggle)
 * directly on the page — transparent, no chrome — so the single page-wide
 * gradient shows through. Deliberately in-tree (NOT a Modal) so the global
 * MoreOptionsSheet can open over it without stacking two native modals.
 */
export const PlayerModeContent = memo(function PlayerModeContent({
  mode,
  currentTrack,
  queue,
  queueOrigins,
  currentTrackIndex,
  colors,
  queueColors,
  onQueueItemPress,
  onQueueItemLongPress,
  onShareQueue,
  onClearQueue,
}: PlayerModeContentProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Album info — only fetch while the info view is actually showing.
  const albumId = currentTrack.albumId ?? null;
  const {
    entry: albumInfoEntry,
    loading: albumInfoLoading,
    error: albumInfoError,
    refreshing: albumInfoRefreshing,
    handleRetry: handleRetryAlbumInfo,
    handleRefresh: handleRefreshAlbumInfo,
  } = usePlayerAlbumInfo(albumId, currentTrack.artist, currentTrack.album, {
    enabled: mode === 'info',
  });

  const sanitizedNotes = useMemo(() => {
    const serverNotes = albumInfoEntry?.albumInfo.notes;
    if (serverNotes) {
      const sanitized = sanitizeBiographyText(serverNotes);
      if (sanitized) return sanitized;
    }
    return albumInfoEntry?.enrichedNotes ?? null;
  }, [albumInfoEntry?.albumInfo.notes, albumInfoEntry?.enrichedNotes]);

  const notesAttributionUrl = albumInfoEntry?.enrichedNotesUrl ?? null;

  const trackId = currentTrack.id;
  // Always enabled: this host is mounted only by the tablet-portrait player route.
  const {
    entry: lyricsEntry,
    loading: lyricsLoading,
    error: lyricsError,
    handleRetry: handleRetryLyrics,
  } = usePlayerLyrics(trackId, currentTrack.artist, currentTrack.title, true);

  const renderQueueItem = useCallback(
    ({ item, index }: { item: Child; index: number }) => (
      <QueueItemRow
        track={item}
        index={index}
        isActive={index === currentTrackIndex}
        startsAutoplaySection={isAutoplaySectionStart(queueOrigins, currentTrackIndex, index)}
        colors={queueColors}
        onPress={onQueueItemPress}
        onLongPress={onQueueItemLongPress}
      />
    ),
    [currentTrackIndex, queueOrigins, queueColors, onQueueItemPress, onQueueItemLongPress],
  );

  const keyExtractor = useCallback(
    (item: Child, index: number) => `${item.id}-${index}`,
    [],
  );

  const listContentStyle = useMemo(
    () => ({ paddingBottom: insets.bottom + 16 }),
    [insets.bottom],
  );

  return (
    <View style={styles.container}>
      {mode === 'queue' ? (
        <>
          {queue.length > 0 && (
            <View style={styles.queueHeaderRow}>
              <Text style={[styles.queueHeaderText, { color: colors.textPrimary }]}>
                {t('queue')}
              </Text>
              <View style={styles.queueActions}>
                <Pressable
                  onPress={onShareQueue}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('shareQueue')}
                  style={({ pressed }) => [styles.queueActionButton, pressed && styles.pressed]}
                >
                  <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
                </Pressable>
                <Pressable
                  onPress={onClearQueue}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('clearQueue')}
                  style={({ pressed }) => [styles.queueActionButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.clearButtonText, { color: colors.textPrimary }]}>
                    {t('clear')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          <FlashList
            data={queue}
            renderItem={renderQueueItem}
            keyExtractor={keyExtractor}
            ListFooterComponent={AutoplayQueueFooter}
            onScrollBeginDrag={closeOpenRow}
            drawDistance={300}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={listContentStyle}
          />
        </>
      ) : mode === 'info' ? (
        // AlbumInfoContent relies on the parent for side padding (landscape gets
        // it from the right column). Provide it here, aligned to the hero band.
        <View style={styles.infoWrap}>
          <AlbumInfoContent
            track={currentTrack}
            albumInfo={albumInfoEntry?.albumInfo ?? null}
            overrideMbid={albumInfoEntry?.overrideMbid ?? null}
            sanitizedNotes={sanitizedNotes}
            notesAttributionUrl={notesAttributionUrl}
            albumInfoLoading={albumInfoLoading}
            albumInfoError={albumInfoError}
            onRetry={handleRetryAlbumInfo}
            refreshing={albumInfoRefreshing}
            onRefresh={handleRefreshAlbumInfo}
            colors={colors}
          />
        </View>
      ) : (
        <View style={styles.lyricsContainer}>
          <LyricsContent
            key={trackId}
            trackId={trackId}
            lyricsData={lyricsEntry}
            lyricsLoading={lyricsLoading}
            lyricsError={lyricsError}
            onRetry={handleRetryLyrics}
            durationSec={currentTrack.duration ?? null}
            colors={colors}
          />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  queueHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  queueActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoWrap: {
    // Constrain to a centered readable column. AlbumInfoContent's credit rows
    // use space-between, which flings label/value to opposite edges across the
    // full-width portrait panel; a capped, centered width keeps them legible
    // (and mirrors the narrower landscape column it was designed for).
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  lyricsContainer: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
