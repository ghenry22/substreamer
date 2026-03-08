import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { autoOfflineStore, type AutoOfflineMode } from '../store/autoOfflineStore';
import { offlineModeStore } from '../store/offlineModeStore';
import {
  checkLocationPermission,
  getCurrentSSID,
  openAppSettings,
  requestLocationPermission,
} from '../services/autoOfflineService';
import { removeTrustForHost } from '../services/sslTrustService';
import { sslCertStore, type TrustedCertEntry } from '../store/sslCertStore';

export function SettingsConnectivityScreen() {
  const { colors } = useTheme();

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const toggleOfflineMode = offlineModeStore((s) => s.toggleOfflineMode);
  const showInFilterBar = offlineModeStore((s) => s.showInFilterBar);
  const setShowInFilterBar = offlineModeStore((s) => s.setShowInFilterBar);

  // --- Auto Offline ---
  const autoEnabled = autoOfflineStore((s) => s.enabled);
  const autoMode = autoOfflineStore((s) => s.mode);
  const homeSSIDs = autoOfflineStore((s) => s.homeSSIDs);
  const locationGranted = autoOfflineStore((s) => s.locationPermissionGranted);

  const [currentSSID, setCurrentSSID] = useState<string | null>(null);
  const [ssidPromptVisible, setSsidPromptVisible] = useState(false);
  const [ssidPromptValue, setSsidPromptValue] = useState('');
  const [ssidEditTarget, setSsidEditTarget] = useState<string | null>(null);

  useEffect(() => {
    if (autoMode === 'home-wifi') {
      checkLocationPermission();
      getCurrentSSID().then(setCurrentSSID);
    }
  }, [autoMode]);

  const handleAutoEnabledChange = useCallback((value: boolean) => {
    autoOfflineStore.getState().setEnabled(value);
  }, []);

  const handleModeSelect = useCallback((mode: AutoOfflineMode) => {
    autoOfflineStore.getState().setMode(mode);
    if (mode === 'home-wifi') {
      checkLocationPermission();
      getCurrentSSID().then(setCurrentSSID);
    }
  }, []);

  const handleGrantPermission = useCallback(async () => {
    const granted = await requestLocationPermission();
    if (granted) {
      getCurrentSSID().then(setCurrentSSID);
    } else {
      openAppSettings();
    }
  }, []);

  const handleAddCurrentSSID = useCallback(() => {
    if (currentSSID) {
      autoOfflineStore.getState().addSSID(currentSSID);
    }
  }, [currentSSID]);

  const handleAddSSIDManual = useCallback(() => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Add SSID', 'Enter the WiFi network name (case-sensitive).', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (value?: string) => {
            const trimmed = value?.trim();
            if (trimmed) autoOfflineStore.getState().addSSID(trimmed);
          },
        },
      ]);
    } else {
      setSsidEditTarget(null);
      setSsidPromptValue('');
      setSsidPromptVisible(true);
    }
  }, []);

  const handleEditSSID = useCallback((ssid: string) => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Edit SSID', 'Update the WiFi network name (case-sensitive).', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const trimmed = value?.trim();
            if (trimmed) autoOfflineStore.getState().updateSSID(ssid, trimmed);
          },
        },
      ], 'plain-text', ssid);
    } else {
      setSsidEditTarget(ssid);
      setSsidPromptValue(ssid);
      setSsidPromptVisible(true);
    }
  }, []);

  const handleSsidPromptSubmit = useCallback(() => {
    const trimmed = ssidPromptValue.trim();
    if (!trimmed) {
      setSsidPromptVisible(false);
      return;
    }
    if (ssidEditTarget) {
      autoOfflineStore.getState().updateSSID(ssidEditTarget, trimmed);
    } else {
      autoOfflineStore.getState().addSSID(trimmed);
    }
    setSsidPromptVisible(false);
  }, [ssidPromptValue, ssidEditTarget]);

  const handleRemoveSSID = useCallback((ssid: string) => {
    Alert.alert(
      'Remove Network',
      `Remove "${ssid}" from your home networks?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => autoOfflineStore.getState().removeSSID(ssid),
        },
      ],
    );
  }, []);

  const showCurrentSSIDRow =
    autoMode === 'home-wifi' &&
    locationGranted &&
    currentSSID != null &&
    !homeSSIDs.includes(currentSSID);

  const trustedCerts = sslCertStore((s) => s.trustedCerts);
  const trustedCertEntries = Object.entries(trustedCerts) as [string, TrustedCertEntry][];

  const handleRemoveTrustedCert = useCallback((hostname: string) => {
    Alert.alert(
      'Remove Trusted Certificate',
      `Remove the trusted certificate for ${hostname}? You will need to re-accept the certificate on next connection.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeTrustForHost(hostname).catch(() => {
              // Best-effort removal
            });
          },
        },
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
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Offline mode</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                Offline Mode
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                When enabled, only downloaded content is available. Searches are performed locally against cached content.
              </Text>
            </View>
            <Switch
              value={offlineMode}
              onValueChange={toggleOfflineMode}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={[styles.toggleRow, styles.toggleRowLast]}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                Show in Filter Bar
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                Display the offline mode toggle in the filter bar for quick access.
              </Text>
            </View>
            <Switch
              value={showInFilterBar}
              onValueChange={setShowInFilterBar}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Auto offline</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          <View style={[styles.toggleRow, autoEnabled ? { borderBottomColor: colors.border } : styles.toggleRowLast]}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                Auto Offline
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                Automatically switch between online and offline mode based on your network connection.
              </Text>
            </View>
            <Switch
              value={autoEnabled}
              onValueChange={handleAutoEnabledChange}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {autoEnabled && (
            <>
              <Pressable
                onPress={() => handleModeSelect('wifi-only')}
                style={({ pressed }) => [
                  styles.toggleRow,
                  { borderBottomColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>WiFi Only</Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    Go offline when not connected to WiFi.
                  </Text>
                </View>
                {autoMode === 'wifi-only' && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                onPress={() => handleModeSelect('home-wifi')}
                style={({ pressed }) => [
                  styles.toggleRow,
                  autoMode !== 'home-wifi' ? styles.toggleRowLast : { borderBottomColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>Home WiFi</Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    Go offline when not connected to a specific home WiFi network. SSIDs are case-sensitive.
                  </Text>
                </View>
                {autoMode === 'home-wifi' && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                )}
              </Pressable>

              {autoMode === 'home-wifi' && !locationGranted && (
                <View style={[styles.permissionWarning, { borderBottomColor: colors.border }]}>
                  <Ionicons name="warning-outline" size={20} color={colors.red} />
                  <View style={styles.permissionWarningText}>
                    <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                      Location permission is required to read WiFi network names.{' '}
                      {Platform.OS === 'ios'
                        ? 'Grant location access in Settings.'
                        : 'Grant location access to enable this feature.'}
                    </Text>
                    <Pressable
                      onPress={handleGrantPermission}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Text style={[styles.permissionButton, { color: colors.primary }]}>
                        Grant Permission
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {showCurrentSSIDRow && (
                <View style={[styles.ssidRow, { borderBottomColor: colors.border }]}>
                  <Ionicons name="wifi" size={18} color={colors.primary} />
                  <Text style={[styles.ssidText, { color: colors.textPrimary }]} numberOfLines={1}>
                    {currentSSID}
                  </Text>
                  <Pressable
                    onPress={handleAddCurrentSSID}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && styles.pressed]}
                  >
                    <Text style={[styles.ssidActionText, { color: colors.primary }]}>Add</Text>
                  </Pressable>
                </View>
              )}

              {autoMode === 'home-wifi' && homeSSIDs.length > 0 && homeSSIDs.map((ssid, index) => (
                <View
                  key={ssid}
                  style={[
                    styles.ssidRow,
                    index < homeSSIDs.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="wifi" size={18} color={colors.textSecondary} />
                  <Text style={[styles.ssidText, { color: colors.textPrimary }]} numberOfLines={1}>
                    {ssid}
                  </Text>
                  <View style={styles.ssidActions}>
                    <Pressable
                      onPress={() => handleEditSSID(ssid)}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Ionicons name="pencil" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveSSID(ssid)}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Ionicons name="close-circle-outline" size={20} color={colors.red} />
                    </Pressable>
                  </View>
                </View>
              ))}

              {autoMode === 'home-wifi' && (
                <Pressable
                  onPress={handleAddSSIDManual}
                  style={({ pressed }) => [styles.addSsidRow, pressed && styles.pressed]}
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={[styles.addSsidText, { color: colors.primary }]}>Add SSID</Text>
                </Pressable>
              )}

              {autoMode === 'home-wifi' && homeSSIDs.length === 0 && (
                <View style={styles.permissionWarning}>
                  <Ionicons name="warning-outline" size={20} color={colors.red} />
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    No home networks configured. Auto offline is paused until at least one WiFi network name is added.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      {/* Android SSID prompt modal */}
      <Modal
        visible={ssidPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSsidPromptVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSsidPromptVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
              {ssidEditTarget ? 'Edit SSID' : 'Add SSID'}
            </Text>
            <TextInput
              style={[styles.modalInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
              value={ssidPromptValue}
              onChangeText={setSsidPromptValue}
              placeholder="WiFi network name"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              onSubmitEditing={handleSsidPromptSubmit}
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setSsidPromptVisible(false)}
                style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSsidPromptSubmit}
                style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}
              >
                <Text style={[styles.modalButtonText, { color: colors.primary }]}>
                  {ssidEditTarget ? 'Save' : 'Add'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Trusted certificates</Text>
        <View style={[styles.card, dynamicStyles.card]}>
          {trustedCertEntries.length > 0 ? (
            trustedCertEntries.map(([hostname, entry], index) => (
              <View
                key={hostname}
                style={[
                  styles.trustedCertRow,
                  index < trustedCertEntries.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={styles.trustedCertInfo}>
                  <View style={styles.trustedCertHeader}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
                    <Text style={[styles.trustedCertHostname, { color: colors.textPrimary }]}>
                      {hostname}
                    </Text>
                  </View>
                  <Text style={[styles.trustedCertFingerprint, { color: colors.textSecondary }]} numberOfLines={1}>
                    {entry.sha256.substring(0, 23)}...
                  </Text>
                  <Text style={[styles.trustedCertDate, { color: colors.textSecondary }]}>
                    Trusted {new Date(entry.acceptedAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRemoveTrustedCert(hostname)}
                  hitSlop={8}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Ionicons name="close-circle-outline" size={22} color={colors.red} />
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={[styles.placeholder, dynamicStyles.placeholder]}>
              No trusted certificates. Self-signed certificates accepted during login will appear here.
            </Text>
          )}
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
  card: {
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleRowLast: {
    borderBottomWidth: 0,
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  placeholder: {
    fontSize: 15,
    fontStyle: 'italic',
    padding: 16,
  },
  trustedCertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  trustedCertInfo: {
    flex: 1,
  },
  trustedCertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  trustedCertHostname: {
    fontSize: 15,
    fontWeight: '600',
  },
  trustedCertFingerprint: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  trustedCertDate: {
    fontSize: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  permissionWarningText: {
    flex: 1,
  },
  permissionButton: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  ssidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ssidText: {
    flex: 1,
    fontSize: 15,
  },
  ssidActionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  ssidActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addSsidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  addSsidText: {
    fontSize: 15,
    fontWeight: '500',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalCard: {
    width: '80%',
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  modalInput: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  modalButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
