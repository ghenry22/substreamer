import Ionicons from "@react-native-vector-icons/ionicons/static";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { playTrack } from '../services/playerService';
import {
  RADIO_ID_PREFIX,
  radioStationToChild,
  type InternetRadioStation,
} from '../services/subsonicService';
import { playerStore } from '../store/playerStore';
import { radioStore } from '../store/radioStore';
import { settingsStyles } from '../styles/settingsStyles';
import { selectionAsync } from '../utils/haptics';
import { minDelay } from '../utils/stringHelpers';

/** Strip the protocol for a compact one-line subtitle. */
function stationSubtitle(station: InternetRadioStation): string {
  const url = station.homePageUrl || station.streamUrl;
  return url.replace(/^https?:\/\//, '');
}

export function RadioScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();

  const stations = radioStore((s) => s.stations);
  const loading = radioStore((s) => s.loading);
  const loaded = radioStore((s) => s.loaded);
  const currentTrackId = playerStore((s) => s.currentTrack?.id ?? null);

  const [refreshing, setRefreshing] = useState(false);

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

  // The whole station list becomes the queue, so lock-screen / player
  // next-previous buttons hop between stations.
  const handlePlay = useCallback((index: number) => {
    selectionAsync();
    const children = radioStore.getState().stations.map(radioStationToChild);
    if (!children[index]) return;
    playTrack(children[index], children);
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        stationTitle: { color: colors.textPrimary },
        stationSubtitle: { color: colors.textSecondary },
        separator: { borderBottomColor: colors.border },
        iconCircle: { backgroundColor: colors.primary + '18' },
      }),
    [colors],
  );

  return (
    <GradientBackground scrollable>
      <ScrollView
        style={settingsStyles.container}
        contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
        showsVerticalScrollIndicator={false}
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
          ) : (
            <View style={[settingsStyles.card, dynamicStyles.card]}>
              {stations.map((station, index) => {
                const isActive = currentTrackId === `${RADIO_ID_PREFIX}${station.id}`;
                return (
                  <Pressable
                    key={station.id}
                    onPress={() => handlePlay(index)}
                    style={({ pressed }) => [
                      styles.stationRow,
                      index < stations.length - 1 && dynamicStyles.separator,
                      index < stations.length - 1 && styles.stationRowBorder,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('playRadioStation', { name: station.name })}
                  >
                    <View style={[styles.iconCircle, dynamicStyles.iconCircle]}>
                      <Ionicons
                        name={isActive ? 'radio' : 'radio-outline'}
                        size={20}
                        color={colors.primary}
                      />
                    </View>
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
                        {stationSubtitle(station)}
                      </Text>
                    </View>
                    <Ionicons
                      name={isActive ? 'volume-high' : 'play'}
                      size={18}
                      color={isActive ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
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
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
});
