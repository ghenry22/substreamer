import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { clearImageCache } from '../services/imageCacheService';
import { imageCacheStore, getImageCount } from '../store/imageCacheStore';
import { albumDetailStore } from '../store/albumDetailStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { formatBytes } from '../utils/formatters';

export function SettingsStorageScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const totalBytes = imageCacheStore((s) => s.totalBytes);
  const fileCount = imageCacheStore((s) => s.fileCount);
  const imageCount = getImageCount(fileCount);
  const cachedAlbumCount = albumDetailStore((s) => Object.keys(s.albums).length);
  const cachedArtistCount = artistDetailStore((s) => Object.keys(s.artists).length);
  const cachedPlaylistCount = playlistDetailStore((s) => Object.keys(s.playlists).length);
  const totalMetadataCount = cachedAlbumCount + cachedArtistCount + cachedPlaylistCount;
  const pendingScrobbleCount = pendingScrobbleStore((s) => s.pendingScrobbles.length);
  const completedScrobbleCount = completedScrobbleStore((s) => s.completedScrobbles.length);

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
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
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
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Image Cache</Text>
          </Pressable>
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
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Metadata Cache</Text>
          </Pressable>
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
    </ScrollView>
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
    paddingVertical: 14,
    gap: 8,
  },
  clearCacheText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});
