import Ionicons from '@react-native-vector-icons/ionicons/static';
import { usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useHomeWifiSetup } from '../../hooks/useHomeWifiSetup';
import { useTheme } from '../../hooks/useTheme';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { settingsStyles } from '../../styles/settingsStyles';
import { BottomSheet } from '../BottomSheet';
import {
  checkLocationPermission,
  openAppSettings,
  requestLocationPermission,
} from '../../services/autoOfflineService';
import { autoOfflineStore, type AutoOfflineMode } from '../../store/autoOfflineStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { SettingsRow } from './SettingsRow';
import { SettingsSectionTitle } from './SettingsSectionTitle';

export function OfflineCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, confirm } = useThemedAlert();
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const toggleOfflineMode = offlineModeStore((s) => s.toggleOfflineMode);
  const showInFilterBar = offlineModeStore((s) => s.showInFilterBar);
  const setShowInFilterBar = offlineModeStore((s) => s.setShowInFilterBar);

  const autoEnabled = autoOfflineStore((s) => s.enabled);
  const autoMode = autoOfflineStore((s) => s.mode);
  const homeSSIDs = autoOfflineStore((s) => s.homeSSIDs);
  const locationGranted = autoOfflineStore((s) => s.locationPermissionGranted);

  const { currentSSID, ssidReadFailed, notOnWifi, refreshSSID } = useHomeWifiSetup();
  const [ssidPromptVisible, setSsidPromptVisible] = useState(false);
  const [ssidPromptValue, setSsidPromptValue] = useState('');
  const [ssidEditTarget, setSsidEditTarget] = useState<string | null>(null);
  const [ssidSetupValue, setSsidSetupValue] = useState('');

  useEffect(() => {
    if (autoMode === 'home-wifi') {
      checkLocationPermission().then((granted) => refreshSSID(granted));
    }
  }, [autoMode, refreshSSID]);

  useEffect(() => {
    if (currentSSID && homeSSIDs.length === 0) {
      setSsidSetupValue(currentSSID);
    }
  }, [currentSSID, homeSSIDs.length]);

  // Prompt to disable auto-offline when navigating away with incomplete home-wifi setup
  const [leaving, setLeaving] = useState(false);
  const setupIncomplete =
    autoEnabled && autoMode === 'home-wifi' && !(locationGranted && homeSSIDs.length > 0);
  usePreventRemove(setupIncomplete && !leaving, ({ repeat }) => {
    Alert.alert(
      t('incompleteSetup'),
      t('incompleteSetupMessage'),
      [
        {
          text: t('keepEnabled'),
          style: 'cancel',
          onPress: () => {
            setLeaving(true);
            repeat();
          },
        },
        {
          text: t('disable'),
          style: 'destructive',
          onPress: () => {
            autoOfflineStore.getState().setEnabled(false);
            setLeaving(true);
            repeat();
          },
        },
      ],
    );
  });

  const handleAutoEnabledChange = useCallback((value: boolean) => {
    autoOfflineStore.getState().setEnabled(value);
  }, []);

  const handleModeSelect = useCallback((mode: AutoOfflineMode) => {
    autoOfflineStore.getState().setMode(mode);
    if (mode === 'home-wifi') {
      checkLocationPermission().then((granted) => refreshSSID(granted));
    }
  }, [refreshSSID]);

  const handleGrantPermission = useCallback(async () => {
    const granted = await requestLocationPermission();
    if (granted) {
      await refreshSSID(true);
    } else {
      openAppSettings();
    }
  }, [refreshSSID]);

  const handleRetrySSID = useCallback(async () => {
    await refreshSSID(true);
  }, [refreshSSID]);

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
    setSsidEditTarget(null);
    setSsidPromptValue(defaultValue);
    setSsidPromptVisible(true);
  }, [currentSSID, homeSSIDs]);

  const handleEditSSID = useCallback((ssid: string) => {
    setSsidEditTarget(ssid);
    setSsidPromptValue(ssid);
    setSsidPromptVisible(true);
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

  const handleSsidPromptClose = useCallback(() => {
    setSsidPromptVisible(false);
  }, []);

  const handleRemoveSSID = useCallback((ssid: string) => {
    confirm({
      title: t('removeNetwork'),
      message: t('removeNetworkMessage', { ssid }),
      confirmLabel: t('remove'),
      destructive: true,
      onConfirm: () => autoOfflineStore.getState().removeSSID(ssid),
    });
  }, [confirm, t]);

  const showCurrentSSIDRow =
    autoMode === 'home-wifi' &&
    locationGranted &&
    currentSSID != null &&
    !homeSSIDs.includes(currentSSID);

  return (
    <>
      <View style={settingsStyles.section}>
        <SettingsSectionTitle>{t('offline')}</SettingsSectionTitle>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, { backgroundColor: colors.card }]}>
          <SettingsRow
            label={t('offlineMode')}
            hint={t('offlineModeHint')}
            right={
              <Switch
                value={offlineMode}
                onValueChange={toggleOfflineMode}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            }
          />
          <SettingsRow
            label={t('showInFilterBar')}
            hint={t('showInFilterBarHint')}
            right={
              <Switch
                value={showInFilterBar}
                onValueChange={setShowInFilterBar}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            }
          />
          <SettingsRow
            label={t('autoOffline')}
            hint={t('autoOfflineHint')}
            isLast={!autoEnabled}
            right={
              <Switch
                value={autoEnabled}
                onValueChange={handleAutoEnabledChange}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            }
          />

          {autoEnabled && (
            <>
              <SettingsRow
                label={t('wifiOnly')}
                hint={t('wifiOnlyHint')}
                onPress={() => handleModeSelect('wifi-only')}
                right={
                  autoMode === 'wifi-only' && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )
                }
              />

              <SettingsRow
                label={t('homeWifi')}
                hint={t('homeWifiHint')}
                onPress={() => handleModeSelect('home-wifi')}
                isLast={autoMode !== 'home-wifi' || !locationGranted || ssidReadFailed}
                right={
                  autoMode === 'home-wifi' && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )
                }
              />

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

      {/* SSID add/edit prompt sheet (both platforms) */}
      <BottomSheet visible={ssidPromptVisible} onClose={handleSsidPromptClose}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {ssidEditTarget ? t('editNetwork') : t('addNetwork')}
          </Text>
        </View>
        <View style={styles.sheetForm}>
          <TextInput
            style={[styles.sheetInput, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
            value={ssidPromptValue}
            onChangeText={setSsidPromptValue}
            placeholder={t('wifiNetworkName')}
            placeholderTextColor={colors.textSecondary}
            autoFocus
            onSubmitEditing={handleSsidPromptSubmit}
            returnKeyType="done"
          />
          <Pressable
            onPress={handleSsidPromptSubmit}
            style={({ pressed }) => [
              styles.sheetSaveButton,
              { backgroundColor: colors.primary },
              pressed && styles.sheetButtonPressed,
            ]}
          >
            <Text style={styles.sheetSaveButtonText}>
              {ssidEditTarget ? t('save') : t('add')}
            </Text>
          </Pressable>
          <Pressable onPress={handleSsidPromptClose} style={styles.sheetCancelButton}>
            <Text style={[styles.sheetCancelButtonText, { color: colors.primary }]}>{t('cancel')}</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  toggleHint: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  permissionWarningText: { flex: 1 },
  permissionButton: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  ssidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ssidText: { flex: 1, fontSize: 16 },
  ssidActionText: { fontSize: 16, fontWeight: '600' },
  ssidActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  setupArea: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setupInput: { flex: 1, fontSize: 16, borderWidth: 1, borderRadius: 8, padding: 10 },
  setupHint: { fontSize: 12, marginTop: 6 },
  addSsidRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addSsidText: { fontSize: 16, fontWeight: '500' },
  sheetHeader: { paddingHorizontal: 4, marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetForm: { paddingHorizontal: 4 },
  sheetInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  sheetSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  sheetSaveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sheetButtonPressed: { opacity: 0.8 },
  sheetCancelButton: { alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  sheetCancelButtonText: { fontSize: 16, fontWeight: '500' },
});
