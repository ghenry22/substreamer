import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import {
  createBackup,
  listBackups,
  makeBackupIdentityKey,
  pruneBackups,
  restoreBackup,
  type BackupEntry,
} from '../services/backupService';
import { cancelAllSyncs, forceFullResync, runFullAlbumDetailSync } from '../services/dataSyncService';
import { canUserShare } from '../services/serverCapabilityService';
import { albumDetailStore } from '../store/albumDetailStore';
import { albumLibraryStore } from '../store/albumLibraryStore';
import { authStore } from '../store/authStore';
import { backupStore } from '../store/backupStore';
import { completedScrobbleStore } from '../store/completedScrobbleStore';
import { songIndexStore } from '../store/songIndexStore';
import { syncStatusStore } from '../store/syncStatusStore';
import { mbidOverrideStore } from '../store/mbidOverrideStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { pendingScrobbleStore } from '../store/pendingScrobbleStore';
import { scrobbleExclusionStore } from '../store/scrobbleExclusionStore';
import { shareSettingsStore } from '../store/shareSettingsStore';
import { sharesStore } from '../store/sharesStore';
import { settingsStyles } from '../styles/settingsStyles';
import { formatBytes } from '../utils/formatters';
import { minDelay } from '../utils/stringHelpers';

const MIN_SPINNER_MS = 600;
const SUCCESS_DELAY_MS = 600;
const ERROR_DELAY_MS = 2000;

type RestoreState = 'idle' | 'restoring' | 'success' | 'error';

function formatDate(date: Date | string | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(i18next.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(date: Date | string | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(i18next.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SettingsLibraryDataScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  // --- Library sync state ---
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const librarySize = albumLibraryStore((s) => s.albums.length);
  const libraryLastFetchedAt = albumLibraryStore((s) => s.lastFetchedAt);
  const detailCacheSize = albumDetailStore((s) => Object.keys(s.albums).length);
  const songIndexSize = songIndexStore((s) => s.totalCount);
  const syncPhase = syncStatusStore((s) => s.detailSyncPhase);

  // --- Listening History state ---
  const pendingScrobbleCount = pendingScrobbleStore((s) => s.pendingScrobbles.length);
  const completedScrobbleCount = completedScrobbleStore((s) => s.completedScrobbles.length);
  const scrobbleExclusionCount = scrobbleExclusionStore((s) =>
    Object.keys(s.excludedAlbums).length +
    Object.keys(s.excludedArtists).length +
    Object.keys(s.excludedPlaylists).length,
  );

  // --- Metadata Corrections state ---
  const mbidArtistOverrideCount = mbidOverrideStore((s) =>
    Object.values(s.overrides).filter((o) => o.type === 'artist').length,
  );
  const mbidAlbumOverrideCount = mbidOverrideStore((s) =>
    Object.values(s.overrides).filter((o) => o.type === 'album').length,
  );

  // --- Backup & Restore state ---
  const autoBackupEnabled = backupStore((s) => s.autoBackupEnabled);
  const serverUrl = authStore((s) => s.serverUrl);
  const authUsername = authStore((s) => s.username);
  const backupIdentityKey = serverUrl && authUsername
    ? makeBackupIdentityKey(serverUrl, authUsername)
    : null;
  const lastBackupTime = backupStore((s) =>
    backupIdentityKey ? s.lastBackupTimes[backupIdentityKey] ?? null : null,
  );

  const [restoreSheetVisible, setRestoreSheetVisible] = useState(false);
  const [restoreBackupsList, setRestoreBackupsList] = useState<BackupEntry[]>([]);
  const [otherBackups, setOtherBackups] = useState<BackupEntry[]>([]);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupEntry | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreState>('idle');
  const [backingUp, setBackingUp] = useState(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const otherChevronRotation = useSharedValue(0);
  const otherChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${otherChevronRotation.value}deg` }],
  }));

  useEffect(() => {
    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, []);

  const handleForceResync = useCallback(() => {
    if (offlineMode) return;
    alert(
      t('syncLibrary'),
      t('syncLibraryDescription'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('syncNow'),
          onPress: () => {
            void forceFullResync();
          },
        },
      ],
    );
  }, [alert, offlineMode, t]);

  const handleCancelRunningSync = useCallback(() => {
    cancelAllSyncs('user-cancel');
  }, []);

  const handleResumeSync = useCallback(() => {
    if (offlineMode) return;
    void runFullAlbumDetailSync();
  }, [offlineMode]);

  const handleToggleAutoBackup = useCallback(() => {
    backupStore.getState().setAutoBackupEnabled(!autoBackupEnabled);
  }, [autoBackupEnabled]);

  const handleBackUpNow = useCallback(async () => {
    setBackingUp(true);
    try {
      await createBackup();
      await pruneBackups();
    } catch {
      alert(t('backupFailed'), t('backupFailedMessage'));
    } finally {
      setBackingUp(false);
    }
  }, []);

  const handleOpenRestoreSheet = useCallback(async () => {
    const { serverUrl: url, username } = authStore.getState();
    const result = url && username
      ? await listBackups({ serverUrl: url, username })
      : await listBackups();
    setRestoreBackupsList(result.current);
    setOtherBackups(result.other);
    setSelectedBackup(null);
    setRestoreState('idle');
    setOtherExpanded(false);
    otherChevronRotation.value = 0;
    setRestoreSheetVisible(true);
  }, [otherChevronRotation]);

  const handleCloseRestoreSheet = useCallback(() => {
    if (restoreState === 'restoring') return;
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    setRestoreSheetVisible(false);
    setRestoreBackupsList([]);
    setOtherBackups([]);
    setSelectedBackup(null);
    setRestoreState('idle');
  }, [restoreState]);

  const handleSelectBackup = useCallback((entry: BackupEntry) => {
    if (restoreState !== 'idle') return;
    setSelectedBackup((prev) => prev?.stem === entry.stem ? null : entry);
  }, [restoreState]);

  const handleRestore = useCallback(async () => {
    if (!selectedBackup) return;

    if (restoreState === 'error') {
      setRestoreState('idle');
      return;
    }

    if (restoreTimer.current) clearTimeout(restoreTimer.current);

    const entry = selectedBackup;
    const parts: string[] = [];
    if (entry.scrobbleCount > 0) {
      parts.push(t('backupScrobbleCount', { count: entry.scrobbleCount }));
    }
    if (entry.mbidOverrideCount > 0) {
      parts.push(t('backupMbidOverrideCount', { count: entry.mbidOverrideCount }));
    }
    if (entry.scrobbleExclusionCount > 0) {
      parts.push(t('backupExclusionCount', { count: entry.scrobbleExclusionCount }));
    }
    const dateStr = new Date(entry.createdAt).toLocaleString(i18next.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    alert(
      t('restoreBackupConfirm'),
      t('restoreBackupConfirmMessage', { date: dateStr, details: parts.join(', ') }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('restore'),
          style: 'destructive',
          onPress: async () => {
            setRestoreState('restoring');
            const [result] = await Promise.allSettled([
              restoreBackup(entry),
              minDelay(MIN_SPINNER_MS),
            ]);

            if (result.status === 'fulfilled') {
              setRestoreState('success');
              restoreTimer.current = setTimeout(() => {
                setRestoreSheetVisible(false);
                setRestoreBackupsList([]);
                setOtherBackups([]);
                setSelectedBackup(null);
                setRestoreState('idle');
              }, SUCCESS_DELAY_MS);
            } else {
              setRestoreState('error');
              restoreTimer.current = setTimeout(() => {
                setRestoreState('idle');
              }, ERROR_DELAY_MS);
            }
          },
        },
      ],
    );
  }, [selectedBackup, restoreState]);

  // --- Shares state ---
  const showShares = !offlineMode && canUserShare();
  const shares = sharesStore((s) => s.shares ?? []);
  const shareCount = shares.length;
  const expiredShareCount = useMemo(() => {
    const now = Date.now();
    return shares.filter((s) => {
      if (!s.expires) return false;
      const d = typeof s.expires === 'string' ? new Date(s.expires) : s.expires;
      return d.getTime() < now;
    }).length;
  }, [shares]);

  const shareBaseUrl = shareSettingsStore((s) => s.shareBaseUrl);
  const [shareUrlSheetVisible, setShareUrlSheetVisible] = useState(false);
  const [shareUrlInput, setShareUrlInput] = useState('');
  const [shareUrlSaved, setShareUrlSaved] = useState(false);

  const handleOpenShareUrlSheet = useCallback(() => {
    setShareUrlInput(shareBaseUrl ?? '');
    setShareUrlSaved(false);
    setShareUrlSheetVisible(true);
  }, [shareBaseUrl]);

  const handleSaveShareUrl = useCallback(() => {
    const trimmed = shareUrlInput.trim();
    shareSettingsStore.getState().setShareBaseUrl(trimmed || null);
    setShareUrlSaved(true);
    setTimeout(() => setShareUrlSheetVisible(false), 500);
  }, [shareUrlInput]);

  const handleResetShareUrl = useCallback(() => {
    shareSettingsStore.getState().setShareBaseUrl(null);
    setShareUrlInput('');
    setShareUrlSaved(true);
    setTimeout(() => setShareUrlSheetVisible(false), 500);
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
      }),
    [colors],
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Library Sync */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('librarySync')}</Text>
        <View style={[settingsStyles.card, dynamicStyles.card, settingsStyles.cardPadded]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('syncedAlbums')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {detailCacheSize} / {librarySize}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('syncedSongs')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {songIndexSize}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('pendingSync')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {Math.max(0, librarySize - detailCacheSize)}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('lastFetched')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {formatDateTime(libraryLastFetchedAt ? new Date(libraryLastFetchedAt) : null)}
            </Text>
          </View>
          <View style={settingsStyles.actionRow}>
            <Pressable
              onPress={handleForceResync}
              disabled={offlineMode}
              style={({ pressed }) => [
                settingsStyles.actionRowButton,
                { backgroundColor: colors.primary },
                pressed && !offlineMode && settingsStyles.pressed,
                offlineMode && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="refresh-circle-outline" size={18} color="#fff" />
              <Text style={[settingsStyles.actionRowButtonText, { color: '#fff' }]}>
                {t('syncLibrary')}
              </Text>
            </Pressable>
            {syncPhase === 'syncing' && (
              <Pressable
                onPress={handleCancelRunningSync}
                style={({ pressed }) => [
                  settingsStyles.actionRowButton,
                  { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                  pressed && settingsStyles.pressed,
                ]}
              >
                <Ionicons name="stop-circle-outline" size={18} color={colors.textPrimary} />
                <Text style={[settingsStyles.actionRowButtonText, { color: colors.textPrimary }]}>
                  {t('pauseSync')}
                </Text>
              </Pressable>
            )}
            {syncPhase === 'idle' && librarySize > 0 && detailCacheSize < librarySize && (
              <Pressable
                onPress={handleResumeSync}
                disabled={offlineMode}
                style={({ pressed }) => [
                  settingsStyles.actionRowButton,
                  { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                  pressed && !offlineMode && settingsStyles.pressed,
                  offlineMode && settingsStyles.disabled,
                ]}
              >
                <Ionicons name="play-circle-outline" size={18} color={colors.textPrimary} />
                <Text style={[settingsStyles.actionRowButtonText, { color: colors.textPrimary }]}>
                  {t('resumeSync')}
                </Text>
              </Pressable>
            )}
          </View>
          {offlineMode && (
            <View style={styles.offlineNotice}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.offlineNoticeText, { color: colors.textSecondary }]}>
                {t('syncLibraryOfflineNotice')}
              </Text>
            </View>
          )}
          <Text style={[settingsStyles.sectionHint, { color: colors.textSecondary }]}>
            {t('syncLibraryDescription')}
          </Text>
        </View>
      </View>

      {/* Listening History (was Scrobbles) */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('listeningHistory')}</Text>
        <View style={[settingsStyles.card, dynamicStyles.card, settingsStyles.cardPadded]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('pendingScrobbles')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {pendingScrobbleCount}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('completedScrobbles')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {completedScrobbleCount}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('scrobbleExclusions')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {scrobbleExclusionCount}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/scrobble-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="list-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                {t('browseScrobbles')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/scrobble-exclusion-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="eye-off-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                {t('manageExclusions')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Metadata Corrections (was MBID Overrides) */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('metadataCorrections')}</Text>
        <View style={[settingsStyles.card, dynamicStyles.card, settingsStyles.cardPadded]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('artistOverrides')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {mbidArtistOverrideCount}
            </Text>
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('albumOverrides')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {mbidAlbumOverrideCount}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/mbid-override-browser')}
            style={({ pressed }) => [
              settingsStyles.navRow,
              { borderTopColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <View style={settingsStyles.navRowLeft}>
              <Ionicons name="finger-print-outline" size={18} color={colors.textPrimary} />
              <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                {t('browseMbidOverrides')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Backup & Restore */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('backupRestore')}</Text>
        <View style={[settingsStyles.card, dynamicStyles.card, settingsStyles.cardPadded]}>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('autoBackup')}</Text>
            <Switch
              value={autoBackupEnabled}
              onValueChange={handleToggleAutoBackup}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('lastBackup')}</Text>
            <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
              {lastBackupTime
                ? new Date(lastBackupTime).toLocaleString(i18next.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : t('never')}
            </Text>
          </View>
          <View style={styles.backupButtonRow}>
            <Pressable
              onPress={handleBackUpNow}
              disabled={backingUp}
              style={({ pressed }) => [
                styles.backupActionButton,
                { backgroundColor: colors.primary },
                pressed && !backingUp && settingsStyles.pressed,
              ]}
            >
              {backingUp ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.backupActionButtonText}>{t('backUp')}</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={handleOpenRestoreSheet}
              style={({ pressed }) => [
                styles.backupActionButton,
                { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Ionicons name="cloud-download-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.backupActionButtonText, { color: colors.textPrimary }]}>{t('restore')}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.backupDescription, { color: colors.textSecondary }]}>
          {Platform.OS === 'ios' ? t('backupDescriptionIos') : t('backupDescriptionAndroid')}
        </Text>
      </View>

      {/* Shares (conditional) */}
      {showShares && (
        <View style={settingsStyles.section}>
          <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('shares')}</Text>
          <View style={[settingsStyles.card, dynamicStyles.card, settingsStyles.cardPadded]}>
            <Pressable
              onPress={handleOpenShareUrlSheet}
              style={({ pressed }) => [
                settingsStyles.infoRow,
                { borderBottomColor: colors.border },
                pressed && settingsStyles.pressed,
              ]}
            >
              <View style={styles.shareUrlRow}>
                <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('shareUrl')}</Text>
                <Text style={[styles.shareUrlValue, { color: colors.textSecondary }]} numberOfLines={1}>
                  {shareBaseUrl || serverUrl || '—'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
            <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('activeShares')}</Text>
              <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
                {shareCount}
              </Text>
            </View>
            <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('expiredShares')}</Text>
              <Text style={[settingsStyles.infoValue, { color: expiredShareCount > 0 ? colors.red : colors.textSecondary }]}>
                {expiredShareCount}
              </Text>
            </View>
            <Pressable
              onPress={() => router.push('/share-browser')}
              style={({ pressed }) => [
                settingsStyles.navRow,
                { borderTopColor: colors.border },
                pressed && settingsStyles.pressed,
              ]}
            >
              <View style={settingsStyles.navRowLeft}>
                <Ionicons name="share-social-outline" size={18} color={colors.textPrimary} />
                <Text style={[settingsStyles.navRowText, { color: colors.textPrimary }]}>
                  {t('browseShares')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>

    {/* Restore Backup Modal */}
    <Modal
      visible={restoreSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={handleCloseRestoreSheet}
    >
      <Pressable
        style={settingsStyles.sheetBackdrop}
        onPress={handleCloseRestoreSheet}
      />
      <View
        style={[
          settingsStyles.sheet,
          { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[settingsStyles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.restoreTitle, { color: colors.textPrimary }]}>
          {t('restoreBackup')}
        </Text>
        <Text style={[styles.restoreSubtitle, { color: colors.textSecondary }]}>
          {t('restoreBackupHint')}
        </Text>
        {restoreBackupsList.length === 0 && otherBackups.length === 0 ? (
          <View style={styles.emptyBackups}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.primary} />
            <Text style={[styles.emptyBackupsText, { color: colors.textSecondary }]}>
              {t('noBackupsAvailable')}
            </Text>
          </View>
        ) : (
          <>
            {restoreBackupsList.map((entry) => {
              const isSelected = selectedBackup?.stem === entry.stem;
              const dateStr = new Date(entry.createdAt).toLocaleString(i18next.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              });
              const details: string[] = [];
              if (entry.scrobbleCount > 0) {
                details.push(t('backupScrobbleCount', { count: entry.scrobbleCount }));
              }
              if (entry.mbidOverrideCount > 0) {
                details.push(t('backupMbidOverrideCount', { count: entry.mbidOverrideCount }));
              }
              const entryTotalBytes = entry.scrobbleSizeBytes + entry.mbidOverrideSizeBytes + entry.scrobbleExclusionSizeBytes;
              return (
                <Pressable
                  key={entry.stem}
                  onPress={() => handleSelectBackup(entry)}
                  style={({ pressed }) => [
                    styles.restoreRow,
                    { borderBottomColor: colors.border },
                    isSelected && { borderLeftColor: colors.primary, borderLeftWidth: 3 },
                    pressed && styles.restoreRowPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.restoreRowTitle,
                      { color: colors.textPrimary },
                      isSelected && { color: colors.primary },
                    ]}
                  >
                    {dateStr}
                  </Text>
                  <Text style={[styles.restoreRowDetail, { color: colors.textSecondary }]}>
                    {details.join(', ')} · {formatBytes(entryTotalBytes)}
                  </Text>
                </Pressable>
              );
            })}

            {otherBackups.length > 0 && (
              <>
                <Pressable
                  onPress={() => {
                    setOtherExpanded((prev) => {
                      otherChevronRotation.value = withTiming(prev ? 0 : 90, { duration: 200 });
                      return !prev;
                    });
                  }}
                  style={[styles.otherBackupsHeader, { borderBottomColor: colors.border }]}
                >
                  <Text style={[styles.otherBackupsTitle, { color: colors.textSecondary }]}>
                    {t('otherBackups')}
                  </Text>
                  <Animated.View style={otherChevronStyle}>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </Animated.View>
                </Pressable>
                {otherExpanded && otherBackups.map((entry) => {
                  const isSelected = selectedBackup?.stem === entry.stem;
                  const dateStr = new Date(entry.createdAt).toLocaleString(i18next.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  });
                  const details: string[] = [];
                  if (entry.scrobbleCount > 0) {
                    details.push(t('backupScrobbleCount', { count: entry.scrobbleCount }));
                  }
                  if (entry.mbidOverrideCount > 0) {
                    details.push(t('backupMbidOverrideCount', { count: entry.mbidOverrideCount }));
                  }
                  const entryTotalBytes = entry.scrobbleSizeBytes + entry.mbidOverrideSizeBytes + entry.scrobbleExclusionSizeBytes;
                  return (
                    <Pressable
                      key={entry.stem}
                      onPress={() => handleSelectBackup(entry)}
                      style={({ pressed }) => [
                        styles.restoreRow,
                        { borderBottomColor: colors.border },
                        isSelected && { borderLeftColor: colors.primary, borderLeftWidth: 3 },
                        pressed && styles.restoreRowPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.restoreRowTitle,
                          { color: colors.textPrimary },
                          isSelected && { color: colors.primary },
                        ]}
                      >
                        {dateStr}
                      </Text>
                      <Text style={[styles.restoreRowDetail, { color: colors.textSecondary }]}>
                        {details.join(', ')} · {formatBytes(entryTotalBytes)}
                      </Text>
                      {entry.serverUrl && (
                        <Text style={[styles.restoreRowServer, { color: colors.label }]}>
                          {entry.serverUrl}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </>
            )}

            <View style={styles.restoreActions}>
              <Pressable
                onPress={handleRestore}
                disabled={!selectedBackup || restoreState === 'restoring' || restoreState === 'success'}
                style={({ pressed }) => [
                  styles.restoreButton,
                  restoreState === 'success'
                    ? { backgroundColor: colors.green }
                    : restoreState === 'error'
                      ? { backgroundColor: colors.red }
                      : { backgroundColor: colors.primary },
                  pressed && restoreState === 'idle' && selectedBackup && settingsStyles.pressed,
                  (!selectedBackup && restoreState === 'idle') && settingsStyles.disabled,
                ]}
              >
                {restoreState === 'restoring' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : restoreState === 'success' ? (
                  <Ionicons name="checkmark" size={20} color="#fff" />
                ) : restoreState === 'error' ? (
                  <View style={styles.restoreErrorContent}>
                    <Ionicons name="alert-circle" size={20} color="#fff" />
                    <Text style={styles.restoreButtonText}>
                      {t('failedToRestoreTapToRetry')}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.restoreButtonText}>{t('restore')}</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>

    {/* Share URL Sheet */}
    <Modal
      visible={shareUrlSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setShareUrlSheetVisible(false)}
    >
      <Pressable
        style={settingsStyles.sheetBackdrop}
        onPress={() => setShareUrlSheetVisible(false)}
      />
      <View
        style={[
          settingsStyles.sheet,
          { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[settingsStyles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.shareUrlSheetTitle, { color: colors.textPrimary }]}>
          {t('shareUrl')}
        </Text>
        <Text style={[styles.shareUrlSheetHint, { color: colors.textSecondary }]}>
          {serverUrl ? t('shareUrlHintWithServer', { serverUrl }) : t('shareUrlHint')}
        </Text>
        <TextInput
          style={[styles.shareUrlInput, { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border }]}
          value={shareUrlInput}
          onChangeText={setShareUrlInput}
          placeholder={serverUrl ?? 'https://your-server.com'}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleSaveShareUrl}
          autoFocus
        />
        <View style={styles.shareUrlButtons}>
          <Pressable
            onPress={handleResetShareUrl}
            style={({ pressed }) => [
              styles.shareUrlButton,
              styles.shareUrlResetButton,
              { borderColor: colors.border },
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={[styles.shareUrlResetText, { color: colors.textPrimary }]}>
              {t('resetToDefault')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSaveShareUrl}
            style={({ pressed }) => [
              styles.shareUrlButton,
              { backgroundColor: colors.primary },
              pressed && settingsStyles.pressed,
            ]}
          >
            <Text style={styles.shareUrlButtonText}>
              {shareUrlSaved ? t('saved') : t('save')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
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
  backupButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  backupActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 10,
  },
  backupActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backupDescription: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 4,
  },
  shareUrlRow: {
    flex: 1,
    marginRight: 8,
  },
  shareUrlValue: {
    fontSize: 12,
    marginTop: 2,
  },
  shareUrlSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  shareUrlSheetHint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  shareUrlInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  shareUrlButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  shareUrlButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareUrlButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  shareUrlResetButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  shareUrlResetText: {
    fontSize: 16,
    fontWeight: '600',
  },
  restoreTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  restoreSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  restoreRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  restoreRowPressed: {
    opacity: 0.6,
  },
  restoreRowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  restoreRowDetail: {
    fontSize: 12,
  },
  restoreRowServer: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  otherBackupsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  otherBackupsTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  restoreActions: {
    paddingHorizontal: 4,
    marginTop: 16,
    marginBottom: 8,
  },
  restoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 48,
  },
  restoreErrorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  restoreButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBackups: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyBackupsText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
