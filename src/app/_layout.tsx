import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, BackHandler, Dimensions, LogBox, Platform, StyleSheet, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Easing, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

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
import { DARK_MIX, GRADIENT_LOCATIONS, GRADIENT_MIX_CURVE, GradientBackground, LIGHT_MIX } from '../components/GradientBackground';
import { mixHexColors } from '../utils/colors';
import AnimatedSplashScreen from '../components/AnimatedSplashScreen';
import { CertificatePromptModal } from '../components/CertificatePromptModal';
import { CreateShareSheet } from '../components/CreateShareSheet';
import { ExpandedPlayerView } from '../components/ExpandedPlayerView';
import { PlayerPanel } from '../components/PlayerPanel';
import { SplitLayout } from '../components/SplitLayout';
import { MbidSearchSheet } from '../components/MbidSearchSheet';
import { MoreOptionsSheet } from '../components/MoreOptionsSheet';
import { OnboardingGuide } from '../components/OnboardingGuide';
import { SetRatingSheet } from '../components/SetRatingSheet';
import { PlaybackToast } from '../components/PlaybackToast';
import { ProcessingOverlay } from '../components/ProcessingOverlay';
import { useDownloadBackgroundNotification } from '../hooks/useDownloadBackgroundNotification';
import { useDownloadKeepAwake } from '../hooks/useDownloadKeepAwake';
import { useLayoutMode } from '../hooks/useLayoutMode';
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
import { genreStore } from '../store/genreStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { fetchServerInfo } from '../services/subsonicService';
import { playerStore } from '../store/playerStore';
import { serverInfoStore } from '../store/serverInfoStore';
import { sqliteStorage } from '../store/sqliteStorage';
import { tabletLayoutStore } from '../store/tabletLayoutStore';

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

// Sync the persisted theme preference to the native UIKit layer at module
// scope — before any React component renders. This ensures liquid glass
// containers on iOS 26 use the correct color scheme from the very first frame.
// The sqliteStorage read is synchronous, so there is no async gap.
(() => {
  try {
    const raw = sqliteStorage.getItem('substreamer-theme') as string | null;
    if (raw) {
      const { state } = JSON.parse(raw);
      if (state?.themePreference && state.themePreference !== 'system') {
        Appearance.setColorScheme(state.themePreference);
      }
    }
  } catch { /* non-critical: falls back to system default */ }
})();

// Detect phone vs tablet at module scope using Android 16's large-screen
// threshold (smallest screen dimension >= 600dp).
const screenDims = Dimensions.get('screen');
const IS_TABLET = Math.min(screenDims.width, screenDims.height) >= 600;

// Lock orientation to portrait on phones. Tablets are left free to rotate
// (controlled at runtime by the orientation lock setting in layoutPreferencesStore).
if (!IS_TABLET) {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    .catch(() => { /* non-critical: orientation lock unavailable */ });
}

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
  const { theme, colors, preference } = useTheme();
  const layoutMode = useLayoutMode();
  const router = useRouter();
  const segments = useSegments();
  const currentTrack = playerStore((s) => s.currentTrack);
  const queueLoading = playerStore((s) => s.queueLoading);
  const hasCurrentTrack = currentTrack !== null;
  const playerExpanded = tabletLayoutStore((s) => s.playerExpanded);

  const isWide = layoutMode === 'wide';
  // Keep the panel visible during queue replacement — queueLoading is true
  // while playTrack() is resetting and reloading the RNTP queue, during
  // which currentTrack may momentarily go null.
  const showPanel = isWide && (hasCurrentTrack || queueLoading);

  // Skip the panel slide animation when the layout mode changes (rotation).
  // The panel should appear/disappear instantly during orientation changes
  // but animate smoothly for user-driven show/hide (e.g. clearing queue).
  const prevIsWideRef = useRef(isWide);
  const animatePanel = prevIsWideRef.current === isWide;
  prevIsWideRef.current = isWide;

  // --- Expand/collapse animation progress (0 = compact, 1 = expanded) ---
  const expandProgress = useSharedValue(0);

  useEffect(() => {
    if (playerExpanded && isWide && hasCurrentTrack) {
      expandProgress.value = withSpring(1, { damping: 20, stiffness: 200, mass: 1 });
    } else {
      expandProgress.value = withTiming(0, { duration: 300, easing: Easing.inOut(Easing.cubic) });
    }
  }, [playerExpanded, isWide, hasCurrentTrack, expandProgress]);

  // Reset expanded state when leaving wide mode (e.g. rotating to portrait)
  useEffect(() => {
    if (!isWide) {
      tabletLayoutStore.getState().setPlayerExpanded(false);
    }
  }, [isWide]);

  // Dismiss the phone /player modal when rotating into wide mode, since
  // the player panel takes over and having both visible is confusing.
  useEffect(() => {
    if (isWide && segments[0] === 'player') {
      router.back();
    }
  }, [isWide, segments, router]);

  // Sync the app's theme preference to the native UIKit layer so that native
  // UI elements (e.g. iOS 26 liquid glass containers) render with the correct
  // color scheme immediately, avoiding a white flash during navigation transitions.
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

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
  // Depends on isLoggedIn so it re-runs after a logout/login cycle.
  // The root layout stays mounted across auth transitions, so a static
  // [] dep array would only fire once at cold start — leaving cache
  // byte totals stale after login (the cause of inflated "used space"
  // numbers when the user logs out and back in).
  useEffect(() => {
    if (!isLoggedIn) return;
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
  }, [isLoggedIn]);

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
      genreStore.getState().fetchGenres();
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
        genreStore.getState().fetchGenres();
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

  // Build a navigation theme that matches the app's resolved theme. This is
  // critical: expo-router's NavigationContainer defaults to DefaultTheme (white
  // background). During native push/pop transitions, react-native-screens
  // briefly exposes this background — on iOS 26 the liquid glass header
  // refracts it, causing a white flash in dark mode.
  const navigationTheme = useMemo(() => {
    const base = theme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.background,
        card: colors.card,
        text: colors.textPrimary,
        border: colors.border,
        primary: colors.primary,
      },
    };
  }, [theme, colors]);

  const androidGradientColors = useMemo(() => {
    if (Platform.OS === 'ios') return undefined;
    const peak = theme === 'dark' ? DARK_MIX : LIGHT_MIX;
    return GRADIENT_MIX_CURVE.map((m) =>
      mixHexColors(colors.background, colors.primary, peak * m)
    ) as [string, string, ...string[]];
  }, [theme, colors.primary, colors.background]);

  const blurHeaderOptions = useMemo(() => ({
    headerTransparent: true as const,
    headerStyle: { backgroundColor: 'transparent' },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: 'transparent' },
    headerBackground: () =>
      Platform.OS === 'ios' ? (
        <BlurView
          tint={theme === 'dark' ? 'dark' : 'light'}
          intensity={80}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <LinearGradient
            colors={androidGradientColors!}
            locations={GRADIENT_LOCATIONS}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Dimensions.get('window').height }}
            pointerEvents="none"
          />
        </View>
      ),
  }), [theme, androidGradientColors]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navigationTheme}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <SplitLayout
        animate={animatePanel}
        main={
          <View style={{ flex: 1 }}>
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
          options={{ ...blurHeaderOptions, title: 'Albums', headerBackTitle: 'Back' }}
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
          options={{ ...blurHeaderOptions, title: 'Image Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="metadata-cache-browser"
          options={{ ...blurHeaderOptions, title: 'Metadata Cache', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="music-cache-browser"
          options={{ ...blurHeaderOptions, title: 'Downloaded Music', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="download-queue"
          options={{ ...blurHeaderOptions, title: 'Downloads', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="settings-server"
          options={{ ...blurHeaderOptions, title: 'Server Management', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-appearance"
          options={{ ...blurHeaderOptions, title: 'Appearance & Layout', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-connectivity"
          options={{ ...blurHeaderOptions, title: 'Connectivity', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-storage"
          options={{ ...blurHeaderOptions, title: 'Storage & Data', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-shares"
          options={{ ...blurHeaderOptions, title: 'Shares', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-account"
          options={{ ...blurHeaderOptions, title: 'Account', headerBackTitle: 'Settings' }}
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
          options={{ ...blurHeaderOptions, title: 'MBID Overrides', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="scrobble-browser"
          options={{ ...blurHeaderOptions, title: 'Scrobbles', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="scrobble-exclusion-browser"
          options={{ ...blurHeaderOptions, title: 'Scrobble Exclusions', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="my-listening"
          options={{ ...blurHeaderOptions, title: 'My Listening', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="tuned-in"
          options={{ ...blurHeaderOptions, title: 'Tuned In', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="settings-audio-quality"
          options={{ ...blurHeaderOptions, title: 'Audio Quality', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="settings-playback"
          options={{ ...blurHeaderOptions, title: 'Playback', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="file-explorer"
          options={{ ...blurHeaderOptions, title: 'File Explorer', headerBackTitle: 'Settings' }}
        />
        <Stack.Screen
          name="file-viewer"
          options={{ ...blurHeaderOptions, title: '', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="migration-log"
          options={{ ...blurHeaderOptions, title: 'Migration Log', headerBackTitle: 'Back' }}
        />
            </Stack>
          </View>
        }
        panel={showPanel ? <PlayerPanel /> : null}
        panelPlaceholder={<GradientBackground style={{ flex: 1 }}>{null}</GradientBackground>}
      />

      {/* Full-screen expanded player — covers everything including SplitLayout */}
      {showPanel && (
        <ExpandedPlayerView expandProgress={expandProgress} />
      )}

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

      {/* Onboarding welcome guide shown once after first login */}
      <OnboardingGuide />

      {/* Animated splash renders as an overlay on top of the Stack so the
          navigator is always mounted and ready for auth-based navigation. */}
      {splashVisible && (
        <AnimatedSplashScreen onFinish={handleSplashFinish} />
      )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
