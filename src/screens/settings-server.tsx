import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { InfoRow } from '../components/InfoRow';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import {
  fetchScanStatus,
  startScan as startLibraryScan,
} from '../services/scanService';
import { scanStatusStore } from '../store/scanStatusStore';
import { serverInfoStore } from '../store/serverInfoStore';

export function SettingsServerScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();

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

  const scanScanning = scanStatusStore((s) => s.scanning);
  const scanCount = scanStatusStore((s) => s.count);
  const scanLastScan = scanStatusStore((s) => s.lastScan);
  const scanFolderCount = scanStatusStore((s) => s.folderCount);
  const scanLoading = scanStatusStore((s) => s.loading);

  const isNavidrome = serverInfo.serverType?.toLowerCase() === 'navidrome';

  const hasAnyInfo =
    serverInfo.serverType != null ||
    serverInfo.serverVersion != null ||
    serverInfo.apiVersion != null ||
    serverInfo.extensions.length > 0;

  useEffect(() => {
    fetchScanStatus();
  }, []);

  const handleStartScan = useCallback(() => {
    startLibraryScan();
  }, []);

  const handleFullScan = useCallback(() => {
    alert(
      'Full Scan',
      'Full scans re-read all files and may take a long time. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => startLibraryScan(true) },
      ],
    );
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        placeholder: { color: colors.textSecondary },
      }),
    [colors]
  );

  return (
    <>
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
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <InfoRow
              label="Server version"
              value={serverInfo.serverVersion}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <InfoRow
              label="API version"
              value={serverInfo.apiVersion}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>OpenSubsonic</Text>
              <Text style={[styles.infoValue, { color: colors.textSecondary }]}>
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
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Library scan</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <InfoRow
            label="Status"
            value={
              scanScanning
                ? scanCount > 0
                  ? `Scanning\u2026 (${scanCount.toLocaleString()} items)`
                  : 'Scanning\u2026'
                : 'Idle'
            }
            labelColor={colors.textPrimary}
            valueColor={scanScanning ? colors.primary : colors.textSecondary}
            borderColor={colors.border}
          />
          {scanCount > 0 && (
            <InfoRow
              label="Track count"
              value={scanCount.toLocaleString()}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
          )}
          {scanLastScan != null && (
            <InfoRow
              label="Last scan"
              value={new Date(scanLastScan).toLocaleString()}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
          )}
          {scanFolderCount != null && (
            <InfoRow
              label="Media folders"
              value={String(scanFolderCount)}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
          )}
          <View style={styles.scanButtons}>
            <Pressable
              onPress={handleStartScan}
              disabled={scanScanning || scanLoading}
              style={({ pressed }) => [
                styles.scanButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
                (scanScanning || scanLoading) && styles.scanButtonDisabled,
              ]}
            >
              {scanLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="refresh-outline" size={18} color="#fff" />
              )}
              <Text style={styles.scanButtonText}>
                Quick Scan
              </Text>
            </Pressable>
            {isNavidrome && (
              <Pressable
                onPress={handleFullScan}
                disabled={scanScanning || scanLoading}
                style={({ pressed }) => [
                  styles.scanButton,
                  { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                  (scanScanning || scanLoading) && styles.scanButtonDisabled,
                ]}
              >
                {scanLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search-outline" size={18} color="#fff" />
                )}
                <Text style={styles.scanButtonText}>
                  Full Scan
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </ScrollView>
    <ThemedAlert {...alertProps} />
    </>
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
  scanButtons: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  scanButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 8,
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});
