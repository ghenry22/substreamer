import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Both expo-router (RouterFontUtils.swift) and react-native-screens
// (RNSBarButtonItem.mm, RNSScreenStackHeaderConfig.mm) call
// setTitleTextAttributes(_:for:) with UIControlStateSelected on
// UIBarButtonItem, which UIKit does not support — it only accepts
// .normal, .highlighted, .disabled, and .focused. The warning is
// harmless (UIKit silently maps .selected → .highlighted) but floods
// the console on every toolbar update.
LogBox.ignoreLogs([
  'button text attributes only respected for',
  // React Native's Fabric ScrollView (RCTScrollViewComponentView.mm)
  // implements focusItemsInRect: to support tvOS/keyboard focus
  // navigation. UIKit logs a warning for every scroll view on screen
  // because the override disables its internal linear-focus-movement
  // cache optimisation. This affects all ScrollView-based components
  // (FlashList, FlatList, DraggableFlatList, etc.) and is a known
  // React Native issue with no user-side fix.
  'RCTScrollViewComponentView implements focusItemsInRect:',
]);

import { AddToPlaylistSheet } from '../components/AddToPlaylistSheet';
import AnimatedSplashScreen from '../components/AnimatedSplashScreen';
import { CertificatePromptModal } from '../components/CertificatePromptModal';
import { CreateShareSheet } from '../components/CreateShareSheet';
import { MbidSearchSheet } from '../components/MbidSearchSheet';
import { MoreOptionsSheet } from '../components/MoreOptionsSheet';
import { SetRatingSheet } from '../components/SetRatingSheet';
import { PlaybackToast } from '../components/PlaybackToast';
import { ProcessingOverlay } from '../components/ProcessingOverlay';
import { useDownloadBackgroundNotification } from '../hooks/useDownloadBackgroundNotification';
import { useDownloadKeepAwake } from '../hooks/useDownloadKeepAwake';
import { useTheme } from '../hooks/useTheme';
import { deferredImageCacheInit, getImageCacheStats, initImageCache } from '../services/imageCacheService';
import { deferredMusicCacheInit, getMusicCacheStats, initMusicCache } from '../services/musicCacheService';
import { checkStorageLimit } from '../services/storageService';
import { initPlayer, removeNonDownloadedTracks } from '../services/playerService';
import { fetchScanStatus } from '../services/scanService';
import NetInfo from '@react-native-community/netinfo';
import { startMonitoring, stopMonitoring } from '../services/connectivityService';
import { initScrobbleService } from '../services/scrobbleService';
import { initSslTrustStore, trustCertificateForHost } from '../services/sslTrustService';
import { runAutoBackupIfNeeded } from '../services/backupService';
import { startAutoOffline, stopAutoOffline } from '../services/autoOfflineService';
import { excludeFromBackup } from 'expo-backup-exclusions';
import { moveToBack } from 'expo-move-to-back';
import { albumLibraryStore } from '../store/albumLibraryStore';
import { albumListsStore } from '../store/albumListsStore';
import { artistLibraryStore } from '../store/artistLibraryStore';
import { imageCacheStore } from '../store/imageCacheStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { authStore } from '../store/authStore';
import { favoritesStore } from '../store/favoritesStore';
import { autoOfflineStore } from '../store/autoOfflineStore';
import { certPromptStore } from '../store/certPromptStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { fetchServerInfo } from '../services/subsonicService';
import { serverInfoStore } from '../store/serverInfoStore';

// react-native-bootsplash keeps the native splash visible by default
// until BootSplash.hide() is called. AnimatedSplashScreen handles the
// hide via useHideAnimation for a seamless native → JS transition.

// Enable SSID fetching globally — must be called before any NetInfo listener
// is registered (connectivityService, autoOfflineService). Safe to always
// enable; it simply tells the native module to include SSID in state updates.
NetInfo.configure({ shouldFetchWiFiSSID: true });

// Initialise the on-disk cache directories at module load (fast mkdir only).
initImageCache();
initMusicCache();

// Initialise the SSL trust store so the custom TrustManager / URLSession
// delegate is installed before any network requests are made.
initSslTrustStore();

// Suppress ExpoKeepAwake errors that fire when the activity becomes
// temporarily unavailable during backgrounding (moveTaskToBack).
// These are non-fatal — keep-awake state is restored when the activity resumes.
const originalHandler = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
(globalThis as any).ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
  if (!isFatal && error?.message?.includes?.('ExpoKeepAwake')) return;
  originalHandler?.(error, isFatal);
});

export default function RootLayout() {
  const [splashVisible, setSplashVisible] = useState(true);
  const rehydrated = authStore((s) => s.rehydrated);
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const { theme, colors } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  useDownloadKeepAwake();
  useDownloadBackgroundNotification();

  // --- Global SSL cert prompt driven by certPromptStore ---
  const certPromptVisible = certPromptStore((s) => s.visible);
  const certPromptInfo = certPromptStore((s) => s.certInfo);
  const certPromptHostname = certPromptStore((s) => s.hostname);
  const certPromptIsRotation = certPromptStore((s) => s.isRotation);

  const handleCertTrust = useCallback(async () => {
    const { certInfo, hostname } = certPromptStore.getState();
    if (!certInfo || !hostname) return;
    await trustCertificateForHost(hostname, certInfo.sha256Fingerprint, certInfo.validTo);
    certPromptStore.getState().hide();
  }, []);

  const handleCertCancel = useCallback(() => {
    certPromptStore.getState().hide();
  }, []);

  // --- Exclude cache dirs from iCloud backup (iOS); no-op on Android ---
  useEffect(() => {
    excludeFromBackup();
  }, []);

  // --- Deferred startup: expensive filesystem scanning ---
  useEffect(() => {
    // Defer expensive filesystem scanning to after the first frame renders.
    // useEffect fires after React commits the initial render, so the native
    // splash hides promptly. All scanning runs on native background threads
    // via expo-async-fs (no JS thread blocking, no setTimeout(0) needed).
    let cancelled = false;
    (async () => {
      await deferredImageCacheInit();
      await deferredMusicCacheInit();
      if (cancelled) return;
      imageCacheStore.getState().recalculate(await getImageCacheStats());
      musicCacheStore.getState().recalculate(await getMusicCacheStats());
      checkStorageLimit();
      await runAutoBackupIfNeeded();
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Rehydrate auth from SQLite ---
  useEffect(() => {
    const done = () => {
      authStore.getState().setRehydrated(true);
    };
    const p = authStore.persist.rehydrate();
    if (p instanceof Promise) {
      p.then(done);
    } else {
      done();
    }
  }, []);

  // --- Initialise audio player & pre-fetch server data when logged in ---
  useEffect(() => {
    if (!rehydrated || !isLoggedIn) return;
    initPlayer();
    initScrobbleService();

    const offline = offlineModeStore.getState().offlineMode;

    // Start auto-offline monitoring if enabled
    if (autoOfflineStore.getState().enabled) {
      startAutoOffline();
    }

    if (!offline) {
      startMonitoring();
      fetchServerInfo().then((info) => {
        if (info) serverInfoStore.getState().setServerInfo(info);
      });
      fetchScanStatus();
      albumListsStore.getState().refreshAll();
      favoritesStore.getState().fetchStarred();

      // Pre-fetch library data on first launch or when stores are empty
      if (albumLibraryStore.getState().albums.length === 0) {
        albumLibraryStore.getState().fetchAllAlbums();
      }
      if (artistLibraryStore.getState().artists.length === 0) {
        artistLibraryStore.getState().fetchAllArtists();
      }
      if (playlistLibraryStore.getState().playlists.length === 0) {
        playlistLibraryStore.getState().fetchAllPlaylists();
      }
    }

    const unsubAutoOffline = autoOfflineStore.subscribe((state, prev) => {
      if (state.enabled && !prev.enabled) startAutoOffline();
      else if (!state.enabled && prev.enabled) stopAutoOffline();
    });

    const unsub = offlineModeStore.subscribe((state, prev) => {
      // Defer queue cleanup so the offline mode toggle and filter bar update
      // immediately without waiting for a potentially long queue scan.
      if (state.offlineMode && !prev.offlineMode) {
        setTimeout(removeNonDownloadedTracks, 0);
      }
      if (prev.offlineMode && !state.offlineMode) {
        startMonitoring();
        fetchServerInfo().then((info) => {
          if (info) serverInfoStore.getState().setServerInfo(info);
        });
        fetchScanStatus();
        albumListsStore.getState().refreshAll();
        favoritesStore.getState().fetchStarred();

        if (albumLibraryStore.getState().albums.length === 0) {
          albumLibraryStore.getState().fetchAllAlbums();
        }
        if (artistLibraryStore.getState().artists.length === 0) {
          artistLibraryStore.getState().fetchAllArtists();
        }
        if (playlistLibraryStore.getState().playlists.length === 0) {
          playlistLibraryStore.getState().fetchAllPlaylists();
        }
      } else if (!prev.offlineMode && state.offlineMode) {
        stopMonitoring();
      }
    });

    return () => {
      unsub();
      unsubAutoOffline();
      stopAutoOffline();
      stopMonitoring();
    };
  }, [rehydrated, isLoggedIn]);

  // --- Android: background the app instead of killing it at the root ---
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = () => {
      // Only intercept on the home tab — other tabs navigate back to home first
      if (segments[0] === '(tabs)' && (segments as string[])[1] === 'index') {
        moveToBack();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, [segments]);

  // --- Auth-based navigation ---
  // Use router.replace inside useEffect instead of <Redirect> so the
  // Stack navigator stays mounted and expo-router can render the target screen.
  useEffect(() => {
    if (!rehydrated || splashVisible) return;

    const onLoginScreen = segments[0] === 'login';

    if (!isLoggedIn && !onLoginScreen) {
      router.replace('/login');
    } else if (isLoggedIn && onLoginScreen) {
      router.replace('/');
    }
  }, [rehydrated, isLoggedIn, splashVisible, segments, router]);

  const handleSplashFinish = useCallback(() => {
    setSplashVisible(false);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="album-list"
          options={{ title: 'Albums', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="album/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="artist/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="playlist/[id]"
          options={{
            title: '',
            headerBackTitle: 'Back',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="image-cache-browser"
          options={{ title: 'Image Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="metadata-cache-browser"
          options={{ title: 'Metadata Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="music-cache-browser"
          options={{ title: 'Downloaded Music', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="download-queue"
          options={{ title: 'Downloads', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="settings-server"
          options={{ title: 'Server Management', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-appearance"
          options={{ title: 'Appearance & Layout', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-connectivity"
          options={{ title: 'Connectivity', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-storage"
          options={{ title: 'Storage & Data', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-shares"
          options={{ title: 'Shares', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-account"
          options={{ title: 'Account', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="player"
          options={{
            title: 'Now Playing',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'slide_from_bottom',
            gestureDirection: 'vertical',
            headerBackVisible: false,
          }}
        />
        <Stack.Screen
          name="mbid-override-browser"
          options={{ title: 'MBID Overrides', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="scrobble-browser"
          options={{ title: 'Scrobbles', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="scrobble-exclusion-browser"
          options={{ title: 'Scrobble Exclusions', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="my-listening"
          options={{ title: 'My Listening', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="settings-audio-quality"
          options={{ title: 'Audio Quality', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="file-explorer"
          options={{ title: 'File Explorer', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="migration-log"
          options={{ title: 'Migration Log', headerBackTitle: 'Back' }}
        />
      </Stack>

      {/* Global more-options bottom sheet driven by moreOptionsStore */}
      <MoreOptionsSheet />

      {/* Global create-share bottom sheet driven by createShareStore */}
      <CreateShareSheet />

      {/* Global set-rating bottom sheet driven by setRatingStore */}
      <SetRatingSheet />

      {/* Global add-to-playlist bottom sheet driven by addToPlaylistStore */}
      <AddToPlaylistSheet />

      {/* Global MBID search sheet driven by mbidSearchStore */}
      <MbidSearchSheet />

      {/* Global SSL certificate prompt driven by certPromptStore */}
      <CertificatePromptModal
        visible={certPromptVisible}
        certInfo={certPromptInfo}
        hostname={certPromptHostname}
        isRotation={certPromptIsRotation}
        onTrust={handleCertTrust}
        onCancel={handleCertCancel}
      />

      {/* Global processing overlay for async operations (delete, etc.) */}
      <ProcessingOverlay />

      {/* Playback toast for detail screens without a MiniPlayer */}
      <PlaybackToast />

      {/* Animated splash renders as an overlay on top of the Stack so the
          navigator is always mounted and ready for auth-based navigation. */}
      {splashVisible && (
        <AnimatedSplashScreen onFinish={handleSplashFinish} />
      )}
    </GestureHandlerRootView>
  );
}
