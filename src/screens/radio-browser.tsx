import Ionicons from "@react-native-vector-icons/ionicons/static";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { StationLogo } from '../components/StationLogo';
import { useTheme } from '../hooks/useTheme';
import { playTrack } from '../services/playerService';
import {
  catalogStationMeta,
  searchCatalogStations,
  type CatalogStation,
} from '../services/radioBrowserService';
import {
  createRadioStation,
  radioStationToChild,
  RADIO_ID_PREFIX,
} from '../services/subsonicService';
import { playbackToastStore } from '../store/playbackToastStore';
import { playerStore } from '../store/playerStore';
import { radioStore } from '../store/radioStore';
import { settingsStyles } from '../styles/settingsStyles';
import { selectionAsync } from '../utils/haptics';

const SEARCH_DEBOUNCE_MS = 500;

/**
 * Station catalog: searches the public radio-browser.info directory. A tap
 * plays the station immediately (as a one-off queue); the add button saves it
 * to the user's own server so it appears on the regular radio screen.
 */
export function RadioBrowserScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const currentTrackId = playerStore((s) => s.currentTrack?.id ?? null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogStation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Catalog ids added to the server this session (flips the add button). */
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  const requestSeq = useRef(0);

  const runSearch = useCallback(async (text: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    const stations = await searchCatalogStations(text);
    if (seq !== requestSeq.current) return; // stale response
    setLoading(false);
    if (stations === null) {
      setFailed(true);
    } else {
      setResults(stations);
    }
  }, []);

  // Initial load (most-voted stations) + debounced re-search on typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch(query);
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const handlePlay = useCallback((station: CatalogStation) => {
    selectionAsync();
    // One-off preview: the catalog station becomes a single-item radio queue
    // without touching the server list.
    const child = radioStationToChild({
      id: `catalog-${station.id}`,
      name: station.name,
      streamUrl: station.streamUrl,
      homePageUrl: station.homepage ?? undefined,
    });
    playTrack(child, [child]);
  }, []);

  const handleAdd = useCallback(
    async (station: CatalogStation) => {
      selectionAsync();
      setAddingId(station.id);
      const result = await createRadioStation({
        name: station.name,
        streamUrl: station.streamUrl,
        homepageUrl: station.homepage ?? undefined,
      });
      setAddingId(null);
      if (result.ok) {
        setAddedIds((prev) => new Set(prev).add(station.id));
        playbackToastStore.getState().flashSuccess(t('stationAddedToServer'));
        void radioStore.getState().fetchStations();
      } else {
        Alert.alert(t('addRadioStation'), result.error);
      }
    },
    [t],
  );

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        card: { backgroundColor: colors.card },
        separator: { borderBottomColor: colors.border },
        searchInput: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
      }),
    [colors],
  );

  return (
    <GradientBackground scrollable>
      <ScrollView
        style={settingsStyles.container}
        contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={[styles.searchInput, dynamicStyles.searchInput]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchStationsPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <Text style={[styles.attribution, { color: colors.textSecondary }]}>
          {t('browseStationCatalogHint')}
        </Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : failed ? (
          <EmptyState icon="cloud-offline-outline" title={t('catalogSearchFailed')}>
            <Pressable
              onPress={() => void runSearch(query)}
              style={({ pressed }) => [styles.retryButton, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={t('retry')}
            >
              <Text style={[styles.retryText, { color: colors.primary }]}>{t('retry')}</Text>
            </Pressable>
          </EmptyState>
        ) : results == null || results.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title={t('noCatalogResults')}
            subtitle={t('noCatalogResultsHint')}
          />
        ) : (
          <View style={settingsStyles.section}>
            <View style={[settingsStyles.card, dynamicStyles.card]}>
              {results.map((station, index) => {
                const isActive =
                  currentTrackId === `${RADIO_ID_PREFIX}catalog-${station.id}`;
                const added = addedIds.has(station.id);
                return (
                  <Pressable
                    key={station.id}
                    onPress={() => handlePlay(station)}
                    style={({ pressed }) => [
                      styles.stationRow,
                      index < results.length - 1 && dynamicStyles.separator,
                      index < results.length - 1 && styles.stationRowBorder,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('playRadioStation', { name: station.name })}
                  >
                    <StationLogo uri={station.favicon} active={isActive} />
                    <View style={styles.stationInfo}>
                      <Text
                        style={[
                          styles.stationTitle,
                          { color: isActive ? colors.primary : colors.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {station.name}
                      </Text>
                      <Text
                        style={[styles.stationSubtitle, { color: colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {catalogStationMeta(station)}
                      </Text>
                    </View>
                    {addingId === station.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Pressable
                        onPress={() => void handleAdd(station)}
                        disabled={added}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('addStationToServer', { name: station.name })}
                        style={({ pressed }) => [styles.addButton, pressed && styles.rowPressed]}
                      >
                        <Ionicons
                          name={added ? 'checkmark-circle' : 'add-circle-outline'}
                          size={24}
                          color={added ? colors.green : colors.primary}
                        />
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  searchInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  attribution: {
    fontSize: 12,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
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
  addButton: {
    padding: 4,
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
