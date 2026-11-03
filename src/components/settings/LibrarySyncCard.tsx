import Ionicons from '@react-native-vector-icons/ionicons/static';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../hooks/useTheme';
import { settingsStyles } from '../../styles/settingsStyles';
import { cancelAllSyncs, forceFullResync, resumeSync } from '../../services/dataSyncService';
import { migrationGateStore } from '../../store/migrationGateStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { syncStatusStore } from '../../store/syncStatusStore';
import { OfflineNotice } from './OfflineNotice';
import { SettingsSectionTitle } from './SettingsSectionTitle';
import { formatShortDateTime } from '../../utils/dateFormat';
import type { IoniconsName } from '../../utils/iconNames';

export function LibrarySyncCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  // A needed re-key that has not run blocks every library write for the session, so the
  // sync controls below would accept a tap and do nothing. Say so instead.
  const reidDeferred = migrationGateStore((s) => s.deferred);
  const reidDeferredAfterFailure = migrationGateStore((s) => s.deferredAfterFailure);
  const syncBlocked = offlineMode || reidDeferred;
  const lastSyncAt = syncStatusStore((s) => s.fullSyncCompletedAt);
  const librarySyncPhase = syncStatusStore((s) => s.librarySyncPhase);
  const songSyncPhase = syncStatusStore((s) => s.detailSyncPhase);
  const librarySyncComplete = syncStatusStore((s) => s.librarySyncComplete);
  const songSyncComplete = syncStatusStore((s) => s.songSyncComplete);
  const migPhase = syncStatusStore((s) => s.normalizedMigrationPhase);
  const migDone = syncStatusStore((s) => s.normalizedMigrationDone);
  const migTotal = syncStatusStore((s) => s.normalizedMigrationTotal);
  const albumsProcessed = syncStatusStore((s) => s.detailSyncCompleted);
  const albumsTotal = syncStatusStore((s) => s.detailSyncTotal);
  const songSyncFinalizing = syncStatusStore((s) => s.songSyncFinalizing);
  // Which transport the run is actually using. `songSyncStrategy` wins because the
  // song phase can fall back to the per-album walk at runtime even on a search3 server.
  const songSyncStrategy = syncStatusStore((s) => s.songSyncStrategy);
  const syncStrategy = syncStatusStore((s) => s.syncStrategy);

  // One-time blob→normalized migration progress (bar + % + counts on the card).
  const isMigrating = migPhase === 'migrating';
  const migPct = migTotal > 0 ? Math.min(100, Math.floor((migDone / migTotal) * 100)) : 0;

  // Song-sync progress = albums-whose-songs-we-have / total-albums.
  const songSyncPct = albumsTotal > 0 ? Math.min(100, Math.floor((albumsProcessed / albumsTotal) * 100)) : 0;

  // Counts reflect the NORMALIZED model (the target-state sync's output), refreshed
  // as the sync progresses. Null until the first query resolves (shown as 0).

  // A sync is actively running when either the album-list fetch or the song
  // fetch is in progress.
  const isSyncing = librarySyncPhase === 'fetching' || songSyncPhase === 'syncing';
  const forceLegacySync = syncStatusStore((st) => st.forceLegacySync);
  const albumSyncStrategy = syncStatusStore((st) => st.albumSyncStrategy);
  const librarySyncCursor = syncStatusStore((st) => st.librarySyncCursor);
  const songSyncFetched = syncStatusStore((st) => st.songSyncFetched);
  const lastSyncError = syncStatusStore((st) => st.lastSyncError);

  // The transport actually in use, chosen by phase. `syncStrategy` is only what the
  // probe found; either phase can fall back at runtime, and `songSyncStrategy` is
  // persisted so it would otherwise mask the album transport on a resume.
  const albumPhaseActive = librarySyncPhase === 'fetching';
  const transport = albumPhaseActive
    ? (albumSyncStrategy ?? syncStrategy)
    : (songSyncStrategy ?? syncStrategy);

  // This card is sync STATUS, so both rows are the current sync's progress and reset
  // to 0 when one starts. A row count cannot serve: a resync overwrites in place
  // rather than dropping, so COUNT(*) sits at the previous total for the whole run.
  // The local library totals are deliberately not shown here — the app stays fully
  // usable during a long sync precisely because that data is left alone.
  const displayAlbums = librarySyncCursor;
  const displaySongs = songSyncFetched;
  const fullyComplete = librarySyncComplete && songSyncComplete;
  // Started but neither running nor finished (e.g. paused, or interrupted).
  // A run that has made progress but is neither running nor finished. Uses the
  // cursors rather than a row count, which would read as "paused" on any install
  // that simply has a library.
  // A request failure pauses at whatever offset it reached — including 0, which is
  // where the field instance (a 500 on the first page) lands. Without the phase test
  // there would be no Resume button and no explanation in exactly that case.
  const errorPaused = librarySyncPhase === 'paused-error' || songSyncPhase === 'paused-error';
  const isPaused =
    errorPaused
    || (!isSyncing && !fullyComplete && (librarySyncCursor > 0 || songSyncFetched > 0));
  const showSync = !isSyncing && !isPaused;

  const stageText =
    librarySyncPhase === 'fetching'
      ? t('fetchingAlbumList')
      : songSyncPhase === 'syncing'
        ? t('fetchingSongs')
        : null;

  // No confirm: the resync overwrites rows in place rather than dropping them, so
  // nothing is destroyed, the library stays browsable throughout, and Pause is right
  // there. The card hint carries the warning instead.
  // Clears the probed strategy on both edges (see the store), so the next sync
  // re-derives instead of resuming the previous transport.
  const handleToggleLegacySync = useCallback((next: boolean) => {
    syncStatusStore.getState().setForceLegacySync(next);
  }, []);

  const handleForceResync = useCallback(() => {
    if (syncBlocked) return;
    void forceFullResync();
  }, [syncBlocked]);

  const handlePause = useCallback(() => {
    cancelAllSyncs('user-cancel');
  }, []);

  const handleResume = useCallback(() => {
    if (syncBlocked) return;
    void resumeSync();
  }, [syncBlocked]);

  // Restart is the "unstick" recovery: cancel the in-flight sync, clear, and
  // re-run from scratch. No confirm — the user chose it during an active sync.
  const handleRestart = useCallback(() => {
    if (syncBlocked) return;
    void forceFullResync();
  }, [syncBlocked]);

  const secondaryButton = (
    onPress: () => void,
    icon: IoniconsName,
    label: string,
    key: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={syncBlocked && key !== 'pause'}
      style={({ pressed }) => [
        settingsStyles.actionRowButton,
        { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
        pressed && settingsStyles.pressed,
        syncBlocked && key !== 'pause' && settingsStyles.disabled,
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.textPrimary} />
      <Text style={[settingsStyles.actionRowButtonText, { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={settingsStyles.section}>
      <SettingsSectionTitle>{t('librarySync')}</SettingsSectionTitle>
      <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
        <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
          <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('albums')}</Text>
          <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>{displayAlbums}</Text>
        </View>
        <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
          <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('songs')}</Text>
          <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>{displaySongs}</Text>
        </View>
        <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
          <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('lastSync')}</Text>
          <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
            {formatShortDateTime(lastSyncAt ? new Date(lastSyncAt) : null)}
          </Text>
        </View>

        {isMigrating && (
          <View style={styles.progressBlock}>
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.textSecondary, flex: 1 }]}>
                {t('upgradingLibraryCard')}
              </Text>
              <Text style={[styles.statusPct, { color: colors.textPrimary }]}>{migPct}%</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${migPct}%` }]} />
            </View>
          </View>
        )}

        {!isMigrating && isSyncing && !albumPhaseActive && (albumsTotal > 0 || songSyncFinalizing) && (
          <View style={styles.progressBlock}>
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.textSecondary, flex: 1 }]}>
                {songSyncFinalizing ? t('finalizingLibrary') : stageText}
              </Text>
              <Text style={[styles.statusPct, { color: colors.textPrimary }]}>
                {songSyncFinalizing ? 100 : songSyncPct}%
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: colors.primary, width: `${songSyncFinalizing ? 100 : songSyncPct}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressCounts, { color: colors.textSecondary }]}>
              {albumsProcessed} / {albumsTotal}
            </Text>
            {transport && (
              <View style={styles.transportRow}>
                <Ionicons
                  name={transport === 'basic' ? 'albums-outline' : 'flash-outline'}
                  size={12}
                  color={colors.textSecondary}
                />
                <Text style={[styles.transportText, { color: colors.textSecondary }]}>
                  {transport === 'basic' ? t('syncTransportBasic') : t('syncTransportFast')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Paused by the user. The album loop exits on its generation guard without
            setting a phase, so nothing else would say why the spinner stopped. */}
        {!isMigrating && isPaused && (
          <View style={styles.statusRow}>
            <Ionicons
              name={errorPaused ? 'alert-circle-outline' : 'pause-circle-outline'}
              size={16}
              color={colors.textSecondary}
            />
            <View style={styles.legacyLabelWrap}>
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>
                {errorPaused ? t('syncPausedError') : t('syncPausedByUser')}
              </Text>
              {errorPaused && lastSyncError != null && (
                <Text style={[styles.legacyHint, { color: colors.textSecondary }]} numberOfLines={2}>
                  {lastSyncError}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Indeterminate: the album-LIST fetch, which has no known total until it
            ends. Carries the transport row too — the album phase is exactly when a
            runtime fallback happens, and the determinate block above never renders
            then, so a transport row only there would be invisible for it. */}
        {!isMigrating && isSyncing && (albumPhaseActive || albumsTotal === 0) && !songSyncFinalizing && stageText != null && (
          <View style={styles.progressBlock}>
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{stageText}</Text>
            </View>
            {transport && (
              <View style={styles.transportRow}>
                <Ionicons
                  name={transport === 'basic' ? 'albums-outline' : 'flash-outline'}
                  size={12}
                  color={colors.textSecondary}
                />
                <Text style={[styles.transportText, { color: colors.textSecondary }]}>
                  {transport === 'basic' ? t('syncTransportBasic') : t('syncTransportFast')}
                </Text>
              </View>
            )}
          </View>
        )}

        {reidDeferred && (
          <View style={styles.statusRow} testID="sync-card-reid-deferred">
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.statusText, { color: colors.textSecondary, flex: 1 }]}>
              {t(reidDeferredAfterFailure ? 'syncMigrationFailedPending' : 'syncPendingLibraryUpdate')}
            </Text>
          </View>
        )}

        <View style={[styles.legacyRow, { borderTopColor: colors.border }]}>
          <View style={styles.legacyLabelWrap}>
            <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>
              {t('legacySync')}
            </Text>
            <Text style={[styles.legacyHint, { color: colors.textSecondary }]}>
              {t('legacySyncHint')}
            </Text>
          </View>
          <Switch
            value={forceLegacySync}
            onValueChange={handleToggleLegacySync}
            disabled={isSyncing || isPaused}
          />
        </View>

        <View style={settingsStyles.actionRow}>
          {showSync && (
            <Pressable
              onPress={handleForceResync}
              disabled={syncBlocked}
              style={({ pressed }) => [
                settingsStyles.actionRowButton,
                { backgroundColor: colors.primary },
                pressed && !syncBlocked && settingsStyles.pressed,
                syncBlocked && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="refresh-circle-outline" size={18} color="#fff" />
              <Text style={[settingsStyles.actionRowButtonText, { color: '#fff' }]}>{t('syncLibrary')}</Text>
            </Pressable>
          )}
          {isSyncing && secondaryButton(handlePause, 'pause-circle-outline', t('pauseSync'), 'pause')}
          {isPaused && secondaryButton(handleResume, 'play-circle-outline', t('resumeSync'), 'resume')}
          {(isSyncing || isPaused) &&
            secondaryButton(handleRestart, 'refresh-circle-outline', t('restartSync'), 'restart')}
        </View>
        {offlineMode && !reidDeferred && <OfflineNotice text={t('syncLibraryOfflineNotice')} />}
        <Text style={[settingsStyles.sectionHint, { color: colors.textSecondary }]}>
          {t('syncLibraryDescription')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legacyLabelWrap: {
    flex: 1,
  },
  legacyHint: {
    fontSize: 12,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressBlock: {
    paddingBottom: 8,
  },
  statusPct: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressCounts: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
  },
  transportText: {
    fontSize: 11,
  },
});
