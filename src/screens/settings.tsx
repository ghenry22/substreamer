import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useTheme } from '../hooks/useTheme';
import { clearImageCache } from '../services/imageCacheService';
import { imageCacheStore, getImageCount } from '../store/imageCacheStore';
import { clearApiCache } from '../services/subsonicService';
import type { ThemePreference } from '../store/themeStore';
import { DEFAULT_PRIMARY_COLOR } from '../store/themeStore';
import { authStore } from '../store/authStore';
import {
  layoutPreferencesStore,
  type ItemLayout,
} from '../store/layoutPreferencesStore';
import { serverInfoStore } from '../store/serverInfoStore';

const AUTH_PERSIST_KEY = 'substreamer-auth';
const SERVER_INFO_PERSIST_KEY = 'substreamer-server-info';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function InfoRow({
  label,
  value,
  labelColor,
  valueColor,
  borderColor,
}: {
  label: string;
  value: string | null;
  labelColor: string;
  valueColor: string;
  borderColor: string;
}) {
  if (value == null || value === '') return null;
  return (
    <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
      <Text style={[styles.infoLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const LAYOUT_ROWS: { key: 'albumLayout' | 'artistLayout' | 'playlistLayout'; label: string }[] = [
  { key: 'albumLayout', label: 'Albums' },
  { key: 'artistLayout', label: 'Artists' },
  { key: 'playlistLayout', label: 'Playlists' },
];

const FAV_LAYOUT_ROWS: { key: 'favSongLayout' | 'favAlbumLayout' | 'favArtistLayout'; label: string }[] = [
  { key: 'favSongLayout', label: 'Songs' },
  { key: 'favAlbumLayout', label: 'Albums' },
  { key: 'favArtistLayout', label: 'Artists' },
];

const ACCENT_COLORS: { label: string; hex: string }[] = [
  { label: 'Default', hex: '#1D9BF0' },
  { label: 'Red', hex: '#E91429' },
  { label: 'Green', hex: '#00BA7C' },
  { label: 'Orange', hex: '#FF6F00' },
  { label: 'Purple', hex: '#7B61FF' },
  { label: 'Pink', hex: '#F91880' },
  { label: 'Teal', hex: '#00BCD4' },
  { label: 'Yellow', hex: '#FFD600' },
];

export function SettingsScreen() {
  const router = useRouter();
  const { colors, preference, primaryColor, setThemePreference, setPrimaryColor } = useTheme();
  const activePrimary = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const [accentOpen, setAccentOpen] = useState(false);
  const totalBytes = imageCacheStore((s) => s.totalBytes);
  const fileCount = imageCacheStore((s) => s.fileCount);
  const imageCount = getImageCount(fileCount);
  const activeAccentLabel = ACCENT_COLORS.find((c) => c.hex === activePrimary)?.label ?? 'Custom';

  const handleAccentSelect = useCallback(
    (hex: string) => {
      setPrimaryColor(hex === DEFAULT_PRIMARY_COLOR ? null : hex);
      setAccentOpen(false);
    },
    [setPrimaryColor]
  );
  const serverInfo = serverInfoStore(
    useShallow((s) => ({
      serverType: s.serverType,
      serverVersion: s.serverVersion,
      apiVersion: s.apiVersion,
      openSubsonic: s.openSubsonic,
      extensions: s.extensions,
      lastFetchedAt: s.lastFetchedAt,
    }))
  );

  const albumLayout = layoutPreferencesStore((s) => s.albumLayout);
  const artistLayout = layoutPreferencesStore((s) => s.artistLayout);
  const playlistLayout = layoutPreferencesStore((s) => s.playlistLayout);
  const setAlbumLayout = layoutPreferencesStore((s) => s.setAlbumLayout);
  const setArtistLayout = layoutPreferencesStore((s) => s.setArtistLayout);
  const setPlaylistLayout = layoutPreferencesStore((s) => s.setPlaylistLayout);

  const favSongLayout = layoutPreferencesStore((s) => s.favSongLayout);
  const favAlbumLayout = layoutPreferencesStore((s) => s.favAlbumLayout);
  const favArtistLayout = layoutPreferencesStore((s) => s.favArtistLayout);
  const setFavSongLayout = layoutPreferencesStore((s) => s.setFavSongLayout);
  const setFavAlbumLayout = layoutPreferencesStore((s) => s.setFavAlbumLayout);
  const setFavArtistLayout = layoutPreferencesStore((s) => s.setFavArtistLayout);

  const layoutValues: Record<string, ItemLayout> = {
    albumLayout,
    artistLayout,
    playlistLayout,
  };

  const layoutSetters: Record<string, (l: ItemLayout) => void> = {
    albumLayout: setAlbumLayout,
    artistLayout: setArtistLayout,
    playlistLayout: setPlaylistLayout,
  };

  const favLayoutValues: Record<string, ItemLayout> = {
    favSongLayout,
    favAlbumLayout,
    favArtistLayout,
  };

  const favLayoutSetters: Record<string, (l: ItemLayout) => void> = {
    favSongLayout: setFavSongLayout,
    favAlbumLayout: setFavAlbumLayout,
    favArtistLayout: setFavArtistLayout,
  };

  const hasAnyInfo =
    serverInfo.serverType != null ||
    serverInfo.serverVersion != null ||
    serverInfo.apiVersion != null ||
    serverInfo.extensions.length > 0;

  const handleLogout = async () => {
    authStore.getState().clearSession();
    serverInfoStore.getState().clearServerInfo();
    clearApiCache();
    await AsyncStorage.multiRemove([AUTH_PERSIST_KEY, SERVER_INFO_PERSIST_KEY]);
    router.replace('/login');
  };

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

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        placeholder: { color: colors.textSecondary },
        logoutButton: { borderColor: colors.red },
        logoutButtonText: { color: colors.red },
        themeRow: { backgroundColor: colors.card, borderColor: colors.border },
        themeRowText: { color: colors.textPrimary },
        themeRowSubtext: { color: colors.textSecondary },
        layoutRow: { backgroundColor: colors.card, borderColor: colors.border },
        layoutRowLabel: { color: colors.textPrimary },
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
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Server information</Text>
        {hasAnyInfo ? (
          <View style={[styles.card, dynamicStyles.card]}>
            <InfoRow
              label="Server type"
              value={serverInfo.serverType ?? (serverInfo.apiVersion != null ? 'Subsonic' : null)}
              labelColor={colors.textSecondary}
              valueColor={colors.textPrimary}
              borderColor={colors.border}
            />
            <InfoRow
              label="Server version"
              value={serverInfo.serverVersion}
              labelColor={colors.textSecondary}
              valueColor={colors.textPrimary}
              borderColor={colors.border}
            />
            <InfoRow
              label="API version"
              value={serverInfo.apiVersion}
              labelColor={colors.textSecondary}
              valueColor={colors.textPrimary}
              borderColor={colors.border}
            />
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>OpenSubsonic</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                {serverInfo.openSubsonic ? 'Yes' : 'No'}
              </Text>
            </View>
            {serverInfo.extensions.length > 0 && (
              <View style={[styles.extensionsBlock, { borderTopColor: colors.border }]}>
                <Text style={[styles.extensionsTitle, { color: colors.label }]}>
                  Supported extensions
                </Text>
                {serverInfo.extensions.map((ext) => (
                  <View key={ext.name} style={styles.extensionRow}>
                    <Text style={[styles.extensionName, { color: colors.textPrimary }]}>
                      {ext.name}
                    </Text>
                    <Text style={[styles.extensionVersions, { color: colors.textSecondary }]}>
                      v{ext.versions?.join(', ') ?? '—'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <Text style={[styles.placeholder, dynamicStyles.placeholder]}>
            No server information available. Log in to see details.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Appearance</Text>
        <View style={styles.themeCard}>
          {THEME_OPTIONS.map((opt) => {
            const isSelected = preference === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.themeRow,
                  dynamicStyles.themeRow,
                  isSelected && styles.themeRowSelected,
                  pressed && styles.themeRowPressed,
                ]}
                onPress={() => setThemePreference(opt.value)}
              >
                <View style={styles.themeRowContent}>
                  <Ionicons
                    name={opt.icon}
                    size={22}
                    color={isSelected ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.themeRowLabel, dynamicStyles.themeRowText]}>
                    {opt.label}
                  </Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Accent color</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setAccentOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && styles.themeRowPressed,
            ]}
          >
            <View style={styles.accentChip}>
              <View style={[styles.chipDot, { backgroundColor: activePrimary }]} />
              <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                {activeAccentLabel}
              </Text>
            </View>
            <Ionicons
              name={accentOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          {accentOpen && (
            <View style={[styles.accentList, { borderTopColor: colors.border }]}>
              {ACCENT_COLORS.map((c) => {
                const isActive = activePrimary === c.hex;
                return (
                  <Pressable
                    key={c.hex}
                    onPress={() => handleAccentSelect(c.hex)}
                    style={({ pressed }) => [
                      styles.accentOption,
                      { borderBottomColor: colors.border },
                      pressed && styles.themeRowPressed,
                    ]}
                  >
                    <View style={styles.accentChip}>
                      <View style={[styles.chipDot, { backgroundColor: c.hex }]} />
                      <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                        {c.label}
                      </Text>
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
              {primaryColor != null && (
                <Pressable
                  onPress={() => {
                    setPrimaryColor(null);
                    setAccentOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.resetButton,
                    pressed && styles.themeRowPressed,
                  ]}
                >
                  <Text style={[styles.resetButtonText, { color: colors.textSecondary }]}>
                    Reset to default
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Library layout</Text>
        <View style={styles.themeCard}>
          {LAYOUT_ROWS.map((row) => {
            const currentValue = layoutValues[row.key];
            return (
              <View
                key={row.key}
                style={[styles.layoutRow, dynamicStyles.layoutRow]}
              >
                <Text style={[styles.layoutRowLabel, dynamicStyles.layoutRowLabel]}>
                  {row.label}
                </Text>
                <View style={styles.layoutIcons}>
                  <Pressable
                    onPress={() => layoutSetters[row.key]('list')}
                    hitSlop={6}
                    style={({ pressed }) => pressed && styles.themeRowPressed}
                  >
                    <Ionicons
                      name="list-outline"
                      size={22}
                      color={currentValue === 'list' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => layoutSetters[row.key]('grid')}
                    hitSlop={6}
                    style={({ pressed }) => pressed && styles.themeRowPressed}
                  >
                    <Ionicons
                      name="grid-outline"
                      size={22}
                      color={currentValue === 'grid' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Favorites layout</Text>
        <View style={styles.themeCard}>
          {FAV_LAYOUT_ROWS.map((row) => {
            const currentValue = favLayoutValues[row.key];
            return (
              <View
                key={row.key}
                style={[styles.layoutRow, dynamicStyles.layoutRow]}
              >
                <Text style={[styles.layoutRowLabel, dynamicStyles.layoutRowLabel]}>
                  {row.label}
                </Text>
                <View style={styles.layoutIcons}>
                  <Pressable
                    onPress={() => favLayoutSetters[row.key]('list')}
                    hitSlop={6}
                    style={({ pressed }) => pressed && styles.themeRowPressed}
                  >
                    <Ionicons
                      name="list-outline"
                      size={22}
                      color={currentValue === 'list' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => favLayoutSetters[row.key]('grid')}
                    hitSlop={6}
                    style={({ pressed }) => pressed && styles.themeRowPressed}
                  >
                    <Ionicons
                      name="grid-outline"
                      size={22}
                      color={currentValue === 'grid' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Storage use</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Cached images</Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
              {imageCount} {imageCount === 1 ? 'image' : 'images'}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Disk usage</Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
              {formatBytes(totalBytes)}
            </Text>
          </View>
          <Pressable
            onPress={handleClearCache}
            style={({ pressed }) => [
              styles.clearCacheButton,
              pressed && styles.themeRowPressed,
            ]}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={[styles.clearCacheText, { color: colors.red }]}>Clear Image Cache</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Account</Text>
        <Pressable
          style={({ pressed }) => [
            styles.logoutButton,
            dynamicStyles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
          onPress={handleLogout}
        >
          <Text style={[styles.logoutButtonText, dynamicStyles.logoutButtonText]}>Log out</Text>
        </Pressable>
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
  themeCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  themeRowSelected: {
    // selected state handled by checkmark
  },
  themeRowPressed: {
    opacity: 0.8,
  },
  themeRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeRowLabel: {
    fontSize: 16,
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
  extensionsBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  extensionsTitle: {
    fontSize: 13,
    marginBottom: 8,
  },
  extensionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  extensionName: {
    fontSize: 14,
  },
  extensionVersions: {
    fontSize: 13,
  },
  placeholder: {
    fontSize: 15,
    fontStyle: 'italic',
    padding: 16,
  },
  accentDropdown: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  accentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  accentList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chipDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  chipLabel: {
    fontSize: 16,
  },
  resetButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  layoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  layoutRowLabel: {
    fontSize: 16,
  },
  layoutIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
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
  logoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonPressed: {
    opacity: 0.8,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
