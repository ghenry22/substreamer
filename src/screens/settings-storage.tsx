import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StorageUsageBar } from '../components/StorageUsageBar';
import { useTheme } from '../hooks/useTheme';
import { clearImageCache } from '../services/imageCacheService';
import { clearMusicCache } from '../services/musicCacheService';
import { checkStorageLimit, getFreeDiskSpace } from '../services/storageService';
import { imageCacheStore, getImageCount } from '../store/imageCacheStore';
import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import {
  musicCacheStore,
  type MaxConcurrentDownloads,
} from '../store/musicCacheStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { storageLimitStore, type StorageLimitMode } from '../store/storageLimitStore';
import { formatBytes } from '../utils/formatters';

const CONCURRENT_OPTIONS: MaxConcurrentDownloads[] = [1, 3, 5];

export function SettingsStorageScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [concurrentSheetVisible, setConcurrentSheetVisible] = useState(false);

  const totalBytes = imageCacheStore((s) => s.totalBytes);
  const fileCount = imageCacheStore((s) => s.fileCount);
  const imageCount = getImageCount(fileCount);
  const cachedAlbumCount = albumDetailStore((s) => Object.keys(s.albums).length);
  const cachedArtistCount = artistDetailStore((s) => Object.keys(s.artists).length);
  const cachedPlaylistCount = playlistDetailStore((s) => Object.keys(s.playlists).length);
  const totalMetadataCount = cachedAlbumCount + cachedArtistCount + cachedPlaylistCount;
  const pendingScrobbleCount = pendingScrobbleStore((s) => s.pendingScrobbles.length);
  const completedScrobbleCount = completedScrobbleStore((s) => s.completedScrobbles.length);

  const musicCacheBytes = musicCacheStore((s) => s.totalBytes);
  const musicCachedItemCount = musicCacheStore((s) => Object.keys(s.cachedItems).length);
  const musicFileCount = musicCacheStore((s) => s.totalFiles);
  const musicQueueCount = musicCacheStore((s) => s.downloadQueue.length);
  const maxConcurrentDownloads = musicCacheStore((s) => s.maxConcurrentDownloads);

  const limitMode = storageLimitStore((s) => s.limitMode);
  const maxCacheSizeGB = storageLimitStore((s) => s.maxCacheSizeGB);

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
    Alert.alert(
      'Clear Image Cache',
      `This will remove ${formatBytes(totalBytes)} of cached images. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearImageCache();
            checkStorageLimit();
          },
        },
      ],
    );
  }, [totalBytes]);

  const handleClearMetadataCache = useCallback(() => {
    Alert.alert(
      'Clear Metadata Cache',
      `This will remove ${totalMetadataCount} cached ${totalMetadataCount === 1 ? 'item' : 'items'}. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
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
    Alert.alert(
      'Clear Downloaded Music',
      `This will remove ${formatBytes(musicCacheBytes)} of downloaded music. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearMusicCache();
            checkStorageLimit();
          },
        },
      ],
    );
  }, [musicCacheBytes]);

  const handleConcurrentPress = useCallback(() => {
    setConcurrentSheetVisible(true);
  }, []);

  const handleConcurrentSelect = useCallback((value: MaxConcurrentDownloads) => {
    musicCacheStore.getState().setMaxConcurrentDownloads(value);
    setConcurrentSheetVisible(false);
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
      }),
    [colors]
  );

  return (
    <>
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Storage usage</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <StorageUsageBar />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Storage limit</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Limit</Text>
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
                  Maximum cache size
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
                    You've selected {maxCacheSizeGB} GB but only {availableForWarning} is available
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Scrobbles</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Pending scrobbles</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {pendingScrobbleCount}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Completed scrobbles</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {completedScrobbleCount}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Image cache</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Cached images</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {imageCount} {imageCount === 1 ? 'image' : 'images'}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Disk usage</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {formatBytes(totalBytes)}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/image-cache-browser')}
            style={({ pressed }) => [
              styles.browseCacheButton,
              { borderTopColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.browseCacheLeft}>
              <Ionicons name="images-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.browseCacheText, { color: colors.textPrimary }]}>Browse Image Cache</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={handleClearCache}
            style={({ pressed }) => [
              styles.clearCacheButton,
              { borderColor: colors.red },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Image Cache</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Downloaded music</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Downloaded items</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {musicCachedItemCount} {musicCachedItemCount === 1 ? 'item' : 'items'}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Downloaded files</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {musicFileCount} {musicFileCount === 1 ? 'file' : 'files'}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Disk usage</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {formatBytes(musicCacheBytes)}
            </Text>
          </View>
          <Pressable
            onPress={handleConcurrentPress}
            style={({ pressed }) => [
              styles.infoRow,
              { borderBottomColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Concurrent downloads</Text>
            <Text style={[styles.infoValue, { color: colors.primary }]}>
              {maxConcurrentDownloads}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/music-cache-browser')}
            style={({ pressed }) => [
              styles.browseCacheButton,
              { borderTopColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.browseCacheLeft}>
              <Ionicons name="musical-notes-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.browseCacheText, { color: colors.textPrimary }]}>Browse Downloaded Music</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/download-queue')}
            style={({ pressed }) => [
              styles.browseCacheButton,
              { borderTopColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.browseCacheLeft}>
              <Ionicons name="cloud-download-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.browseCacheText, { color: colors.textPrimary }]}>
                Download Queue{musicQueueCount > 0 ? ` (${musicQueueCount})` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          {musicCachedItemCount > 0 && (
            <Pressable
              onPress={handleClearMusicCache}
              style={({ pressed }) => [
                styles.clearCacheButton,
                { borderColor: colors.red },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
              <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Downloaded Music</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Metadata cache</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Cached albums</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {cachedAlbumCount}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Cached artists</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {cachedArtistCount}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>Cached playlists</Text>
            <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
              {cachedPlaylistCount}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/metadata-cache-browser')}
            style={({ pressed }) => [
              styles.browseCacheButton,
              { borderTopColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.browseCacheLeft}>
              <Ionicons name="library-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.browseCacheText, { color: colors.textPrimary }]}>Browse Metadata Cache</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={handleClearMetadataCache}
            style={({ pressed }) => [
              styles.clearCacheButton,
              { borderColor: colors.red },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Metadata Cache</Text>
          </Pressable>
        </View>
      </View>

    </ScrollView>

    <Modal
      visible={concurrentSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setConcurrentSheetVisible(false)}
    >
      <Pressable
        style={styles.sheetBackdrop}
        onPress={() => setConcurrentSheetVisible(false)}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>
          Concurrent Downloads
        </Text>
        <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
          Select how many tracks to download simultaneously.
        </Text>
        {CONCURRENT_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => handleConcurrentSelect(opt)}
            style={({ pressed }) => [
              styles.sheetOption,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.sheetOptionLabel, { color: colors.textPrimary }]}>
              {opt} {opt === 1 ? 'track' : 'tracks'}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 15,
    flex: 1,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
    marginLeft: 12,
  },
  browseCacheButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  browseCacheLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  browseCacheText: {
    fontSize: 15,
    fontWeight: '600',
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
    fontSize: 15,
    fontWeight: '600',
  },
  sliderSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  sliderLabel: {
    fontSize: 15,
    flex: 1,
  },
  sliderValue: {
    fontSize: 15,
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
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  sheetHandle: {
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
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  sheetOptionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
});
