import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { settingsStyles } from '../styles/settingsStyles';
import { LanguageSelector } from '../components/LanguageSelector';
import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../store/themeStore';
import { DEFAULT_PRIMARY_COLOR } from '../store/themeStore';
import {
  layoutPreferencesStore,
  type AlbumSortOrder,
  type ArtistAlbumSortOrder,
  type DateFormat,
  type ItemLayout,
  type ListLength,
} from '../store/layoutPreferencesStore';
import { albumListsStore } from '../store/albumListsStore';
import { artistDetailStore } from '../store/artistDetailStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { processingOverlayStore } from '../store/processingOverlayStore';

const THEME_OPTIONS: { value: ThemePreference; labelKey: string; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
  { value: 'system', labelKey: 'themeSystem', icon: 'phone-portrait-outline' },
  { value: 'light', labelKey: 'themeLight', icon: 'sunny-outline' },
  { value: 'dark', labelKey: 'themeDark', icon: 'moon-outline' },
];

const LAYOUT_ROWS: { key: 'albumLayout' | 'artistLayout' | 'playlistLayout'; labelKey: string }[] = [
  { key: 'albumLayout', labelKey: 'albums' },
  { key: 'artistLayout', labelKey: 'artists' },
  { key: 'playlistLayout', labelKey: 'playlists' },
];

const FAV_LAYOUT_ROWS: { key: 'favSongLayout' | 'favAlbumLayout' | 'favArtistLayout'; labelKey: string }[] = [
  { key: 'favSongLayout', labelKey: 'songs' },
  { key: 'favAlbumLayout', labelKey: 'albums' },
  { key: 'favArtistLayout', labelKey: 'artists' },
];

const ALBUM_SORT_OPTIONS: { value: AlbumSortOrder; labelKey: string }[] = [
  { value: 'artist', labelKey: 'sortArtistName' },
  { value: 'title', labelKey: 'sortAlbumTitle' },
];

const ARTIST_ALBUM_SORT_OPTIONS: { value: ArtistAlbumSortOrder; labelKey: string }[] = [
  { value: 'newest', labelKey: 'sortNewestFirst' },
  { value: 'oldest', labelKey: 'sortOldestFirst' },
];

const DATE_FORMAT_OPTIONS: { value: DateFormat; labelKey: string; example: string }[] = [
  { value: 'yyyy/mm/dd', labelKey: 'dateFormatMonthDay', example: '02/21' },
  { value: 'yyyy/dd/mm', labelKey: 'dateFormatDayMonth', example: '21/02' },
];

const LIST_LENGTH_OPTIONS: { value: ListLength; labelKey: string }[] = [
  { value: 20, labelKey: 'listLength20' },
  { value: 30, labelKey: 'listLength30' },
  { value: 50, labelKey: 'listLength50' },
  { value: 100, labelKey: 'listLength100' },
];

const ACCENT_COLORS: { labelKey: string; hex: string }[] = [
  { labelKey: 'colorBlueDefault', hex: '#1D9BF0' },
  { labelKey: 'colorRed', hex: '#E91429' },
  { labelKey: 'colorGreen', hex: '#00BA7C' },
  { labelKey: 'colorOrange', hex: '#FF6F00' },
  { labelKey: 'colorPurple', hex: '#7B61FF' },
  { labelKey: 'colorPink', hex: '#F91880' },
  { labelKey: 'colorTeal', hex: '#00BCD4' },
  { labelKey: 'colorYellow', hex: '#FFD600' },
];

export function SettingsAppearanceScreen() {
  const { t } = useTranslation();
  const { colors, preference, primaryColor, setThemePreference, setPrimaryColor } = useTheme();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const activePrimary = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const [accentOpen, setAccentOpen] = useState(false);
  const [sortOrderOpen, setSortOrderOpen] = useState(false);
  const [artistAlbumSortOpen, setArtistAlbumSortOpen] = useState(false);
  const [dateFormatOpen, setDateFormatOpen] = useState(false);
  const [listLengthOpen, setListLengthOpen] = useState(false);
  const activeAccentMatch = ACCENT_COLORS.find((c) => c.hex === activePrimary);
  const activeAccentLabel = activeAccentMatch ? t(activeAccentMatch.labelKey) : t('custom');

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

  const dateFormat = layoutPreferencesStore((s) => s.dateFormat);
  const setDateFormat = layoutPreferencesStore((s) => s.setDateFormat);

  const listLength = layoutPreferencesStore((s) => s.listLength);
  const setListLength = layoutPreferencesStore((s) => s.setListLength);

  const includePartialInDownloadedFilter = layoutPreferencesStore(
    (s) => s.includePartialInDownloadedFilter,
  );
  const setIncludePartialInDownloadedFilter = layoutPreferencesStore(
    (s) => s.setIncludePartialInDownloadedFilter,
  );

  const handleListLengthChange = useCallback(
    async (value: ListLength) => {
      setListLength(value);
      setListLengthOpen(false);
      if (offlineModeStore.getState().offlineMode) {
        Alert.alert(
          t('offlineListLengthTitle'),
          t('offlineListLengthMessage'),
        );
        return;
      }
      processingOverlayStore.getState().show(t('updatingCachedLists'));
      try {
        await Promise.all([
          albumListsStore.getState().refreshAll(),
          artistDetailStore.getState().refreshTopSongs(),
        ]);
        processingOverlayStore.getState().showSuccess(t('cachedListsUpdated'));
      } catch {
        processingOverlayStore.getState().showError(t('cachedListsUpdateFailed'));
      }
    },
    [setListLength, t]
  );

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
        sectionTitle: { color: colors.label },
        themeRow: { backgroundColor: colors.card, borderColor: colors.border },
        themeRowText: { color: colors.textPrimary },
        layoutRow: { backgroundColor: colors.card, borderColor: colors.border },
        layoutRowLabel: { color: colors.textPrimary },
      }),
    [colors]
  );

  return (
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('appearance')}</Text>
        <View style={styles.themeCard}>
          {THEME_OPTIONS.map((opt) => {
            const isSelected = preference === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.themeRow,
                  dynamicStyles.themeRow,
                  pressed && settingsStyles.pressed,
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
                    {t(opt.labelKey)}
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('accentColor')}</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setAccentOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && settingsStyles.pressed,
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
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <View style={styles.accentChip}>
                      <View style={[styles.chipDot, { backgroundColor: c.hex }]} />
                      <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                        {t(c.labelKey)}
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
                    pressed && settingsStyles.pressed,
                  ]}
                >
                  <Text style={[styles.resetButtonText, { color: colors.textSecondary }]}>
                    {t('resetToDefault')}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('language')}</Text>
        <LanguageSelector />
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('albumSortOrder')}</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setSortOrderOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {t(ALBUM_SORT_OPTIONS.find((o) => o.value === albumSortOrder)?.labelKey ?? 'sortArtistName')}
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
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {t(opt.labelKey)}
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('artistAlbumSortOrder')}</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setArtistAlbumSortOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {t(ARTIST_ALBUM_SORT_OPTIONS.find((o) => o.value === artistAlbumSortOrder)?.labelKey ?? 'sortNewestFirst')}
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
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {t(opt.labelKey)}
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('dateFormat')}</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setDateFormatOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {t(DATE_FORMAT_OPTIONS.find((o) => o.value === dateFormat)!.labelKey)}{' '}
              <Text style={{ color: colors.textSecondary }}>
                ({DATE_FORMAT_OPTIONS.find((o) => o.value === dateFormat)!.example})
              </Text>
            </Text>
            <Ionicons
              name={dateFormatOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          {dateFormatOpen && (
            <View style={[styles.accentList, { borderTopColor: colors.border }]}>
              {DATE_FORMAT_OPTIONS.map((opt) => {
                const isActive = dateFormat === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setDateFormat(opt.value);
                      setDateFormatOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.accentOption,
                      { borderBottomColor: colors.border },
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {t(opt.labelKey)}{' '}
                      <Text style={{ color: colors.textSecondary }}>({opt.example})</Text>
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('listLength')}</Text>
        <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>{t('listLengthHint')}</Text>
        <View style={[styles.accentDropdown, { backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setListLengthOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.accentHeader,
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
              {t(LIST_LENGTH_OPTIONS.find((o) => o.value === listLength)?.labelKey ?? 'listLength20')}
            </Text>
            <Ionicons
              name={listLengthOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          {listLengthOpen && (
            <View style={[styles.accentList, { borderTopColor: colors.border }]}>
              {LIST_LENGTH_OPTIONS.map((opt) => {
                const isActive = listLength === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handleListLengthChange(opt.value)}
                    style={({ pressed }) => [
                      styles.accentOption,
                      { borderBottomColor: colors.border },
                      pressed && settingsStyles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: colors.textPrimary }]}>
                      {t(opt.labelKey)}
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('filters')}</Text>
        <View style={[settingsStyles.card, { backgroundColor: colors.card }]}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>
                {t('includePartialDownloads')}
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                {t('includePartialDownloadsHint')}
              </Text>
            </View>
            <Switch
              value={includePartialInDownloadedFilter}
              onValueChange={setIncludePartialInDownloadedFilter}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>
      </View>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('libraryLayout')}</Text>
        <View style={styles.themeCard}>
          {LAYOUT_ROWS.map((row) => {
            const currentValue = layoutValues[row.key];
            return (
              <View
                key={row.key}
                style={[styles.layoutRow, dynamicStyles.layoutRow]}
              >
                <Text style={[styles.layoutRowLabel, dynamicStyles.layoutRowLabel]}>
                  {t(row.labelKey)}
                </Text>
                <View style={styles.layoutIcons}>
                  <Pressable
                    onPress={() => layoutSetters[row.key]('list')}
                    hitSlop={8}
                    style={({ pressed }) => pressed && settingsStyles.pressed}
                  >
                    <MaterialCommunityIcons
                      name="view-list-outline"
                      size={22}
                      color={currentValue === 'list' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => layoutSetters[row.key]('grid')}
                    hitSlop={8}
                    style={({ pressed }) => pressed && settingsStyles.pressed}
                  >
                    <MaterialCommunityIcons
                      name="view-grid-outline"
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

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('favoritesLayout')}</Text>
        <View style={styles.themeCard}>
          {FAV_LAYOUT_ROWS.map((row) => {
            const currentValue = favLayoutValues[row.key];
            return (
              <View
                key={row.key}
                style={[styles.layoutRow, dynamicStyles.layoutRow]}
              >
                <Text style={[styles.layoutRowLabel, dynamicStyles.layoutRowLabel]}>
                  {t(row.labelKey)}
                </Text>
                <View style={styles.layoutIcons}>
                  <Pressable
                    onPress={() => favLayoutSetters[row.key]('list')}
                    hitSlop={8}
                    style={({ pressed }) => pressed && settingsStyles.pressed}
                  >
                    <MaterialCommunityIcons
                      name="view-list-outline"
                      size={22}
                      color={currentValue === 'list' ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => favLayoutSetters[row.key]('grid')}
                    hitSlop={8}
                    style={({ pressed }) => pressed && settingsStyles.pressed}
                  >
                    <MaterialCommunityIcons
                      name="view-grid-outline"
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
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  sectionHint: {
    fontSize: 12,
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
  themeRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeRowLabel: {
    fontSize: 16,
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
    gap: 8,
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
    fontSize: 16,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 16,
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
});
