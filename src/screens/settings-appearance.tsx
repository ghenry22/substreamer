import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../store/themeStore';
import { DEFAULT_PRIMARY_COLOR } from '../store/themeStore';
import {
  layoutPreferencesStore,
  type AlbumSortOrder,
  type ArtistAlbumSortOrder,
  type ItemLayout,
} from '../store/layoutPreferencesStore';

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

const ALBUM_SORT_OPTIONS: { value: AlbumSortOrder; label: string }[] = [
  { value: 'artist', label: 'Artist name' },
  { value: 'title', label: 'Album title' },
];

const ARTIST_ALBUM_SORT_OPTIONS: { value: ArtistAlbumSortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
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

export function SettingsAppearanceScreen() {
  const { colors, preference, primaryColor, setThemePreference, setPrimaryColor } = useTheme();
  const activePrimary = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const [accentOpen, setAccentOpen] = useState(false);
  const [sortOrderOpen, setSortOrderOpen] = useState(false);
  const [artistAlbumSortOpen, setArtistAlbumSortOpen] = useState(false);
  const activeAccentLabel = ACCENT_COLORS.find((c) => c.hex === activePrimary)?.label ?? 'Custom';

  const handleAccentSelect = useCallback(
    (hex: string) => {
      setPrimaryColor(hex === DEFAULT_PRIMARY_COLOR ? null : hex);
      setAccentOpen(false);
    },
    [setPrimaryColor]
  );

  const albumLayout = layoutPreferencesStore((s) => s.albumLayout);
  const artistLayout = layoutPreferencesStore((s) => s.artistLayout);
  const playlistLayout = layoutPreferencesStore((s) => s.playlistLayout);
  const setAlbumLayout = layoutPreferencesStore((s) => s.setAlbumLayout);
  const setArtistLayout = layoutPreferencesStore((s) => s.setArtistLayout);
  const setPlaylistLayout = layoutPreferencesStore((s) => s.setPlaylistLayout);

  const albumSortOrder = layoutPreferencesStore((s) => s.albumSortOrder);
  const setAlbumSortOrder = layoutPreferencesStore((s) => s.setAlbumSortOrder);

  const artistAlbumSortOrder = layoutPreferencesStore((s) => s.artistAlbumSortOrder);
  const setArtistAlbumSortOrder = layoutPreferencesStore((s) => s.setArtistAlbumSortOrder);

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

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
        themeRow: { backgroundColor: colors.card, borderColor: colors.border },
        themeRowText: { color: colors.textPrimary },
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
                  pressed && styles.pressed,
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
              pressed && styles.pressed,
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
                      pressed && styles.pressed,
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
                    pressed && styles.pressed,
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
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Album sort order</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setSortOrderOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {ALBUM_SORT_OPTIONS.find((o) => o.value === albumSortOrder)?.label ?? 'Artist name'}
            </Text>
            <Ionicons
              name={sortOrderOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          {sortOrderOpen && (
            <View style={[styles.accentList, { borderTopColor: colors.border }]}>
              {ALBUM_SORT_OPTIONS.map((opt) => {
                const isActive = albumSortOrder === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setAlbumSortOrder(opt.value);
                      setSortOrderOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.accentOption,
                      { borderBottomColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {opt.label}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Artist album sort order</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setArtistAlbumSortOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {ARTIST_ALBUM_SORT_OPTIONS.find((o) => o.value === artistAlbumSortOrder)?.label ?? 'Newest first'}
            </Text>
            <Ionicons
              name={artistAlbumSortOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          {artistAlbumSortOpen && (
            <View style={[styles.accentList, { borderTopColor: colors.border }]}>
              {ARTIST_ALBUM_SORT_OPTIONS.map((opt) => {
                const isActive = artistAlbumSortOrder === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setArtistAlbumSortOrder(opt.value);
                      setArtistAlbumSortOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.accentOption,
                      { borderBottomColor: colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {opt.label}
                    </Text>
                    {isActive && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
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
                    style={({ pressed }) => pressed && styles.pressed}
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
                    style={({ pressed }) => pressed && styles.pressed}
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
                    style={({ pressed }) => pressed && styles.pressed}
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
                    style={({ pressed }) => pressed && styles.pressed}
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
  themeRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeRowLabel: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.8,
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
});
