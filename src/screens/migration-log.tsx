import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useTheme } from '../hooks/useTheme';
import { settingsStyles } from '../styles/settingsStyles';
import { audioDiagnosticsStore } from '../store/audioDiagnosticsStore';
import { remoteControlDiagnosticsStore } from '../store/remoteControlDiagnosticsStore';
import { formatBytes } from '../utils/formatters';

const LOG_FILE = new File(Paths.document, 'migration-log.txt');
const DIAG_LOG_FILE = new File(Paths.document, 'audio-diagnostics.log');
const REMOTE_LOG_FILE = new File(Paths.document, 'remote-control-diagnostics.log');

export function MigrationLogScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const diagEnabled = audioDiagnosticsStore((s) => s.enabled);
  const diagLogSize = audioDiagnosticsStore((s) => s.logFileSize);
  const remoteEnabled = remoteControlDiagnosticsStore((s) => s.enabled);
  const remoteLogSize = remoteControlDiagnosticsStore((s) => s.logFileSize);

  useEffect(() => {
    audioDiagnosticsStore.getState().refreshStatus();
    remoteControlDiagnosticsStore.getState().refreshStatus();
    if (LOG_FILE.exists) {
      LOG_FILE.text().then((text) => {
        setContent(text);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const handleDiagToggle = useCallback(async (value: boolean) => {
    await audioDiagnosticsStore.getState().setEnabled(value);
  }, []);

  const handleDiagReset = useCallback(async () => {
    await audioDiagnosticsStore.getState().resetLog();
  }, []);

  const handleShareAudioLog = useCallback(async () => {
    if (DIAG_LOG_FILE.exists) {
      await shareAsync(DIAG_LOG_FILE.uri, { mimeType: 'text/plain' });
    }
  }, []);

  const handleRemoteToggle = useCallback(async (value: boolean) => {
    await remoteControlDiagnosticsStore.getState().setEnabled(value);
  }, []);

  const handleRemoteReset = useCallback(async () => {
    await remoteControlDiagnosticsStore.getState().resetLog();
  }, []);

  const handleShareRemoteLog = useCallback(async () => {
    if (REMOTE_LOG_FILE.exists) {
      await shareAsync(REMOTE_LOG_FILE.uri, { mimeType: 'text/plain' });
    }
  }, []);

  const handleShareMigrationLog = useCallback(async () => {
    if (LOG_FILE.exists) {
      await shareAsync(LOG_FILE.uri, { mimeType: 'text/plain' });
    }
  }, []);

  const handleClearMigrationLog = useCallback(() => {
    if (LOG_FILE.exists) {
      LOG_FILE.delete();
      setContent(null);
    }
  }, []);

  if (loading) {
    return (
      <GradientBackground style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    );
  }

  return (
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
    >
      {/* Audio Diagnostics */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, { color: colors.label }]}>{t('audioDiagnostics')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
          <View style={[styles.diagRow, { borderBottomColor: colors.border }]}>
            <View style={styles.diagTextWrap}>
              <Text style={[styles.diagLabel, { color: colors.textPrimary }]}>{t('diagnosticLogging')}</Text>
              <Text style={[styles.diagHint, { color: colors.textSecondary }]}>
                {t('diagnosticLoggingHint')}
              </Text>
            </View>
            <Switch
              value={diagEnabled}
              onValueChange={handleDiagToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={[styles.diagRow, styles.diagRowLast]}>
            <Text style={[styles.diagLabel, { color: colors.textPrimary }]}>{t('logFile')}</Text>
            <Text style={[styles.diagValue, { color: colors.textSecondary }]}>
              {diagLogSize != null ? formatBytes(diagLogSize) : t('none')}
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleShareAudioLog}
              disabled={diagLogSize == null}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && diagLogSize != null && settingsStyles.pressed,
                diagLogSize == null && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="share-outline" size={18} color={diagLogSize != null ? colors.primary : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: diagLogSize != null ? colors.primary : colors.textSecondary }]}>
                {t('share')}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleDiagReset}
              disabled={diagLogSize == null}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && diagLogSize != null && settingsStyles.pressed,
                diagLogSize == null && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="trash-outline" size={18} color={diagLogSize != null ? colors.red : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: diagLogSize != null ? colors.red : colors.textSecondary }]}>
                {t('clear')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Remote Control Diagnostics */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, { color: colors.label }]}>{t('remoteControlDiagnostics')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
          <View style={[styles.diagRow, { borderBottomColor: colors.border }]}>
            <View style={styles.diagTextWrap}>
              <Text style={[styles.diagLabel, { color: colors.textPrimary }]}>{t('remoteControlLogging')}</Text>
              <Text style={[styles.diagHint, { color: colors.textSecondary }]}>
                {t('remoteControlLoggingHint')}
              </Text>
            </View>
            <Switch
              value={remoteEnabled}
              onValueChange={handleRemoteToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={[styles.diagRow, styles.diagRowLast]}>
            <Text style={[styles.diagLabel, { color: colors.textPrimary }]}>{t('logFile')}</Text>
            <Text style={[styles.diagValue, { color: colors.textSecondary }]}>
              {remoteLogSize != null ? formatBytes(remoteLogSize) : t('none')}
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleShareRemoteLog}
              disabled={remoteLogSize == null}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && remoteLogSize != null && settingsStyles.pressed,
                remoteLogSize == null && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="share-outline" size={18} color={remoteLogSize != null ? colors.primary : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: remoteLogSize != null ? colors.primary : colors.textSecondary }]}>
                {t('share')}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleRemoteReset}
              disabled={remoteLogSize == null}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && remoteLogSize != null && settingsStyles.pressed,
                remoteLogSize == null && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="trash-outline" size={18} color={remoteLogSize != null ? colors.red : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: remoteLogSize != null ? colors.red : colors.textSecondary }]}>
                {t('clear')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Migration Log */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, { color: colors.label }]}>{t('migrationLog')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
          {content ? (
            <Text
              style={[styles.logText, { color: colors.textPrimary }]}
              selectable
            >
              {content}
            </Text>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t('migrationLogGeneratedOnLaunch')}
            </Text>
          )}
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleShareMigrationLog}
              disabled={!content}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && !!content && settingsStyles.pressed,
                !content && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="share-outline" size={18} color={content ? colors.primary : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: content ? colors.primary : colors.textSecondary }]}>
                {t('share')}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleClearMigrationLog}
              disabled={!content}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: colors.border },
                pressed && !!content && settingsStyles.pressed,
                !content && settingsStyles.disabled,
              ]}
            >
              <Ionicons name="trash-outline" size={18} color={content ? colors.red : colors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: content ? colors.red : colors.textSecondary }]}>
                {t('clear')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logText: {
    fontSize: 12,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyText: {
    fontSize: 16,
    fontStyle: 'italic',
    marginLeft: 4,
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  diagRowLast: {
    borderBottomWidth: 0,
  },
  diagTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  diagLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  diagHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  diagValue: {
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
