import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import i18next from 'i18next';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { GradientBackground } from '../components/GradientBackground';
import { InfoRow } from '../components/InfoRow';
import { BottomChrome } from '../components/BottomChrome';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import { clearImageCache } from '../services/imageCacheService';
import { clearMusicCache } from '../services/musicCacheService';
import { clearQueue } from '../services/playerService';
import {
  fetchScanStatus,
  startScan as startLibraryScan,
  stopPolling,
} from '../services/scanService';
import { changePassword, clearApiCache } from '../services/subsonicService';
import { canUserScan, isAdminRoleUnknown, supports } from '../services/serverCapabilityService';
import { authStore } from '../store/authStore';
import { settingsStyles } from '../styles/settingsStyles';
import { resetAllStores } from '../store/resetAllStores';
import { scanStatusStore } from '../store/scanStatusStore';
import { serverInfoStore } from '../store/serverInfoStore';

export function SettingsServerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const username = authStore((s) => s.username);
  const password = authStore((s) => s.password);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [changePwLoading, setChangePwLoading] = useState(false);

  const serverInfo = serverInfoStore(
    useShallow((s) => ({
      serverType: s.serverType,
      serverVersion: s.serverVersion,
      apiVersion: s.apiVersion,
      openSubsonic: s.openSubsonic,
      extensions: s.extensions,
      lastFetchedAt: s.lastFetchedAt,
      adminRole: s.adminRole,
      shareRole: s.shareRole,
    }))
  );

  const scanScanning = scanStatusStore((s) => s.scanning);
  const scanCount = scanStatusStore((s) => s.count);
  const scanLastScan = scanStatusStore((s) => s.lastScan);
  const scanFolderCount = scanStatusStore((s) => s.folderCount);
  const scanLoading = scanStatusStore((s) => s.loading);

  const canScan = canUserScan();
  const canFullScan = canUserScan() && supports('fullScan');
  const showScanHint = isAdminRoleUnknown();

  const handleLogout = useCallback(() => {
    clearQueue();
    stopPolling();
    clearApiCache();
    resetAllStores();
    clearImageCache();
    clearMusicCache();
    router.replace('/login');
  }, [router]);

  const maskedPassword = password ? '\u2022'.repeat(password.length) : '';

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
      t('fullScan'),
      t('fullScanConfirmMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('start'), onPress: () => startLibraryScan(true) },
      ],
    );
  }, [t]);

  const handleOpenChangePassword = useCallback(() => {
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setChangePwError(null);
    setChangePasswordVisible(true);
  }, []);

  const handleChangePassword = useCallback(async () => {
    if (!username) return;
    if (currentPw !== password) {
      setChangePwError(t('currentPasswordIncorrect'));
      return;
    }
    if (!newPw.trim()) {
      setChangePwError(t('newPasswordRequired'));
      return;
    }
    if (newPw === currentPw) {
      setChangePwError(t('newPasswordMustDiffer'));
      return;
    }
    if (newPw !== confirmPw) {
      setChangePwError(t('passwordsDoNotMatch'));
      return;
    }
    setChangePwLoading(true);
    setChangePwError(null);
    const success = await changePassword(username, newPw);
    setChangePwLoading(false);
    if (success) {
      authStore.getState().setSession(
        authStore.getState().serverUrl!,
        username,
        newPw,
        authStore.getState().apiVersion!,
        authStore.getState().legacyAuth,
      );
      clearApiCache();
      setChangePasswordVisible(false);
      alert(t('passwordChanged'), t('passwordChangedMessage'));
    } else {
      setChangePwError(t('failedToChangePassword'));
    }
  }, [username, password, currentPw, newPw, confirmPw, t]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        placeholder: { color: colors.textSecondary },
        logoutButton: { borderColor: colors.red },
        logoutButtonText: { color: colors.red },
      }),
    [colors]
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[styles.content, styles.contentGrow, { paddingTop: headerHeight + 16, paddingBottom: Math.max(insets.bottom, 32) }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('serverInformation')}</Text>
        {hasAnyInfo ? (
          <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
            <InfoRow
              label={t('serverType')}
              value={serverInfo.serverType ?? (serverInfo.apiVersion != null ? 'Subsonic' : null)}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <InfoRow
              label={t('serverVersion')}
              value={serverInfo.serverVersion}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <InfoRow
              label={t('apiVersion')}
              value={serverInfo.apiVersion}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
            <View style={[settingsStyles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[settingsStyles.infoLabel, { color: colors.textPrimary }]}>{t('openSubsonic')}</Text>
              <Text style={[settingsStyles.infoValue, { color: colors.textSecondary }]}>
                {serverInfo.openSubsonic ? t('yes') : t('no')}
              </Text>
            </View>
            {serverInfo.extensions.length > 0 && (
              <View style={[styles.extensionsBlock, { borderTopColor: colors.border }]}>
                <Text style={[styles.extensionsTitle, { color: colors.label }]}>
                  {t('supportedExtensions')}
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
            {t('noServerInfoAvailable')}
          </Text>
        )}
      </View>

      {canScan && (
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('libraryScan')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <InfoRow
            label={t('status')}
            value={
              scanScanning
                ? scanCount > 0
                  ? t('scanningWithCount', { count: scanCount.toLocaleString(i18next.language) })
                  : t('scanning')
                : t('idle')
            }
            labelColor={colors.textPrimary}
            valueColor={scanScanning ? colors.primary : colors.textSecondary}
            borderColor={colors.border}
          />
          {scanCount > 0 && (
            <InfoRow
              label={t('trackCount')}
              value={scanCount.toLocaleString(i18next.language)}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
          )}
          {scanLastScan != null && (
            <InfoRow
              label={t('lastScan')}
              value={new Date(scanLastScan).toLocaleString(i18next.language)}
              labelColor={colors.textPrimary}
              valueColor={colors.textSecondary}
              borderColor={colors.border}
            />
          )}
          {scanFolderCount != null && (
            <InfoRow
              label={t('mediaFolders')}
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
                pressed && settingsStyles.pressed,
                (scanScanning || scanLoading) && settingsStyles.disabled,
              ]}
            >
              {scanLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="refresh-outline" size={18} color="#fff" />
              )}
              <Text style={styles.scanButtonText}>
                {t('quickScan')}
              </Text>
            </Pressable>
            {canFullScan && (
              <Pressable
                onPress={handleFullScan}
                disabled={scanScanning || scanLoading}
                style={({ pressed }) => [
                  styles.scanButton,
                  { backgroundColor: colors.primary },
                  pressed && settingsStyles.pressed,
                  (scanScanning || scanLoading) && settingsStyles.disabled,
                ]}
              >
                {scanLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search-outline" size={18} color="#fff" />
                )}
                <Text style={styles.scanButtonText}>
                  {t('fullScan')}
                </Text>
              </Pressable>
            )}
          </View>
          {showScanHint && (
            <Text style={[styles.scanHint, { color: colors.textSecondary }]}>
              {t('scanRequiresAdminHint')}
            </Text>
          )}
        </View>
      </View>
      )}

      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>{t('account')}</Text>
        <View style={[settingsStyles.card, settingsStyles.cardPadded, dynamicStyles.card]}>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{t('username')}</Text>
            <Text style={[styles.fieldValue, { color: colors.textSecondary }]}>{username ?? '—'}</Text>
          </View>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{t('password')}</Text>
            <View style={styles.passwordValue}>
              <Text style={[styles.fieldValue, { color: colors.textSecondary }]}>
                {password ? (passwordVisible ? password : maskedPassword) : '—'}
              </Text>
              {password ? (
                <Pressable
                  onPress={() => setPasswordVisible((v) => !v)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && settingsStyles.pressed}
                >
                  <Ionicons
                    name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{t('adminRole')}</Text>
            <Text style={[styles.fieldValue, { color: colors.textSecondary }]}>
              {serverInfo.adminRole === true ? t('yes') : serverInfo.adminRole === false ? t('no') : t('unknown')}
            </Text>
          </View>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>{t('shareRole')}</Text>
            <Text style={[styles.fieldValue, { color: colors.textSecondary }]}>
              {serverInfo.shareRole === true ? t('yes') : serverInfo.shareRole === false ? t('no') : t('unknown')}
            </Text>
          </View>
          <Pressable
            onPress={handleOpenChangePassword}
            style={({ pressed }) => [
              styles.changePasswordButton,
              { backgroundColor: colors.primary },
              pressed && settingsStyles.pressed,
            ]}
          >
            <Ionicons name="key-outline" size={18} color="#fff" />
            <Text style={styles.changePasswordButtonText}>{t('changePassword')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.logoutSection}>
        <Pressable
          style={({ pressed }) => [
            styles.logoutButton,
            dynamicStyles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
          onPress={handleLogout}
        >
          <Text style={[styles.logoutButtonText, dynamicStyles.logoutButtonText]}>{t('logOut')}</Text>
        </Pressable>
      </View>
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>
    <Modal
      visible={changePasswordVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setChangePasswordVisible(false)}
    >
      <Pressable style={styles.modalBackdrop} onPress={() => setChangePasswordVisible(false)}>
        <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
          <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{t('changePassword')}</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border }]}
            placeholder={t('currentPassword')}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={currentPw}
            onChangeText={(v) => { setCurrentPw(v); setChangePwError(null); }}
            autoFocus
            editable={!changePwLoading}
          />
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border }]}
            placeholder={t('newPassword')}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={newPw}
            onChangeText={(v) => { setNewPw(v); setChangePwError(null); }}
            editable={!changePwLoading}
          />
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.inputBg, color: colors.textPrimary, borderColor: colors.border }]}
            placeholder={t('confirmNewPassword')}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={confirmPw}
            onChangeText={(v) => { setConfirmPw(v); setChangePwError(null); }}
            editable={!changePwLoading}
            returnKeyType="done"
            onSubmitEditing={handleChangePassword}
          />
          {changePwError && (
            <Text style={[styles.modalError, { color: colors.red }]}>{changePwError}</Text>
          )}
          <View style={styles.modalButtons}>
            <Pressable
              onPress={() => setChangePasswordVisible(false)}
              disabled={changePwLoading}
              style={({ pressed }) => [
                styles.modalButton,
                { borderColor: colors.border },
                pressed && settingsStyles.pressed,
              ]}
            >
              <Text style={[styles.modalButtonText, { color: colors.textPrimary }]}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={handleChangePassword}
              disabled={changePwLoading}
              style={({ pressed }) => [
                styles.modalButton,
                styles.modalButtonPrimary,
                { backgroundColor: colors.primary },
                pressed && settingsStyles.pressed,
                changePwLoading && settingsStyles.disabled,
              ]}
            >
              {changePwLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>{t('save')}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
  },
  contentGrow: {
    flexGrow: 1,
  },
  extensionsBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  extensionsTitle: {
    fontSize: 12,
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
    fontSize: 12,
  },
  placeholder: {
    fontSize: 16,
    fontStyle: 'italic',
    padding: 16,
  },
  scanButtons: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
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
  scanHint: {
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  fieldLabel: {
    fontSize: 16,
    flex: 1,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  passwordValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoutSection: {
    marginTop: 'auto',
  },
  logoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonPressed: {
    opacity: 0.8,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  changePasswordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
  },
  changePasswordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  modalError: {
    fontSize: 12,
    marginBottom: 10,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  modalButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalButtonPrimary: {
    borderWidth: 0,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
