import Ionicons from '@react-native-vector-icons/ionicons/static';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { settingsStyles } from '../../styles/settingsStyles';
import { albumLibraryStore } from '../../store/albumLibraryStore';
import { connectivityStore } from '../../store/connectivityStore';
import { fullLibraryDownloadStore } from '../../store/fullLibraryDownloadStore';
import {
  musicCacheStore,
  type MaxConcurrentDownloads,
} from '../../store/musicCacheStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { playlistLibraryStore } from '../../store/playlistLibraryStore';
import { downloadedMetadataRefreshStore } from '../../store/downloadedMetadataRefreshStore';
import {
  canDownloadFullLibrary,
  enqueueFullLibraryDownload,
} from '../../services/fullLibraryDownloadService';
import { clearQueuedDownloads } from '../../services/musicCacheService';
import { refreshDownloadedMetadata } from '../../services/downloadedMetadataService';
import { fireAndForget } from '../../utils/fireAndForget';
import { formatBytes } from '../../utils/formatters';
import { SettingsSectionTitle } from './SettingsSectionTitle';

const CONCURRENT_OPTIONS: MaxConcurrentDownloads[] = [1, 3, 5];

export function DownloadedMusicCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, confirm } = useThemedAlert();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheetVisible, setSheetVisible] = useState(false);

  const musicCacheBytes = musicCacheStore((s) => s.totalBytes);
  const musicCachedItemCount = musicCacheStore((s) => Object.keys(s.cachedItems).length);
  const musicFileCount = musicCacheStore((s) => s.totalFiles);
  const musicQueueCount = musicCacheStore((s) => s.downloadQueue.length);
  const maxConcurrentDownloads = musicCacheStore((s) => s.maxConcurrentDownloads);

  // Full-library download progress / availability.
  const fullLib = fullLibraryDownloadStore();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const online = !offlineMode && connectivityStore((s) => s.isServerReachable);

  // Downloaded-metadata refresh progress (re-cache detail + cover art).
  const metaRefreshActive = downloadedMetadataRefreshStore((s) => s.active);
  const metaRefreshDone = downloadedMetadataRefreshStore((s) => s.done);
  const metaRefreshTotal = downloadedMetadataRefreshStore((s) => s.total);

  const handleRefreshMetadata = useCallback(() => {
    // Button stays enabled unless offline mode, but a refresh needs a reachable
    // server — otherwise every fetch just stalls on a timeout. Give feedback for
    // both offline mode and a currently-unreachable server rather than firing a
    // doomed pass. (Same message: "connect to your server…".)
    if (offlineMode || !connectivityStore.getState().isServerReachable) {
      alert(t('refreshDownloadedMetadata'), t('refreshMetadataOffline'));
      return;
    }
    fireAndForget(
      refreshDownloadedMetadata({ mode: 'all' }),
      'settings.refreshDownloadedMetadata',
    );
  }, [offlineMode, alert, t]);

  const handleSelect = useCallback((value: MaxConcurrentDownloads) => {
    musicCacheStore.getState().setMaxConcurrentDownloads(value);
    setSheetVisible(false);
  }, []);

  const handleDownloadFullLibrary = useCallback(() => {
    if (!canDownloadFullLibrary()) {
      alert(t('downloadFullLibrary'), t('downloadFullLibraryOffline'));
      return;
    }
    // The full-library download needs a clean queue to track its own progress.
    // If anything is queued (in-progress, errored, or waiting), tell the user to
    // clear it themselves first and stop here.
    if (musicQueueCount > 0) {
      alert(
        t('downloadFullLibraryQueueNotEmptyTitle'),
        t('downloadFullLibraryQueueNotEmptyBody'),
      );
      return;
    }

    const albums = albumLibraryStore.getState().albums.length;
    const playlists = playlistLibraryStore.getState().playlists.length;
    confirm({
      title: t('downloadFullLibraryConfirmTitle'),
      message: t('downloadFullLibraryConfirmBody', { albums, playlists }),
      confirmLabel: t('downloadFullLibraryConfirm'),
      onConfirm: () => fireAndForget(enqueueFullLibraryDownload(), 'fullLibraryDownload'),
    });
  }, [confirm, t, musicQueueCount]);

  // Cancelling stops adding more AND clears everything still queued, but lets
  // the item that's actively downloading finish so it lands in a clean state.
  const handleCancelFullLibrary = useCallback(() => {
    fullLibraryDownloadStore.getState().cancel();
    clearQueuedDownloads();
  }, []);

  // Surface preparing/queueing failures to the user, then clear the flag.
  useEffect(() => {
    if (fullLib.error) {
      alert(t('downloadFullLibrary'), fullLib.error);
      fullLibraryDownloadStore.getState().clearError();
    }
  }, [fullLib.error, alert, t]);

  const fullLibProgressLabel = fullLib.phase === 'preparing'
    ? t('preparingFullLibrary')
    : fullLib.albumsQueued < fullLib.albumsTotal
      ? t('addingAlbumsToQueue', { queued: fullLib.albumsQueued, total: fullLib.albumsTotal })
      : t('addingPlaylistsToQueue', { queued: fullLib.playlistsQueued, total: fullLib.playlistsTotal });

  return (
    <>
      <View style={settingsStyles.section}>
        <SettingsSectionTitle>{t('downloadedMusic')}</SettingsSectionTitle>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('downloadedItems')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {t('itemCount', { count: musicCachedItemCount })}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('downloadedFiles')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {t('fileCount', { count: musicFileCount })}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('diskUsage')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {formatBytes(musicCacheBytes)}
            </Text>
          </View>
          <Pressable
            onPress={() => setSheetVisible(true)}
            style={({ pressed }) => [
              settingsStyles.infoRow,
              { borderBottomColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('concurrentDownloads')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.primary }]}>
              {maxConcurrentDownloads}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/music-cache-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="musical-notes-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>{t('browseDownloadedMusic')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/download-queue')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="cloud-download-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                {musicQueueCount > 0 ? t('downloadQueueWithCount', { count: musicQueueCount }) : t('downloadQueue')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>

          {/* Refresh metadata — re-caches detail + cover art for downloaded items
              so offline never loses their metadata. Always shown; disabled only
              in offline mode. */}
          <Pressable
            onPress={handleRefreshMetadata}
            disabled={offlineMode || metaRefreshActive}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              (offlineMode || pressed) && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="sync-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                {metaRefreshActive
                  ? t('refreshingMetadataProgress', {
                      done: metaRefreshDone,
                      total: metaRefreshTotal,
                    })
                  : t('refreshDownloadedMetadata')}
              </Text>
            </View>
            {metaRefreshActive && <ActivityIndicator size="small" color={colors.primary} />}
          </Pressable>

          {/* Download Full Library — one-shot that queues every album + playlist */}
          {fullLib.active ? (
            <>
              <View style={settingsStyles.offlineNotice}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[settingsStyles.offlineNoticeText, { color: colors.textSecondary }]}>
                  {fullLibProgressLabel}
                </Text>
              </View>
              <View style={settingsStyles.actionRow}>
                <Pressable
                  onPress={handleCancelFullLibrary}
                  style={({ pressed }) => [
                    settingsStyles.actionRowButton,
                    { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                    pressed && settingsStyles.pressed,
                  ]}
                >
                  <Text style={[settingsStyles.actionRowButtonText, { color: colors.textPrimary }]}>
                    {t('cancel')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={settingsStyles.actionRow}>
              <Pressable
                onPress={handleDownloadFullLibrary}
                disabled={!online}
                style={({ pressed }) => [
                  settingsStyles.actionRowButton,
                  { backgroundColor: colors.primary },
                  (!online || pressed) && settingsStyles.pressed,
                ]}
              >
                <Ionicons name="cloud-download-outline" size={18} color="#fff" />
                <Text style={[settingsStyles.actionRowButtonText, { color: '#fff' }]}>
                  {t('downloadFullLibrary')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable
          style={settingsStyles.sheetBackdrop}
          onPress={() => setSheetVisible(false)}
        />
        <View
          style={[
            settingsStyles.sheet,
            { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={[settingsStyles.sheetHandle, { backgroundColor: colors.border }]} />
          <Text style={[settingsStyles.sheetTitle, { color: colors.textPrimary }]}>
            {t('concurrentDownloads')}
          </Text>
          <Text style={[settingsStyles.sheetHint, { color: colors.textSecondary }]}>
            {t('concurrentDownloadsHint')}
          </Text>
          {CONCURRENT_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => handleSelect(opt)}
              style={({ pressed }) => [
                settingsStyles.sheetOption,
                pressed && settingsStyles.pressed,
              ]}
            >
              <Text style={[settingsStyles.sheetOptionLabel, { color: colors.textPrimary }]}>
                {t('trackWithCount', { count: opt })}
              </Text>
              {maxConcurrentDownloads === opt && (
                <Ionicons name="checkmark" size={22} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}
