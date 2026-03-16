import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { CertificatePromptModal } from '../components/CertificatePromptModal';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import { autoOfflineStore, type AutoOfflineMode } from '../store/autoOfflineStore';
import { authStore } from '../store/authStore';
import { offlineModeStore } from '../store/offlineModeStore';
import {
  checkLocationPermission,
  getCurrentSSIDWithRetry,
  openAppSettings,
  requestLocationPermission,
} from '../services/autoOfflineService';
import {
  checkBatteryOptimization,
  requestBatteryOptimizationExemption,
} from '../services/batteryOptimizationService';
import { batteryOptimizationStore } from '../store/batteryOptimizationStore';
import { removeTrustForHost, trustCertificateForHost } from '../services/sslTrustService';
import { sslCertStore, type TrustedCertEntry } from '../store/sslCertStore';
import { getCertificateInfo, type CertificateInfo } from '../../modules/expo-ssl-trust/src';

export function SettingsConnectivityScreen() {
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const navigation = useNavigation();

  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const toggleOfflineMode = offlineModeStore((s) => s.toggleOfflineMode);
  const showInFilterBar = offlineModeStore((s) => s.showInFilterBar);
  const setShowInFilterBar = offlineModeStore((s) => s.setShowInFilterBar);

  // --- Auto Offline ---
  const autoEnabled = autoOfflineStore((s) => s.enabled);
  const autoMode = autoOfflineStore((s) => s.mode);
  const homeSSIDs = autoOfflineStore((s) => s.homeSSIDs);
  const locationGranted = autoOfflineStore((s) => s.locationPermissionGranted);

  const serverUrl = authStore((s) => s.serverUrl);
  const activeHostname = useMemo(() => {
    if (!serverUrl) return null;
    try { return new URL(serverUrl).hostname; } catch { return null; }
  }, [serverUrl]);

  const [currentSSID, setCurrentSSID] = useState<string | null>(null);
  const [ssidPromptVisible, setSsidPromptVisible] = useState(false);
  const [ssidPromptValue, setSsidPromptValue] = useState('');
  const [ssidEditTarget, setSsidEditTarget] = useState<string | null>(null);
  const [ssidSetupValue, setSsidSetupValue] = useState('');
  const [ssidReadFailed, setSsidReadFailed] = useState(false);

  // --- Add Certificate flow ---
  const [certUrlPromptVisible, setCertUrlPromptVisible] = useState(false);
  const [certUrlValue, setCertUrlValue] = useState('');
  const [certFetching, setCertFetching] = useState(false);
  const [certModalVisible, setCertModalVisible] = useState(false);
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [certHostname, setCertHostname] = useState('');

  // --- Battery Optimization (Android only) ---
  const batteryOptRestricted = batteryOptimizationStore((s) => s.restricted);

  useEffect(() => {
    if (Platform.OS === 'android') {
      checkBatteryOptimization();
    }
  }, []);

  const handleRequestBatteryExemption = useCallback(async () => {
    await requestBatteryOptimizationExemption();
  }, []);

  useEffect(() => {
    if (autoMode === 'home-wifi') {
      checkLocationPermission().then(async (granted) => {
        const ssid = await getCurrentSSIDWithRetry();
        setCurrentSSID(ssid);
        setSsidReadFailed(granted && ssid == null);
      });
    }
  }, [autoMode]);

  useEffect(() => {
    if (currentSSID && homeSSIDs.length === 0) {
      setSsidSetupValue(currentSSID);
    }
  }, [currentSSID, homeSSIDs.length]);

  // Prompt to disable auto-offline when navigating away with incomplete home-wifi setup
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      const { enabled, mode, homeSSIDs: ssids, locationPermissionGranted: permGranted } = autoOfflineStore.getState();
      if (!enabled || mode !== 'home-wifi') return;
      if (permGranted && ssids.length > 0) return;

      e.preventDefault();
      Alert.alert(
        'Incomplete Setup',
        'Home WiFi mode needs location permission and at least one network name to work. Disable auto-offline?',
        [
          {
            text: 'Keep Enabled',
            style: 'cancel',
            onPress: () => navigation.dispatch(e.data.action),
          },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: () => {
              autoOfflineStore.getState().setEnabled(false);
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation]);

  const handleAutoEnabledChange = useCallback((value: boolean) => {
    autoOfflineStore.getState().setEnabled(value);
  }, []);

  const handleModeSelect = useCallback((mode: AutoOfflineMode) => {
    autoOfflineStore.getState().setMode(mode);
    if (mode === 'home-wifi') {
      checkLocationPermission().then(async (granted) => {
        const ssid = await getCurrentSSIDWithRetry();
        setCurrentSSID(ssid);
        setSsidReadFailed(granted && ssid == null);
      });
    }
  }, []);

  const handleGrantPermission = useCallback(async () => {
    const granted = await requestLocationPermission();
    if (granted) {
      const ssid = await getCurrentSSIDWithRetry();
      setCurrentSSID(ssid);
      setSsidReadFailed(ssid == null);
    } else {
      openAppSettings();
    }
  }, []);

  const handleRetrySSID = useCallback(async () => {
    const ssid = await getCurrentSSIDWithRetry();
    setCurrentSSID(ssid);
    setSsidReadFailed(ssid == null);
  }, []);

  const handleAddCurrentSSID = useCallback(() => {
    if (currentSSID) {
      autoOfflineStore.getState().addSSID(currentSSID);
    }
  }, [currentSSID]);

  const handleSetupAdd = useCallback(() => {
    const trimmed = ssidSetupValue.trim();
    if (trimmed) {
      autoOfflineStore.getState().addSSID(trimmed);
      setSsidSetupValue('');
    }
  }, [ssidSetupValue]);

  const handleAddSSIDManual = useCallback(() => {
    const defaultValue = currentSSID && !homeSSIDs.includes(currentSSID) ? currentSSID : '';
    if (Platform.OS === 'ios') {
      Alert.prompt('Add Network', 'Enter the WiFi network name (case-sensitive).', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (value?: string) => {
            const trimmed = value?.trim();
            if (trimmed) autoOfflineStore.getState().addSSID(trimmed);
          },
        },
      ], 'plain-text', defaultValue);
    } else {
      setSsidEditTarget(null);
      setSsidPromptValue(defaultValue);
      setSsidPromptVisible(true);
    }
  }, [currentSSID, homeSSIDs]);

  const handleEditSSID = useCallback((ssid: string) => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Edit Network', 'Update the WiFi network name (case-sensitive).', [
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
    alert(
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
  }, [alert]);

  const showCurrentSSIDRow =
    autoMode === 'home-wifi' &&
    locationGranted &&
    currentSSID != null &&
    !homeSSIDs.includes(currentSSID);

  const trustedCerts = sslCertStore((s) => s.trustedCerts);
  const trustedCertEntries = useMemo(() => {
    const entries = Object.entries(trustedCerts) as [string, TrustedCertEntry][];
    return entries.sort((a, b) => {
      if (a[0] === activeHostname) return -1;
      if (b[0] === activeHostname) return 1;
      return b[1].acceptedAt - a[1].acceptedAt;
    });
  }, [trustedCerts, activeHostname]);

  const handleRemoveTrustedCert = useCallback((hostname: string) => {
    const isActive = hostname === activeHostname;
    alert(
      isActive ? 'Remove Active Certificate' : 'Remove Trusted Certificate',
      isActive
        ? `This certificate is used to connect to your current server. Removing it may prevent the app from communicating with ${hostname} until you re-accept the certificate.`
        : `Remove the trusted certificate for ${hostname}? You will need to re-accept the certificate on next connection.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeTrustForHost(hostname).catch(() => {
              /* best-effort removal */
            });
          },
        },
      ],
    );
  }, [alert, activeHostname]);

  const normalizeUrl = useCallback((input: string): { url: string; hostname: string } | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      // Always use https — fetching a TLS certificate requires a secure connection
      parsed.protocol = 'https:';
      return { url: parsed.toString(), hostname: parsed.hostname };
    } catch {
      return null;
    }
  }, []);

  const handleAddCertificate = useCallback(() => {
    setCertUrlValue('');
    setCertUrlPromptVisible(true);
  }, []);

  const handleFetchCertificate = useCallback(async () => {
    const result = normalizeUrl(certUrlValue);
    if (!result) {
      alert('Invalid URL', 'Please enter a valid server address.');
      return;
    }
    setCertUrlPromptVisible(false);
    setCertFetching(true);
    try {
      const info = await getCertificateInfo(result.url);
      setCertInfo(info);
      setCertHostname(result.hostname);
      setCertModalVisible(true);
    } catch (e) {
      alert('Certificate Error', e instanceof Error ? e.message : 'Failed to fetch certificate from server.');
    } finally {
      setCertFetching(false);
    }
  }, [certUrlValue, normalizeUrl, alert]);

  const handleTrustFetchedCert = useCallback(async () => {
    if (!certInfo || !certHostname) return;
    await trustCertificateForHost(certHostname, certInfo.sha256Fingerprint, certInfo.validTo);
    setCertModalVisible(false);
    setCertInfo(null);
  }, [certInfo, certHostname]);

  const handleCancelCert = useCallback(() => {
    setCertModalVisible(false);
    setCertInfo(null);
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
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Offline</Text>
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
          <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
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
                  autoMode !== 'home-wifi' || !locationGranted || ssidReadFailed ? styles.toggleRowLast : { borderBottomColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>Home WiFi</Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    Go offline when not connected to a specific home WiFi network. Network names are case-sensitive.
                  </Text>
                </View>
                {autoMode === 'home-wifi' && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                )}
              </Pressable>

              {autoMode === 'home-wifi' && !locationGranted && (
                <View style={styles.permissionWarning}>
                  <Ionicons name="warning-outline" size={20} color={colors.red} />
                  <View style={styles.permissionWarningText}>
                    <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                      {Platform.OS === 'ios'
                        ? 'To detect which WiFi network you\'re on, Substreamer needs location access. When prompted, choose "Allow While Using the App" so the app can check your network each time it opens. Choosing "Allow Once" means you\'d need to grant permission again every time.'
                        : 'To detect which WiFi network you\'re on, Substreamer needs location access. When prompted, choose "While using the app" so the app can check your network each time it opens. Choosing "Only this time" means you\'d need to grant permission again every time.'}
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

              {autoMode === 'home-wifi' && locationGranted && ssidReadFailed && (
                <View style={styles.permissionWarning}>
                  <Ionicons name="warning-outline" size={20} color={colors.red} />
                  <View style={styles.permissionWarningText}>
                    {homeSSIDs.length > 0 ? (
                      <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                        {Platform.OS === 'ios'
                          ? 'Unable to read your WiFi network name. Location permission may have been revoked or set to "Allow Once". In your device Settings, make sure location access for Substreamer is set to "Allow While Using the App".'
                          : 'Unable to read your WiFi network name. Location permission may have been revoked or set to "Only this time". In your device Settings, make sure location access for Substreamer is set to "While using the app".'}
                      </Text>
                    ) : (
                      <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                        Permission was granted but we still can't read your WiFi network name. This feature may not work correctly on your device. You can try again later, or switch to the{' '}
                        <Text style={{ fontWeight: '600' }}>WiFi Only</Text> option instead which doesn't need location access.
                      </Text>
                    )}
                    <Pressable
                      onPress={homeSSIDs.length > 0 ? handleGrantPermission : handleRetrySSID}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Text style={[styles.permissionButton, { color: colors.primary }]}>
                        {homeSSIDs.length > 0 ? 'Grant Permission' : 'Try Again'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {showCurrentSSIDRow && !ssidReadFailed && (
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

              {autoMode === 'home-wifi' && locationGranted && !ssidReadFailed && homeSSIDs.length > 0 && homeSSIDs.map((ssid, index) => (
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

              {autoMode === 'home-wifi' && locationGranted && !ssidReadFailed && (
                <Pressable
                  onPress={handleAddSSIDManual}
                  style={({ pressed }) => [styles.addSsidRow, pressed && styles.pressed]}
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={[styles.addSsidText, { color: colors.primary }]}>Add Network</Text>
                </Pressable>
              )}

              {autoMode === 'home-wifi' && homeSSIDs.length === 0 && locationGranted && currentSSID != null && (
                <View style={[styles.setupArea, { borderBottomColor: colors.border }]}>
                  <View style={styles.setupHeader}>
                    <Ionicons name="wifi" size={18} color={colors.primary} />
                    <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                      Current network detected
                    </Text>
                  </View>
                  <View style={styles.setupRow}>
                    <TextInput
                      style={[styles.setupInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
                      value={ssidSetupValue}
                      onChangeText={setSsidSetupValue}
                      placeholder="WiFi network name"
                      placeholderTextColor={colors.textSecondary}
                      onSubmitEditing={handleSetupAdd}
                      returnKeyType="done"
                    />
                    <Pressable
                      onPress={handleSetupAdd}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Text style={[styles.ssidActionText, { color: colors.primary }]}>Add</Text>
                    </Pressable>
                  </View>
                  <Text style={[styles.setupHint, { color: colors.textSecondary }]}>
                    Verify the name is correct, then tap Add.
                  </Text>
                </View>
              )}

            </>
          )}
        </View>
      </View>

      {Platform.OS === 'android' && batteryOptRestricted !== null && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Background playback</Text>
          <View style={[styles.card, dynamicStyles.card]}>
            <Pressable
              onPress={batteryOptRestricted ? handleRequestBatteryExemption : undefined}
              disabled={!batteryOptRestricted}
              style={({ pressed }) => [
                styles.toggleRow,
                styles.toggleRowLast,
                pressed && batteryOptRestricted && styles.pressed,
              ]}
            >
              <View style={styles.toggleTextWrap}>
                <Text style={[styles.label, { color: colors.textPrimary }]}>
                  Battery Optimization
                </Text>
                <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                  {batteryOptRestricted
                    ? 'Some Android devices may stop background music streaming to save battery. Tap to request an exemption.'
                    : 'Background playback should not be interrupted by battery optimization.'}
                </Text>
              </View>
              {batteryOptRestricted ? (
                <Ionicons name="warning-outline" size={22} color={colors.red} />
              ) : (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </Pressable>
          </View>
        </View>
      )}

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
              {ssidEditTarget ? 'Edit Network' : 'Add Network'}
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
            trustedCertEntries.map(([hostname, entry], index) => {
              const isActive = hostname === activeHostname;
              return (
                <View
                  key={hostname}
                  style={[
                    styles.trustedCertRow,
                    { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                >
                  <View style={styles.trustedCertInfo}>
                    <View style={styles.trustedCertHeader}>
                      <Ionicons
                        name={isActive ? 'shield-checkmark' : 'shield-checkmark-outline'}
                        size={16}
                        color={colors.primary}
                      />
                      <Text style={[styles.trustedCertHostname, { color: colors.textPrimary }]}>
                        {hostname}
                      </Text>
                      {isActive && (
                        <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
                      )}
                    </View>
                    <Text style={[styles.trustedCertFingerprint, { color: colors.textSecondary }]} numberOfLines={1}>
                      {entry.sha256.substring(0, 23)}...
                    </Text>
                    <Text style={[styles.trustedCertDate, { color: colors.textSecondary }]}>
                      Trusted {new Date(entry.acceptedAt).toLocaleDateString()}
                      {entry.validTo && entry.validTo !== 'Unknown'
                        ? `  ·  Expires ${new Date(entry.validTo).toLocaleDateString()}`
                        : ''}
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
              );
            })
          ) : (
            <Text style={[styles.placeholder, dynamicStyles.placeholder]}>
              No trusted certificates. Self-signed certificates accepted during login will appear here.
            </Text>
          )}
          {certFetching ? (
            <View style={styles.addCertRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.addCertText, { color: colors.primary }]}>Fetching Certificate...</Text>
            </View>
          ) : (
            <Pressable
              onPress={handleAddCertificate}
              style={({ pressed }) => [styles.addCertRow, pressed && styles.pressed]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={[styles.addCertText, { color: colors.primary }]}>Add Certificate</Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScrollView>

    {/* Certificate URL input modal */}
    <Modal
      visible={certUrlPromptVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setCertUrlPromptVisible(false)}
    >
      <Pressable style={styles.modalBackdrop} onPress={() => setCertUrlPromptVisible(false)}>
        <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
          <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
            Add Certificate
          </Text>
          <Text style={[styles.certUrlHint, { color: colors.textSecondary }]}>
            Enter the server address to fetch its SSL certificate.
          </Text>
          <TextInput
            style={[styles.modalInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
            value={certUrlValue}
            onChangeText={setCertUrlValue}
            placeholder="https://music.example.com"
            placeholderTextColor={colors.textSecondary}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={handleFetchCertificate}
          />
          <View style={styles.modalButtons}>
            <Pressable
              onPress={() => setCertUrlPromptVisible(false)}
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}
            >
              <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleFetchCertificate}
              style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}
            >
              <Text style={[styles.modalButtonText, { color: colors.primary }]}>Fetch</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    <CertificatePromptModal
      visible={certModalVisible}
      certInfo={certInfo}
      hostname={certHostname}
      isManualAdd
      onTrust={handleTrustFetchedCert}
      onCancel={handleCancelCert}
    />

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
  setupArea: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  setupInput: {
    flex: 1,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  setupHint: {
    fontSize: 12,
    marginTop: 6,
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
  addCertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  addCertText: {
    fontSize: 15,
    fontWeight: '500',
  },
  certUrlHint: {
    fontSize: 13,
    marginBottom: 12,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
