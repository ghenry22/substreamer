import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import { useCallback, useContext, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { settingsStyles } from '../styles/settingsStyles';
import { StorageUsageBar } from '../components/StorageUsageBar';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import {
  clearImageCache,
  reconcileImageCacheAsync,
  repairIncompleteImagesAsync,
} from '../services/imageCacheService';
import { clearMusicCache } from '../services/musicCacheService';
import { clearQueue } from '../services/playerService';
import { checkStorageLimit, getFreeDiskSpace } from '../services/storageService';
import {
  imageCacheStore,
  type MaxConcurrentImageDownloads,
} from '../store/imageCacheStore';
import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import {
  musicCacheStore,
  type MaxConcurrentDownloads,
} from '../store/musicCacheStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { storageLimitStore, type StorageLimitMode } from '../store/storageLimitStore';
import { formatBytes } from '../utils/formatters';
import { minDelay } from '../utils/stringHelpers';

const CONCURRENT_OPTIONS: MaxConcurrentDownloads[] = [1, 3, 5];
const IMAGE_CONCURRENT_OPTIONS: MaxConcurrentImageDownloads[] = [1, 3, 5, 10];

export function SettingsStorageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [concurrentSheetVisible, setConcurrentSheetVisible] = useState(false);
  const [imageConcurrentSheetVisible, setImageConcurrentSheetVisible] = useState(false);
  const [dangerousExpanded, setDangerousExpanded] = useState(false);

  const chevronRotation = useSharedValue(0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const handleToggleDangerous = useCallback(() => {
    setDangerousExpanded((prev) => {
      chevronRotation.value = withTiming(prev ? 0 : 90, { duration: 200 });
      return !prev;
    });
  }, [chevronRotation]);

  const totalBytes = imageCacheStore((s) => s.totalBytes);
  const imageCount = imageCacheStore((s) => s.imageCount);
  const fileCount = imageCacheStore((s) => s.fileCount);
  const incompleteCount = imageCacheStore((s) => s.incompleteCount);
  const maxConcurrentImageDownloads = imageCacheStore((s) => s.maxConcurrentImageDownloads);
  const cachedAlbumCount = albumDetailStore((s) => Object.keys(s.albums).length);
  const cachedArtistCount = artistDetailStore((s) => Object.keys(s.artists).length);
  const cachedPlaylistCount = playlistDetailStore((s) => Object.keys(s.playlists).length);
  const totalMetadataCount = cachedAlbumCount + cachedArtistCount + cachedPlaylistCount;

  const musicCacheBytes = musicCacheStore((s) => s.totalBytes);
  const musicCachedItemCount = musicCacheStore((s) => Object.keys(s.cachedItems).length);
  const musicFileCount = musicCacheStore((s) => s.totalFiles);
  const musicQueueCount = musicCacheStore((s) => s.downloadQueue.length);
  const maxConcurrentDownloads = musicCacheStore((s) => s.maxConcurrentDownloads);

  const limitMode = storageLimitStore((s) => s.limitMode);
  const maxCacheSizeGB = storageLimitStore((s) => s.maxCacheSizeGB);

  const offlineMode = offlineModeStore((s) => s.offlineMode);

  const BYTES_PER_GB = 1024 ** 3;
  const freeDisk = getFreeDiskSpace();
  const currentCacheBytes = totalBytes + musicCacheBytes;
  const availableGB = Math.floor((freeDisk + currentCacheBytes) / BYTES_PER_GB);
  const maxSliderGB = Math.max(availableGB, 1);

  const showSizeWarning =
    limitMode === 'fixed' &&
    maxCacheSizeGB > 0 &&
    maxCacheSizeGB * BYTES_PER_GB > freeDisk + currentCacheBytes;

  const availableForWarning = formatBytes(freeDisk + currentCacheBytes);

  const handleToggleLimitMode = useCallback(() => {
    const next: StorageLimitMode = limitMode === 'none' ? 'fixed' : 'none';
    storageLimitStore.getState().setLimitMode(next);
    if (next === 'fixed' && maxCacheSizeGB === 0) {
      storageLimitStore.getState().setMaxCacheSizeGB(Math.max(availableGB, 1));
    }
    checkStorageLimit();
  }, [limitMode, maxCacheSizeGB, availableGB]);

  const handleCacheSizeChange = useCallback((value: number) => {
    storageLimitStore.getState().setMaxCacheSizeGB(Math.round(value));
  }, []);

  const handleCacheSizeComplete = useCallback((value: number) => {
    storageLimitStore.getState().setMaxCacheSizeGB(Math.round(value));
    checkStorageLimit();
  }, []);

  const handleClearCache = useCallback(() => {
    alert(
      t('clearImageCache'),
      t('clearImageCacheMessage', { size: formatBytes(totalBytes) }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear'),
          style: 'destructive',
          onPress: async () => {
            await clearImageCache();
            checkStorageLimit();
          },
        },
      ],
    );
  }, [totalBytes]);

  const handleClearMetadataCache = useCallback(() => {
    alert(
      t('clearMetadataCache'),
      t('clearMetadataCacheMessage', { count: totalMetadataCount }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear'),
          style: 'destructive',
          onPress: () => {
            albumDetailStore.getState().clearAlbums();
            artistDetailStore.getState().clearArtists();
            playlistDetailStore.getState().clearPlaylists();
          },
        },
      ],
    );
  }, [totalMetadataCount]);

  const handleClearMusicCache = useCallback(() => {
    alert(
      t('clearDownloadedMusic'),
      t('clearDownloadedMusicMessage', { size: formatBytes(musicCacheBytes) }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear'),
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            await clearMusicCache();
            checkStorageLimit();
          },
        },
      ],
    );
  }, [musicCacheBytes]);

  const handleClearAll = useCallback(() => {
    alert(
      t('clearAllData'),
      t('clearAllDataMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clearEverything'),
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            await clearMusicCache();
            await clearImageCache();
            albumDetailStore.getState().clearAlbums();
            artistDetailStore.getState().clearArtists();
            playlistDetailStore.getState().clearPlaylists();
            checkStorageLimit();
          },
        },
      ],
    );
  }, []);

  const handleConcurrentPress = useCallback(() => {
    setConcurrentSheetVisible(true);
  }, []);

  const handleConcurrentSelect = useCallback((value: MaxConcurrentDownloads) => {
    musicCacheStore.getState().setMaxConcurrentDownloads(value);
    setConcurrentSheetVisible(false);
  }, []);

  const handleImageConcurrentPress = useCallback(() => {
    setImageConcurrentSheetVisible(true);
  }, []);

  const handleImageConcurrentSelect = useCallback((value: MaxConcurrentImageDownloads) => {
    imageCacheStore.getState().setMaxConcurrentImageDownloads(value);
    setImageConcurrentSheetVisible(false);
  }, []);

  const [imageScanning, setImageScanning] = useState(false);

  const handleImageScan = useCallback(async () => {
    if (imageScanning) return;
    setImageScanning(true);
    // Reconcile can finish in tens of ms for a small cache — pair it with a
    // minimum display window so the spinner is perceptible and the user sees
    // the tap actually did something.
    const minShown = minDelay(1500);
    try {
      await reconcileImageCacheAsync();
      imageCacheStore.getState().recalculateFromDb();
    } finally {
      await minShown;
      setImageScanning(false);
    }
  }, [imageScanning]);

  const [imageRepairing, setImageRepairing] = useState(false);

  const handleImageRepair = useCallback(async () => {
    if (offlineMode || imageRepairing) return;
    setImageRepairing(true);
    processingOverlayStore.getState().show(t('repairingImages'));
    const minShown = minDelay(1500);
    try {
      const outcome = await repairIncompleteImagesAsync();
      imageCacheStore.getState().recalculateFromDb();

      if (outcome.queued === 0 && outcome.removed === 0) {
        processingOverlayStore.getState().showSuccess(t('imageRepairNothingToDo'));
      } else if (outcome.failed > 0) {
        processingOverlayStore.getState().showSuccess(
          t('imageRepairCompleteWithFailures', {
            repaired: outcome.repaired,
            removed: outcome.removed,
            failed: outcome.failed,
          }),
        );
      } else {
        processingOverlayStore.getState().showSuccess(
          t('imageRepairComplete', {
            repaired: outcome.repaired,
            removed: outcome.removed,
          }),
        );
      }
    } catch {
      processingOverlayStore.getState().showError(t('imageRepairFailed'));
    } finally {
      await minShown;
      setImageRepairing(false);
    }
  }, [offlineMode, imageRepairing, t]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
      }),
    [colors]
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('storageUsage')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <StorageUsageBar />
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('storageLimit')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('limit')}</Text>
            <Switch
              value={limitMode === 'fixed'}
              onValueChange={handleToggleLimitMode}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {limitMode === 'fixed' && (
            <>
              <View style={styles.sliderSection}>
                <Text style={[styles.sliderLabel, { color: colors.textPrimary }]}>
                  {t('maximumCacheSize')}
                </Text>
                <Text style={[styles.sliderValue, { color: colors.primary }]}>
                  {maxCacheSizeGB} GB
                </Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={maxSliderGB}
                step={1}
                value={maxCacheSizeGB}
                onValueChange={handleCacheSizeChange}
                onSlidingComplete={handleCacheSizeComplete}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.primary}
              />
              {showSizeWarning && (
                <View style={styles.warningRow}>
                  <Ionicons name="warning" size={16} color={colors.red} style={styles.warningIcon} />
                  <Text style={[styles.warningText, { color: colors.red }]}>
                    {t('storageLimitWarning', { selected: maxCacheSizeGB, available: availableForWarning })}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('downloadedMusic')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
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
            onPress={handleConcurrentPress}
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
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('imageCache')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('cachedImages')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {t('imageCount', { count: imageCount })}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('variantFiles')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {t('variantFileCount', { count: fileCount })}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('diskUsage')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {formatBytes(totalBytes)}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>
              {t('incompleteImages')}
            </Text>
            <Text
              style={[
                settingsStyles.infoValue,
                { color: incompleteCount > 0 ? colors.red : colors.textSecondary },
              ]}
            >
              {incompleteCount}
            </Text>
          </View>
          <Pressable
            onPress={handleImageConcurrentPress}
            style={({ pressed }) => [
              settingsStyles.infoRow,
              { borderBottomColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('concurrentDownloads')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.primary }]}>
              {maxConcurrentImageDownloads}
            </Text>
          </Pressable>
          <View style={settingsStyles.actionRow}>
            <Pressable
              onPress={handleImageScan}
              disabled={imageScanning}
              style={({ pressed }) => [
                settingsStyles.actionRowButton,
                { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                pressed && !imageScanning && settingsStyles.pressed,
                imageScanning && settingsStyles.disabled,
              ]}
            >
              {imageScanning ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Ionicons name="search-outline" size={18} color={colors.textPrimary} />
              )}
              <Text style={[settingsStyles.actionRowButtonText, { color: colors.textPrimary }]}>
                {t('scan')}
              </Text>
            </Pressable>
            {incompleteCount > 0 && (
              <Pressable
                onPress={handleImageRepair}
                disabled={offlineMode || imageRepairing}
                style={({ pressed }) => [
                  settingsStyles.actionRowButton,
                  { backgroundColor: colors.primary },
                  pressed && !offlineMode && !imageRepairing && settingsStyles.pressed,
                  (offlineMode || imageRepairing) && settingsStyles.disabled,
                ]}
              >
                {imageRepairing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="build-outline" size={18} color="#fff" />
                )}
                <Text style={[settingsStyles.actionRowButtonText, { color: '#fff' }]}>
                  {t('repair')}
                </Text>
              </Pressable>
            )}
          </View>
          {offlineMode && incompleteCount > 0 && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.offlineNoticeText, { color: colors.textSecondary }]}>
                {t('repairImagesOfflineNotice')}
              </Text>
            </View>
          )}
          <Pressable
            onPress={() => router.push('/image-cache-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="images-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>{t('browseImageCache')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('metadataCache')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('cachedAlbums')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {cachedAlbumCount}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('cachedArtists')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {cachedArtistCount}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('cachedPlaylists')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {cachedPlaylistCount}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/metadata-cache-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="library-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>{t('browseMetadataCache')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Pressable
          onPress={handleToggleDangerous}
          style={({ pressed }) => [styles.dangerousHeader, pressed && settingsStyles.pressed]}
        >
          <Text style={[settingsStyles.sectionTitle, styles.dangerousSectionTitle, { color: colors.red }]}>
            {t('dangerous')}
          </Text>
          <Animated.View style={chevronStyle}>
            <Ionicons name="chevron-forward" size={16} color={colors.red} />
          </Animated.View>
        </Pressable>
        {dangerousExpanded && (
          <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
            <Pressable
              onPress={handleClearCache}
              style={({ pressed }) => [
                styles.clearCacheButton,
                { borderColor: colors.red },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="warning" size={18} color={colors.red} />
              <Text style={[styles.clearCacheText, { color: colors.red }]}>{t('clearImageCache')}</Text>
            </Pressable>
            <Pressable
              onPress={handleClearMusicCache}
              style={({ pressed }) => [
                styles.clearCacheButton,
                { borderColor: colors.red },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="warning" size={18} color={colors.red} />
              <Text style={[styles.clearCacheText, { color: colors.red }]}>{t('clearDownloadedMusic')}</Text>
            </Pressable>
            <Pressable
              onPress={handleClearMetadataCache}
              style={({ pressed }) => [
                styles.clearCacheButton,
                { borderColor: colors.red },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="warning" size={18} color={colors.red} />
              <Text style={[styles.clearCacheText, { color: colors.red }]}>{t('clearMetadataCache')}</Text>
            </Pressable>
            <Pressable
              onPress={handleClearAll}
              style={({ pressed }) => [
                styles.clearCacheButton,
                { borderColor: colors.red },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="warning" size={18} color={colors.red} />
              <Text style={[styles.clearCacheText, { color: colors.red }]}>{t('clearAllData')}</Text>
            </Pressable>
          </View>
        )}
      </View>

    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>

    <Modal
      visible={concurrentSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setConcurrentSheetVisible(false)}
    >
      <Pressable
        style={settingsStyles.sheetBackdrop}
        onPress={() => setConcurrentSheetVisible(false)}
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
            onPress={() => handleConcurrentSelect(opt)}
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

    <Modal
      visible={imageConcurrentSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setImageConcurrentSheetVisible(false)}
    >
      <Pressable
        style={settingsStyles.sheetBackdrop}
        onPress={() => setImageConcurrentSheetVisible(false)}
      />
      <View
        style={[
          settingsStyles.sheet,
          { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[settingsStyles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[settingsStyles.sheetTitle, { color: colors.textPrimary }]}>
          {t('concurrentImageDownloads')}
        </Text>
        <Text style={[settingsStyles.sheetHint, { color: colors.textSecondary }]}>
          {t('concurrentImageDownloadsHint')}
        </Text>
        {IMAGE_CONCURRENT_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => handleImageConcurrentSelect(opt)}
            style={({ pressed }) => [
              settingsStyles.sheetOption,
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[settingsStyles.sheetOptionLabel, { color: colors.textPrimary }]}>
              {t('imageCount', { count: opt })}
            </Text>
            {maxConcurrentImageDownloads === opt && (
              <Ionicons name="checkmark" size={22} color={colors.primary} />
            )}
          </Pressable>
        ))}
      </View>
    </Modal>

    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  // Mirrors `offlineNotice` / `offlineNoticeText` in
  // `settings-library-data.tsx`. Duplicated here rather than lifted into
  // settingsStyles because it's currently only used on these two cards;
  // if a third caller appears, move it into the shared sheet.
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  offlineNoticeText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  clearCacheButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  clearCacheText: {
    fontSize: 16,
    fontWeight: '600',
  },
  dangerousHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    marginLeft: 4,
    gap: 4,
  },
  dangerousSectionTitle: {
    marginBottom: 0,
    marginLeft: 0,
  },
  sliderSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  sliderLabel: {
    fontSize: 16,
    flex: 1,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  warningIcon: {
    marginRight: 6,
  },
  warningText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
});
