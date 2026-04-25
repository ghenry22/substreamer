import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useNavigation } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CertificatePromptModal } from '../components/CertificatePromptModal';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import NetInfo from '@react-native-community/netinfo';
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
import { settingsStyles } from '../styles/settingsStyles';
import { getCertificateInfo, type CertificateInfo } from '../../modules/expo-ssl-trust/src';

export function SettingsConnectivityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const navigation = useNavigation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

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
  const [notOnWifi, setNotOnWifi] = useState(false);

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
        const state = await NetInfo.refresh();
        if (state.type !== 'wifi') {
          setCurrentSSID(null);
          setSsidReadFailed(false);
          setNotOnWifi(true);
          return;
        }
        setNotOnWifi(false);
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
        t('incompleteSetup'),
        t('incompleteSetupMessage'),
        [
          {
            text: t('keepEnabled'),
            style: 'cancel',
            onPress: () => navigation.dispatch(e.data.action),
          },
          {
            text: t('disable'),
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
        const state = await NetInfo.refresh();
        if (state.type !== 'wifi') {
          setCurrentSSID(null);
          setSsidReadFailed(false);
          setNotOnWifi(true);
          return;
        }
        setNotOnWifi(false);
        const ssid = await getCurrentSSIDWithRetry();
        setCurrentSSID(ssid);
        setSsidReadFailed(granted && ssid == null);
      });
    }
  }, []);

  const handleGrantPermission = useCallback(async () => {
    const granted = await requestLocationPermission();
    if (granted) {
      const state = await NetInfo.refresh();
      if (state.type !== 'wifi') {
        setCurrentSSID(null);
        setSsidReadFailed(false);
        setNotOnWifi(true);
        return;
      }
      setNotOnWifi(false);
      const ssid = await getCurrentSSIDWithRetry();
      setCurrentSSID(ssid);
      setSsidReadFailed(ssid == null);
    } else {
      openAppSettings();
    }
  }, []);

  const handleRetrySSID = useCallback(async () => {
    const state = await NetInfo.refresh();
    if (state.type !== 'wifi') {
      setCurrentSSID(null);
      setSsidReadFailed(false);
      setNotOnWifi(true);
      return;
    }
    setNotOnWifi(false);
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
      Alert.prompt(t('addNetwork'), t('enterWifiName'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('add'),
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
      Alert.prompt(t('editNetwork'), t('updateWifiName'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('save'),
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
      t('removeNetwork'),
      t('removeNetworkMessage', { ssid }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
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
      isActive ? t('removeActiveCertificate') : t('removeTrustedCertificate'),
      isActive
        ? t('removeActiveCertificateMessage', { hostname })
        : t('removeTrustedCertificateMessage', { hostname }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
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
      alert(t('invalidUrl'), t('invalidUrlMessage'));
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
      alert(t('certificateError'), e instanceof Error ? e.message : t('failedToFetchCertificate'));
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
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        placeholder: { color: colors.textSecondary },
      }),
    [colors]
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('offline')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                {t('offlineMode')}
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                {t('offlineModeHint')}
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
                {t('showInFilterBar')}
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                {t('showInFilterBarHint')}
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
                {t('autoOffline')}
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                {t('autoOfflineHint')}
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
                  pressed && settingsStyles.pressed,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>{t('wifiOnly')}</Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    {t('wifiOnlyHint')}
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
                  pressed && settingsStyles.pressed,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>{t('homeWifi')}</Text>
                  <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                    {t('homeWifiHint')}
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
                        ? t('locationPermissionHintIos')
                        : t('locationPermissionHintAndroid')}
                    </Text>
                    <Pressable
                      onPress={handleGrantPermission}
                      style={({ pressed }) => [pressed && settingsStyles.pressed]}
                    >
                      <Text style={[styles.permissionButton, { color: colors.primary }]}>
                        {t('grantPermission')}
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
                          ? t('ssidReadFailedWithNetworksIos')
                          : t('ssidReadFailedWithNetworksAndroid')}
                      </Text>
                    ) : (
                      <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                        {t('ssidReadFailedNoNetworks')}
                      </Text>
                    )}
                    <Pressable
                      onPress={homeSSIDs.length > 0 ? handleGrantPermission : handleRetrySSID}
                      style={({ pressed }) => [pressed && settingsStyles.pressed]}
                    >
                      <Text style={[styles.permissionButton, { color: colors.primary }]}>
                        {homeSSIDs.length > 0 ? t('grantPermission') : t('tryAgain')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {autoMode === 'home-wifi' && locationGranted && !ssidReadFailed && notOnWifi && (
                <View style={styles.permissionWarning}>
                  <Ionicons name="wifi-outline" size={20} color={colors.textSecondary} />
                  <View style={styles.permissionWarningText}>
                    <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                      {homeSSIDs.length === 0 ? t('connectToWifiWithManualHint') : t('connectToWifi')}
                    </Text>
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
                    style={({ pressed }) => [pressed && settingsStyles.pressed]}
                  >
                    <Text style={[styles.ssidActionText, { color: colors.primary }]}>{t('add')}</Text>
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
                      style={({ pressed }) => [pressed && settingsStyles.pressed]}
                    >
                      <Ionicons name="pencil" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveSSID(ssid)}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && settingsStyles.pressed]}
                    >
                      <Ionicons name="close-circle-outline" size={20} color={colors.red} />
                    </Pressable>
                  </View>
                </View>
              ))}

              {autoMode === 'home-wifi' && locationGranted && !ssidReadFailed && (
                <Pressable
                  onPress={handleAddSSIDManual}
                  style={({ pressed }) => [styles.addSsidRow, pressed && settingsStyles.pressed]}
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={[styles.addSsidText, { color: colors.primary }]}>{t('addNetwork')}</Text>
                </Pressable>
              )}

              {autoMode === 'home-wifi' && homeSSIDs.length === 0 && locationGranted && currentSSID != null && (
                <View style={[styles.setupArea, { borderBottomColor: colors.border }]}>
                  <View style={styles.setupHeader}>
                    <Ionicons name="wifi" size={18} color={colors.primary} />
                    <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                      {t('currentNetworkDetected')}
                    </Text>
                  </View>
                  <View style={styles.setupRow}>
                    <TextInput
                      style={[styles.setupInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
                      value={ssidSetupValue}
                      onChangeText={setSsidSetupValue}
                      placeholder={t('wifiNetworkName')}
                      placeholderTextColor={colors.textSecondary}
                      onSubmitEditing={handleSetupAdd}
                      returnKeyType="done"
                    />
                    <Pressable
                      onPress={handleSetupAdd}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && settingsStyles.pressed]}
                    >
                      <Text style={[styles.ssidActionText, { color: colors.primary }]}>{t('add')}</Text>
                    </Pressable>
                  </View>
                  <Text style={[styles.setupHint, { color: colors.textSecondary }]}>
                    {t('verifyNameHint')}
                  </Text>
                </View>
              )}

            </>
          )}
        </View>
      </View>

      {Platform.OS === 'android' && batteryOptRestricted !== null && (
        <View style={settingsStyles.section}>
          <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('backgroundPlayback')}</Text>
          <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
            <Pressable
              onPress={batteryOptRestricted ? handleRequestBatteryExemption : undefined}
              disabled={!batteryOptRestricted}
              style={({ pressed }) => [
                styles.toggleRow,
                styles.toggleRowLast,
                pressed && batteryOptRestricted && settingsStyles.pressed,
              ]}
            >
              <View style={styles.toggleTextWrap}>
                <Text style={[styles.label, { color: colors.textPrimary }]}>
                  {t('batteryOptimization')}
                </Text>
                <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
                  {batteryOptRestricted
                    ? t('batteryOptimizationRestrictedHint')
                    : t('batteryOptimizationOkHint')}
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
              {ssidEditTarget ? t('editNetwork') : t('addNetwork')}
            </Text>
            <TextInput
              style={[styles.modalInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
              value={ssidPromptValue}
              onChangeText={setSsidPromptValue}
              placeholder={t('wifiNetworkName')}
              placeholderTextColor={colors.textSecondary}
              autoFocus
              onSubmitEditing={handleSsidPromptSubmit}
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setSsidPromptVisible(false)}
                style={({ pressed }) => [styles.modalButton, pressed && settingsStyles.pressed]}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={handleSsidPromptSubmit}
                style={({ pressed }) => [styles.modalButton, pressed && settingsStyles.pressed]}
              >
                <Text style={[styles.modalButtonText, { color: colors.primary }]}>
                  {ssidEditTarget ? t('save') : t('add')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('trustedCertificates')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          {trustedCertEntries.length > 0 ? (
            trustedCertEntries.map(([hostname, entry], index) => {
              const isActive = hostname === activeHostname;
              const isExpired = !!(entry.validTo && entry.validTo !== 'Unknown' && new Date(entry.validTo) < new Date());
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
                        name={isExpired ? 'shield-outline' : isActive ? 'shield-checkmark' : 'shield-checkmark-outline'}
                        size={16}
                        color={isExpired ? colors.red : colors.primary}
                      />
                      <Text style={[styles.trustedCertHostname, { color: colors.textPrimary }]}>
                        {hostname}
                      </Text>
                      {isActive && !isExpired && (
                        <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
                      )}
                      {isExpired && (
                        <Text style={[styles.expiredBadge, { color: colors.red }]}>{t('expired')}</Text>
                      )}
                    </View>
                    <Text style={[styles.trustedCertFingerprint, { color: colors.textSecondary }]} numberOfLines={1}>
                      {entry.sha256.substring(0, 23)}...
                    </Text>
                    <Text style={[styles.trustedCertDate, { color: isExpired ? colors.red : colors.textSecondary }]}>
                      {t('trustedDate', { date: new Date(entry.acceptedAt).toLocaleDateString() })}
                      {entry.validTo && entry.validTo !== 'Unknown'
                        ? `  ·  ${isExpired ? t('expiredDate', { date: new Date(entry.validTo).toLocaleDateString() }) : t('expiresDate', { date: new Date(entry.validTo).toLocaleDateString() })}`
                        : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveTrustedCert(hostname)}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && settingsStyles.pressed]}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={colors.red} />
                  </Pressable>
                </View>
              );
            })
          ) : (
            <Text style={[styles.placeholder, dynamicStyles.placeholder]}>
              {t('noTrustedCertificates')}
            </Text>
          )}
          {certFetching ? (
            <View style={styles.addCertRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.addCertText, { color: colors.primary }]}>{t('fetchingCertificate')}</Text>
            </View>
          ) : (
            <Pressable
              onPress={handleAddCertificate}
              style={({ pressed }) => [styles.addCertRow, pressed && settingsStyles.pressed]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={[styles.addCertText, { color: colors.primary }]}>{t('addCertificate')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>

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
            {t('addCertificate')}
          </Text>
          <Text style={[styles.certUrlHint, { color: colors.textSecondary }]}>
            {t('addCertificateHint')}
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
              style={({ pressed }) => [styles.modalButton, pressed && settingsStyles.pressed]}
            >
              <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={handleFetchCertificate}
              style={({ pressed }) => [styles.modalButton, pressed && settingsStyles.pressed]}
            >
              <Text style={[styles.modalButtonText, { color: colors.primary }]}>{t('fetch')}</Text>
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
    fontSize: 16,
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
    gap: 8,
    marginBottom: 4,
  },
  trustedCertHostname: {
    fontSize: 16,
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
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
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
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ssidText: {
    flex: 1,
    fontSize: 16,
  },
  ssidActionText: {
    fontSize: 16,
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
    gap: 8,
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
    fontSize: 16,
    fontWeight: '500',
  },
  addCertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  addCertText: {
    fontSize: 16,
    fontWeight: '500',
  },
  certUrlHint: {
    fontSize: 12,
    marginBottom: 12,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  expiredBadge: {
    fontSize: 12,
    fontWeight: '600',
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
    fontSize: 16,
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
    fontWeight: '600',
  },
});
