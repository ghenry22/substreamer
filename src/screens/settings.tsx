import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { stopPolling } from '../services/scanService';
import { clearApiCache } from '../services/subsonicService';
import { authStore } from '../store/authStore';
import { scanStatusStore } from '../store/scanStatusStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { sqliteStorage } from '../store/sqliteStorage';

const AUTH_PERSIST_KEY = 'substreamer-auth';
const SERVER_INFO_PERSIST_KEY = 'substreamer-server-info';
const SCAN_STATUS_PERSIST_KEY = 'substreamer-scan-status';

const SETTINGS_LINKS: {
  route: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { route: '/settings-server', label: 'Server Management', subtitle: 'Server info, library scanning', icon: 'server-outline' },
  { route: '/settings-appearance', label: 'Appearance & Layout', subtitle: 'Theme, accent color, sort order, grid/list views', icon: 'color-palette-outline' },
  { route: '/settings-media-formats', label: 'Media Formats', subtitle: 'Bitrate, streaming format, transcoding, caching format', icon: 'musical-notes-outline' },
  { route: '/settings-connectivity', label: 'Connectivity', subtitle: 'Trusted SSL certificates', icon: 'globe-outline' },
  { route: '/settings-storage', label: 'Storage & Data', subtitle: 'Image cache, metadata cache, scrobbles', icon: 'folder-outline' },
];

export function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const handleLogout = async () => {
    stopPolling();
    authStore.getState().clearSession();
    serverInfoStore.getState().clearServerInfo();
    scanStatusStore.getState().clearScanStatus();
    clearApiCache();
    sqliteStorage.removeItem(AUTH_PERSIST_KEY);
    sqliteStorage.removeItem(SERVER_INFO_PERSIST_KEY);
    sqliteStorage.removeItem(SCAN_STATUS_PERSIST_KEY);
    router.replace('/login');
  };

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { backgroundColor: colors.background },
        sectionTitle: { color: colors.label },
        logoutButton: { borderColor: colors.red },
        logoutButtonText: { color: colors.red },
      }),
    [colors]
  );

  return (
    <ScrollView
      style={[styles.container, dynamicStyles.container]}
      contentContainerStyle={[styles.content, styles.contentGrow]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <View style={[styles.navCard, { backgroundColor: colors.card }]}>
          {SETTINGS_LINKS.map((link, index) => (
            <Pressable
              key={link.route}
              onPress={() => router.push(link.route as never)}
              style={({ pressed }) => [
                styles.navRow,
                index < SETTINGS_LINKS.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.navRowLeft}>
                <Ionicons name={link.icon} size={20} color={colors.primary} style={styles.navRowIcon} />
                <View style={styles.navRowText}>
                  <Text style={[styles.navRowLabel, { color: colors.textPrimary }]}>
                    {link.label}
                  </Text>
                  <Text style={[styles.navRowSubtitle, { color: colors.textSecondary }]}>
                    {link.subtitle}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.accountSection}>
        <Text style={[styles.sectionTitle, dynamicStyles.sectionTitle]}>Account</Text>
        <Pressable
          style={({ pressed }) => [
            styles.logoutButton,
            dynamicStyles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
          onPress={handleLogout}
        >
          <Text style={[styles.logoutButtonText, dynamicStyles.logoutButtonText]}>Log out</Text>
        </Pressable>
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
  contentGrow: {
    flexGrow: 1,
  },
  section: {
    marginBottom: 24,
  },
  accountSection: {
    marginTop: 'auto',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  navCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  navRowIcon: {
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  navRowText: {
    flex: 1,
  },
  navRowLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  navRowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.8,
  },
  logoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 14,
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
});
