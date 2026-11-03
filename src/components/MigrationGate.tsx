/**
 * Blocking screen shown between the splash and the app while a slow, one-time data
 * migration runs.
 *
 * Exists for two reasons. A splash that sits for two minutes reads as a hung app, and the
 * work here can take that long on a large library — so it says what is happening and shows
 * progress through the parts that are countable. And because the app has not launched
 * behind it, holding it here is what keeps the migration from racing the startup effects,
 * which is otherwise a check scattered across the codebase.
 *
 * Not dismissible: the app genuinely is not ready.
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';
import { currentServerInfo, probedServerVersion } from '../services/navidromeReid/reidMarker';
import { migrationGateStore, type MigrationStageId } from '../store/migrationGateStore';

/** Stage order, and the i18n key for each label. */
const STAGE_LABELS: ReadonlyArray<{ id: MigrationStageId; key: string }> = [
  { id: 'waitingForTasks', key: 'migrationStageWaiting' },
  { id: 'preparing', key: 'migrationStagePreparing' },
  { id: 'updatingDownloads', key: 'migrationStageUpdatingDownloads' },
  { id: 'movingFiles', key: 'migrationStageMovingFiles' },
  { id: 'refreshingArtwork', key: 'migrationStageRefreshingArtwork' },
  { id: 'finishing', key: 'migrationStageFinishing' },
];

interface MigrationGateProps {
  /** Start the pass after the user confirms their server is updated. */
  onConfirm?: () => void;
  /** The user chose legacy mode for this session. */
  onLegacy?: () => void;
  /** Re-run after a failure. */
  onRetry?: () => void;
  /** Carry on without the update after a failure that wrote nothing. */
  onContinue?: () => void;
}

function MigrationGateInner({ onConfirm, onLegacy, onRetry, onContinue }: MigrationGateProps): React.ReactElement | null {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const visible = migrationGateStore((s) => s.visible);
  const mode = migrationGateStore((s) => s.mode);
  const activeStage = migrationGateStore((s) => s.activeStage);
  const stages = migrationGateStore((s) => s.stages);
  const failed = migrationGateStore((s) => s.failed);
  const hasWritten = migrationGateStore((s) => s.hasWritten);

  if (!visible) return null;

  const activeIndex = STAGE_LABELS.findIndex((s) => s.id === activeStage);

  // Finished. Shown rather than dismissed automatically: this is a one-shot irreversible
  // migration, and a screen that silently vanishes leaves the user with no confirmation it
  // ran at all. Startup work proceeds behind this — the marker is stamped, so nothing is
  // waiting on the tap.
  if (mode === 'complete') {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <View style={styles.content}>
          <Animated.Text
            entering={ZoomIn.springify().damping(12)}
            style={[styles.tick, { color: colors.primary }]}
          >
            {'\u2713'}
          </Animated.Text>
          <Animated.View entering={FadeIn.delay(150)}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('migrationCompleteTitle')}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {t('migrationCompleteBody')}
            </Text>
          </Animated.View>
          {/* What happens NEXT. The library is empty until the first sync refills it and
              downloaded artwork is re-fetched on demand, so without this the user meets a
              sparse library and blank covers right after being told it all worked. */}
          <Animated.View
            entering={FadeIn.delay(250)}
            style={[styles.note, { borderColor: colors.border }]}
          >
            <Text style={[styles.noteText, { color: colors.textSecondary }]}>
              {t('migrationCompleteNote')}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeIn.delay(300)} style={styles.completeButtonWrap}>
            <Pressable
              accessibilityRole="button"
              onPress={() => migrationGateStore.getState().hide()}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.primaryButtonLabel}>{t('migrationCompleteContinue')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    );
  }

  // The server reports no version number, so only the user knows whether it has the new
  // ids. Shown with the string the server sent, so they can see why we could not tell.
  if (mode === 'asking') {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t('migrationAskTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {t('migrationAskBody', {
              version: probedServerVersion() ?? currentServerInfo().serverVersion ?? '',
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="migration-gate-ask-confirm"
            onPress={() => { onConfirm?.(); }}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.primaryButtonLabel}>{t('migrationAskConfirm')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="migration-gate-ask-legacy"
            onPress={() => { onLegacy?.(); }}
            style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.secondaryButtonLabel, { color: colors.textSecondary }]}>
              {t('migrationAskLegacy')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('migrationGateTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('migrationGateBody')}
        </Text>

        <View style={styles.stages}>
          {STAGE_LABELS.map((stage, index) => {
            const state = stages[stage.id];
            const isActive = stage.id === activeStage;
            const isDone = activeIndex >= 0 && index < activeIndex;
            const showCount = isActive && state?.total !== undefined && state.total > 0;
            return (
              <View key={stage.id} style={styles.stageRow}>
                <View style={styles.stageIcon}>
                  {isActive && !failed ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text
                      style={[
                        styles.stageBullet,
                        { color: isDone ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      {isDone ? '✓' : '·'}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stageLabel,
                    { color: isActive || isDone ? colors.textPrimary : colors.textSecondary },
                  ]}
                >
                  {t(stage.key)}
                  {showCount ? `  ${state?.done ?? 0} / ${state?.total ?? 0}` : ''}
                </Text>
              </View>
            );
          })}
        </View>

        {failed && (
          <>
            <Text style={[styles.error, { color: colors.red }]}>
              {t('migrationGateFailed')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => { onRetry?.(); }}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.primaryButtonLabel}>{t('migrationGateRetry')}</Text>
            </Pressable>
            {/* Only offered when the run failed BEFORE writing anything — an unsupported
                pragma, or no database. Those fail identically on every relaunch, so without
                an escape the app is unreachable forever with the downloads intact on disk.
                After a write there is no safe way out: the database is re-keyed, the files
                are not yet moved, and launching lets the reconcile delete them all. Retry
                is the only option there. */}
            {!hasWritten && (
              <Pressable
                accessibilityRole="button"
                testID="migration-gate-continue"
                onPress={() => { onContinue?.(); }}
                style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.secondaryButtonLabel, { color: colors.textSecondary }]}>
                  {t('migrationGateContinueAnyway')}
                </Text>
              </Pressable>
            )}
            {hasWritten && (
              <Text style={[styles.footnote, { color: colors.textSecondary }]}>
                {t('migrationGateMustFinish')}
              </Text>
            )}
          </>
        )}

        <Text style={[styles.footnote, { color: colors.textSecondary }]}>
          {t('migrationGateFootnote')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { fontSize: 64, lineHeight: 72, textAlign: 'center', marginBottom: 8 },
  note: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 14, marginTop: 20 },
  noteText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  completeButtonWrap: { alignSelf: 'stretch' },
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 100,
  },
  content: { gap: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  stages: { gap: 12, marginTop: 4 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stageIcon: { width: 20, alignItems: 'center' },
  stageBullet: { fontSize: 15, fontWeight: '600' },
  stageLabel: { fontSize: 15, flexShrink: 1 },
  error: { fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonLabel: { fontSize: 15 },
});

export const MigrationGate = memo(MigrationGateInner);
