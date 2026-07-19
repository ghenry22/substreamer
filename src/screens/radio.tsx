import Ionicons from "@react-native-vector-icons/ionicons/static";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useRouter } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { RadioStationSheet } from '../components/RadioStationSheet';
import { StationLogo } from '../components/StationLogo';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { playTrack } from '../services/playerService';
import {
  RADIO_ID_PREFIX,
  radioStationToChild,
  stationLogoUrl,
  type InternetRadioStation,
} from '../services/subsonicService';
import { playerStore } from '../store/playerStore';
import { radioNowPlayingStore } from '../store/radioNowPlayingStore';
import { radioStore } from '../store/radioStore';
import { settingsStyles } from '../styles/settingsStyles';
import { selectionAsync } from '../utils/haptics';
import { minDelay } from '../utils/stringHelpers';

/** Strip the protocol for a compact one-line subtitle. */
function stationSubtitle(station: InternetRadioStation): string {
  const url = station.homePageUrl || station.streamUrl;
  return url.replace(/^https?:\/\//, '');
}

/** Show the filter field only once the list is long enough to need it. */
const FILTER_THRESHOLD = 6;

export function RadioScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();

  const stations = radioStore((s) => s.stations);
  const loading = radioStore((s) => s.loading);
  const loaded = radioStore((s) => s.loaded);
  const favoriteIds = radioStore((s) => s.favoriteStationIds);
  const currentTrackId = playerStore((s) => s.currentTrack?.id ?? null);
  const nowPlayingTitle = radioNowPlayingStore((s) => s.title);
  const nowPlayingTrackId = radioNowPlayingStore((s) => s.trackId);

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('');
  const [sheet, setSheet] = useState<
    { mode: 'create' } | { mode: 'edit'; station: InternetRadioStation } | null
  >(null);

  useEffect(() => {
    radioStore.getState().fetchStations();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    await radioStore.getState().fetchStations();
    await delay;
    setRefreshing(false);
  }, []);

  // The whole (unfiltered) station list becomes the queue, so lock-screen /
  // player next-previous buttons hop between stations.
  const handlePlay = useCallback((stationId: string) => {
    selectionAsync();
    const children = radioStore.getState().stations.map(radioStationToChild);
    const child = children.find((c) => c.id === `${RADIO_ID_PREFIX}${stationId}`);
    if (child) playTrack(child, children);
  }, []);

  const handleToggleFavorite = useCallback((stationId: string) => {
    selectionAsync();
    radioStore.getState().toggleFavorite(stationId);
  }, []);

  const handleLongPress = useCallback((station: InternetRadioStation) => {
    selectionAsync();
    setSheet({ mode: 'edit', station });
  }, []);

  const normalizedFilter = filter.trim().toLowerCase();
  const { pinned, rest } = useMemo(() => {
    const matches = normalizedFilter
      ? stations.filter((s) => s.name.toLowerCase().includes(normalizedFilter))
      : stations;
    const favoriteSet = new Set(favoriteIds);
    return {
      pinned: matches.filter((s) => favoriteSet.has(s.id)),
      rest: matches.filter((s) => !favoriteSet.has(s.id)),
    };
  }, [stations, favoriteIds, normalizedFilter]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        stationTitle: { color: colors.textPrimary },
        stationSubtitle: { color: colors.textSecondary },
        separator: { borderBottomColor: colors.border },
        filterInput: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
      }),
    [colors],
  );

  const renderStationRow = useCallback(
    (station: InternetRadioStation, index: number, count: number) => {
      const childId = `${RADIO_ID_PREFIX}${station.id}`;
      const isActive = currentTrackId === childId;
      const isPinned = favoriteIds.includes(station.id);
      const subtitle =
        isActive && nowPlayingTrackId === childId && nowPlayingTitle
          ? nowPlayingTitle
          : stationSubtitle(station);
      return (
        <Pressable
          key={station.id}
          onPress={() => handlePlay(station.id)}
          onLongPress={() => handleLongPress(station)}
          delayLongPress={400}
          style={({ pressed }) => [
            styles.stationRow,
            index < count - 1 && dynamicStyles.separator,
            index < count - 1 && styles.stationRowBorder,
            pressed && styles.rowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('playRadioStation', { name: station.name })}
        >
          <StationLogo uri={stationLogoUrl(station)} active={isActive} />
          <View style={styles.stationInfo}>
            <Text
              style={[
                styles.stationTitle,
                dynamicStyles.stationTitle,
                isActive && { color: colors.primary },
              ]}
              numberOfLines={1}
            >
              {station.name}
            </Text>
            <Text
              style={[styles.stationSubtitle, dynamicStyles.stationSubtitle]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
          <Pressable
            onPress={() => handleToggleFavorite(station.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              isPinned
                ? t('unpinStation', { name: station.name })
                : t('pinStation', { name: station.name })
            }
            style={({ pressed }) => [styles.pinButton, pressed && styles.rowPressed]}
          >
            <Ionicons
              name={isPinned ? 'star' : 'star-outline'}
              size={18}
              color={isPinned ? colors.primary : colors.textSecondary}
            />
          </Pressable>
          <Ionicons
            name={isActive ? 'volume-high' : 'play'}
            size={18}
            color={isActive ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      );
    },
    [
      currentTrackId,
      favoriteIds,
      nowPlayingTitle,
      nowPlayingTrackId,
      colors.primary,
      colors.textSecondary,
      dynamicStyles,
      handlePlay,
      handleLongPress,
      handleToggleFavorite,
      t,
    ],
  );

  return (
    <GradientBackground scrollable>
      <ScrollView
        style={settingsStyles.container}
        contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            key={refreshControlKey}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textSecondary}
            progressViewOffset={headerHeight}
          />
        }
      >
        {stations.length >= FILTER_THRESHOLD && (
          <TextInput
            style={[styles.filterInput, dynamicStyles.filterInput]}
            value={filter}
            onChangeText={setFilter}
            placeholder={t('filterStations')}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        )}

        {pinned.length > 0 && (
          <View style={settingsStyles.section}>
            <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>
              {t('favoriteStations')}
            </Text>
            <View style={[settingsStyles.card, dynamicStyles.card]}>
              {pinned.map((station, index) => renderStationRow(station, index, pinned.length))}
            </View>
          </View>
        )}

        <View style={settingsStyles.section}>
          <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>
            {t('radioStations')}
          </Text>
          {loading && !loaded && stations.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : stations.length === 0 ? (
            <EmptyState
              icon="radio-outline"
              title={t('noRadioStations')}
              subtitle={t('noRadioStationsHint')}
            />
          ) : rest.length === 0 && pinned.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title={t('noCatalogResults')}
              subtitle={t('noCatalogResultsHint')}
            />
          ) : rest.length > 0 ? (
            <View style={[settingsStyles.card, dynamicStyles.card]}>
              {rest.map((station, index) => renderStationRow(station, index, rest.length))}
            </View>
          ) : null}
        </View>

        {/* Manage: add manually or search the public catalog. */}
        <View style={settingsStyles.section}>
          <View style={[settingsStyles.card, dynamicStyles.card]}>
            <Pressable
              onPress={() => setSheet({ mode: 'create' })}
              style={({ pressed }) => [
                styles.actionRow,
                dynamicStyles.separator,
                styles.stationRowBorder,
                pressed && styles.rowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('addRadioStation')}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
              <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>
                {t('addRadioStation')}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/radio-browser')}
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={t('browseStationCatalog')}
            >
              <Ionicons name="earth-outline" size={22} color={colors.primary} />
              <View style={styles.actionTextBlock}>
                <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>
                  {t('browseStationCatalog')}
                </Text>
                <Text style={[styles.actionHint, { color: colors.textSecondary }]}>
                  {t('browseStationCatalogHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <RadioStationSheet
        visible={sheet != null}
        station={sheet?.mode === 'edit' ? sheet.station : null}
        onClose={() => setSheet(null)}
      />
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  filterInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 4,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  stationRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    opacity: 0.7,
  },
  stationInfo: {
    flex: 1,
  },
  stationTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  stationSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  pinButton: {
    padding: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  actionTextBlock: {
    flex: 1,
  },
  actionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  actionHint: {
    fontSize: 13,
    marginTop: 2,
  },
});
