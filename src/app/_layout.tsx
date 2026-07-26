import { ThemeProvider, DarkTheme, DefaultTheme } from "expo-router/react-navigation";
import { errMessage } from '../utils/errorMessage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, AppState, BackHandler, Dimensions, LogBox, Platform, StyleSheet, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { I18nextProvider } from 'react-i18next';
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
  // (FlashList, FlatList, ReorderableList, etc.) and is a known
  // React Native issue with no user-side fix.
  'RCTScrollViewComponentView implements focusItemsInRect:',
]);

import { AddToPlaylistSheet } from '../components/AddToPlaylistSheet';
import { BookmarkNameSheet } from '../components/BookmarkNameSheet';
import { RootErrorBoundary } from '../components/RootErrorBoundary';
import { ThemedAlertHost } from '../components/ThemedAlertHost';
import { DARK_MIX, GRADIENT_LOCATIONS, GRADIENT_MIX_CURVE, GradientBackground, LIGHT_MIX } from '../components/GradientBackground';
import { mixHexColors } from '../utils/colors';
import { runWhenIdle } from '../utils/runWhenIdle';
import AnimatedSplashScreen from '../components/AnimatedSplashScreen';
import { CertificatePromptModal } from '../components/CertificatePromptModal';
import { CreateShareSheet } from '../components/CreateShareSheet';
import { PlayerTabletLandscape } from '../components/player/PlayerTabletLandscape';
import { PlayerTabletSplitview } from '../components/player/PlayerTabletSplitview';
import { SplitLayout } from '../components/SplitLayout';
import { MbidSearchSheet } from '../components/MbidSearchSheet';
import { MoreOptionsSheet } from '../components/MoreOptionsSheet';
import { RoutePickerSheet } from '../components/RoutePicker';
import { OnboardingGuide } from '../components/OnboardingGuide';
import { BackgroundPlaybackPromptModal } from '../components/BackgroundPlaybackPromptModal';
import { SetRatingSheet } from '../components/SetRatingSheet';
import { SleepTimerSheet } from '../components/SleepTimerSheet';
import { PlaybackToast } from '../components/PlaybackToast';
import { ProcessingOverlay } from '../components/ProcessingOverlay';
import { initSongLibrary } from '../hooks/useAllSongsByTitle';
import { useDownloadBackgroundNotification } from '../hooks/useDownloadBackgroundNotification';
import { useDownloadKeepAwake } from '../hooks/useDownloadKeepAwake';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useTheme } from '../hooks/useTheme';
import {
  deferredDataSyncInit,
  onOnlineResume,
  onStartup,
  recoverStalledSync,
} from '../services/dataSyncService';
import { useLibrarySyncBackgroundNotification } from '../hooks/useLibrarySyncBackgroundNotification';
import { useLibrarySyncKeepAwake } from '../hooks/useLibrarySyncKeepAwake';
import {
  deferredImageCacheInit,
  initImageCache,
  processImageQueue,
  recoverStalledImageDownloads,
} from '../services/imageCacheService';
import { connectivityStore } from '../store/connectivityStore';
import { deferredMusicCacheInit, getMusicCacheStats, initMusicCache } from '../services/musicCacheService';
import { checkStorageLimit } from '../services/storageService';
import { initPlayer, removeNonDownloadedTracks, restorePersistedQueueAfterBoot } from '../services/playerService';
import { refreshHeadlessMediaSnapshot } from '../services/headlessMediaService';
import { flushPersistedQueue } from '../services/queuePersistenceService';
import { initNetInfoConfig } from '../services/netInfoConfig';
import { startMonitoring, stopMonitoring } from '../services/connectivityService';
import { initFailover } from '../services/failoverService';
import { initScrobbleService } from '../services/scrobbleService';
import { initSslTrustStore, syncProxyUpstreams, trustCertificateForHost } from '../services/sslTrustService';
import { runAutoBackupIfNeeded } from '../services/backupService';
import { startAutoOffline, stopAutoOffline } from '../services/autoOfflineService';
import { excludeFromBackup } from 'expo-backup-exclusions';
import { moveToBack } from 'expo-move-to-back';
import { flushAllPersistStorages } from '../store/persistence';
import { awaitKvHydration, rehydrateAllStores } from '../store/persistence/rehydrate';
import { albumListsStore } from '../store/albumListsStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { authStore } from '../store/authStore';
import { autoOfflineStore } from '../store/autoOfflineStore';
import { certPromptStore } from '../store/certPromptStore';
import { initializeOfflineFilterBarSync, offlineModeStore } from '../store/offlineModeStore';
import { playerStore } from '../store/playerStore';
// Synchronous adapter: the pre-render native-color-scheme read needs a
// synchronous result before first paint (see the module-scope IIFE below).
import { kvStorageSync as kvStorage } from '../store/persistence';
import { tabletLayoutStore } from '../store/tabletLayoutStore';
import i18n from '../i18n/i18n';

// react-native-bootsplash keeps the native splash visible by default
// until BootSplash.hide() is called. AnimatedSplashScreen handles the
// hide via useHideAnimation for a seamless native → JS transition.

// All four module-scope initialisers below are wrapped in try/catch because
// they run before any React error boundary mounts. On stripped OEM ROMs
// (MIUI/HyperOS, FunTouch) or restricted permission states, the underlying
// native calls (NetInfo bridge, fs mkdir, JSSE TrustManager install) can
// throw — and any throw at this point would crash the JS bundle before the
// app can render its login screen, leaving the user with a black screen.
// Better to log the failure and let the affected feature degrade gracefully.

// Configure NetInfo once, before any listener registers. SSID fetching is
// enabled only while home-WiFi auto-offline needs it (see netInfoConfig);
// keeping it always-on calls iOS's location-gated SSID API on every WiFi
// state update — a needless battery/CPU drain (#200).
try {
  initNetInfoConfig();
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[layout] initNetInfoConfig failed:', errMessage(e));
}

// Initialise the on-disk cache directories at module load (fast mkdir only).
try {
  initImageCache();
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[layout] initImageCache failed:', errMessage(e));
}
try {
  initMusicCache();
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[layout] initMusicCache failed:', errMessage(e));
}

// Initialise the SSL trust store so the custom TrustManager / URLSession
// delegate is installed before any network requests are made.
try {
  initSslTrustStore();
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[layout] initSslTrustStore failed:', errMessage(e));
}

// Sync the persisted theme preference to the native layer at module scope —
// before any React component renders. This ensures:
//   • iOS 26 liquid glass containers use the correct color scheme from frame 1
//   • Android sets AppCompatDelegate night mode BEFORE the Activity finishes
//     creating, avoiding an onConfigurationChanged during React's initial
//     render that crashes on Android 16 (see #85)
// The 'system' preference MUST also call setColorScheme('unspecified') here;
// skipping it leaves the mode unset until a useEffect fires post-render,
// which triggers a configuration change event mid-commit and crashes.
(() => {
  try {
    const raw = kvStorage.getItem('substreamer-theme') as string | null;
    if (raw) {
      const { state } = JSON.parse(raw);
      const pref = state?.themePreference;
      Appearance.setColorScheme(
        pref === 'light' || pref === 'dark' ? pref : 'unspecified'
      );
    }
  } catch { /* non-critical: falls back to system default */ }
})();

// Detect phone vs tablet at module scope using Android 16's large-screen
// threshold (smallest screen dimension >= 600dp). Falls back to "phone" if
// the Dimensions bridge is unavailable for any reason — this is the safer
// default since the phone-only orientation lock below is opt-out.
let IS_TABLET = false;
try {
  const screenDims = Dimensions.get('screen');
  IS_TABLET = Math.min(screenDims.width, screenDims.height) >= 600;
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[layout] Dimensions.get failed; assuming phone:', errMessage(e));
}

// Lock orientation to portrait on phones. Tablets are left free to rotate
// (controlled at runtime by the orientation lock setting in layoutPreferencesStore).
// The synchronous property access on ScreenOrientation.OrientationLock can
// throw if the native module is missing (the .catch() only handles promise
// rejection), so wrap the whole thing.
if (!IS_TABLET) {
  try {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      .catch(() => { /* non-critical: orientation lock unavailable */ });
  } catch {
    /* non-critical: ScreenOrientation native module unavailable */
  }
}

// Suppress ExpoKeepAwake errors that fire when the activity becomes
// temporarily unavailable during backgrounding (moveTaskToBack).
// These are non-fatal — keep-awake state is restored when the activity resumes.
const originalHandler = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
(globalThis as any).ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
  if (!isFatal && error?.message?.includes?.('ExpoKeepAwake')) return;
  originalHandler?.(error, isFatal);
});

// Runs the post-login deferred startup chain. Each stage executes in its own
// try/catch so one non-critical failure (image cache disk error, backup
// permission denied, etc.) no longer suppresses unrelated stages like storage
// checks, backup, or sync recovery. Cancellation is checked between stages so
// logout-during-startup still bails cleanly.
async function runDeferredStartup(getCancelled: () => boolean): Promise<void> {
  const stage = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[layout][${name}] failed:`,
        errMessage(e),
      );
    }
  };

  // Schedule a non-critical housekeeping stage in an idle window instead of
  // blocking the chain. For heavy, best-effort work that must never gate the
  // user-facing stages (it would otherwise run serially ahead of them).
  const idleStage = (name: string, fn: () => Promise<void> | void) => {
    runWhenIdle(() => { if (!getCancelled()) void stage(name, fn); });
  };

  // Explicit boot-owned subscription setup (moved here from module scope
  // in Phase 5 so test imports don't trigger the cross-store side effect).
  await stage('initializeOfflineFilterBarSync', () => { initializeOfflineFilterBarSync(); });
  if (getCancelled()) return;

  await stage('deferredImageCacheInit', () => deferredImageCacheInit());
  if (getCancelled()) return;
  await stage('deferredMusicCacheInit', () => deferredMusicCacheInit());
  if (getCancelled()) return;

  // imageCacheStore aggregates come from SQL now (via `rehydrateAllStores`
  // at splash and `reconcileImageCache` inside `deferredImageCacheInit`),
  // so the one-time recalculate-from-stats call is gone.
  // Settings-only "used space" total from a full recursive cache-dir walk —
  // defer to idle; the store already shows the SQL-derived aggregate.
  idleStage('musicCacheStats', async () => {
    musicCacheStore.getState().recalculate(await getMusicCacheStats());
  });
  if (getCancelled()) return;

  await stage('checkStorageLimit', () => { checkStorageLimit(); });
  if (getCancelled()) return;

  // Auto-backup serializes the full scrobble history + writes files — pure,
  // interval-gated housekeeping with no first-render relevance. Defer to idle.
  idleStage('runAutoBackupIfNeeded', () => runAutoBackupIfNeeded());
  if (getCancelled()) return;

  // Resume any stalled album-detail walk from a previous session — background
  // reconciliation, not first-render. Deferred to idle (scheduled here, after
  // the awaited image/music cache init, so it still won't race their SQLite
  // setup).
  idleStage('deferredDataSyncInit', () => deferredDataSyncInit());
  if (getCancelled()) return;

  // Build the songs-library list once, now that the startup data-load/refresh
  // tasks have settled, so the first tap on the Songs segment is an instant hit.
  // Thereafter it's kept current by optimistic in-memory patches from song-index
  // writes — no full rebuild on every album-detail sync.
  await stage('initSongLibrary', () => { initSongLibrary(); });
  if (getCancelled()) return;

  // Re-push the CarPlay / Android Auto browse snapshot now the library stores
  // are hydrated — a cold car wake that rendered an empty skeleton self-corrects.
  // No-op unless a car is currently connected.
  idleStage('refreshHeadlessMediaSnapshot', () => { refreshHeadlessMediaSnapshot(); });
  if (getCancelled()) return;

  // Recover any image-download-queue rows left stalled by a previous
  // session (in 'downloading' or 'error'), then drain whatever's queued.
  // Both stages are no-ops when there's nothing to do.
  await stage('recoverStalledImageDownloads', () => recoverStalledImageDownloads());
  // The image-queue drain is the lowest-priority cache rebuild — push it to an
  // idle window so it never competes with the user settling into the app. It's
  // fully resumable (recoverStalledImageDownloads + the connectivity-restored
  // re-kick), so deferring it is free; worst case it finishes on a later idle.
  runWhenIdle(() => { if (!getCancelled()) void processImageQueue(); });

  // NB: the cold-start home-list refresh is NOT done here — onStartup's
  // immediate chain already fires it (gated) right after rehydrate, so
  // running it again here would just double the network fan-out (#148).
}

/**
 * Minimum gap between auto-refreshes triggered by AppState 'active'
 * transitions. Ten minutes covers the common "background music for
 * a while" and "flick out to read a message" patterns without
 * refreshing on every short context-switch. Track-complete and
 * cold-start refreshes both bypass this threshold (see
 * `albumListsStore.refreshRecentlyPlayed` invocation in
 * `dataSyncService.onScrobbleCompleted`, and `refreshAllIfDue(0)`
 * at boot above).
 */
const FOREGROUND_REFRESH_THRESHOLD_MS = 10 * 60_000;

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

  // Keep the native layer in sync when the user changes theme at runtime.
  // The module-scope IIFE above handles cold start; this handles live changes.
  useEffect(() => {
    try {
      Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    } catch { /* non-critical: native scheme sync failed */ }
  }, [preference]);

  useDownloadKeepAwake();
  useDownloadBackgroundNotification();
  useLibrarySyncKeepAwake();
  useLibrarySyncBackgroundNotification();

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
    // Hold the expensive deferred startup (image/music cache scans, backup,
    // data-sync, image-queue drain) until the animated splash has finished —
    // its synchronous SQLite/FS work otherwise blocks the JS thread and
    // contributes to the splash freeze.
    if (!isLoggedIn || splashVisible) return;
    let cancelled = false;
    void runDeferredStartup(() => cancelled);
    return () => { cancelled = true; };
  }, [isLoggedIn, splashVisible]);

  // --- Cover-art recache resumption on connectivity restoration ---
  // The image-cache refresh-queue worker picks up cover art for
  // downloaded items under the entity-ID model. If the user was offline
  // at first launch, kick the worker as soon as the server becomes
  // reachable. Also covers mid-pass connectivity drops.
  useEffect(() => {
    if (!isLoggedIn) return;
    let prevReachable =
      connectivityStore.getState().isServerReachable
      && connectivityStore.getState().hasConnection;
    const unsub = connectivityStore.subscribe((state) => {
      const reachableNow = state.isServerReachable && state.hasConnection;
      if (reachableNow && !prevReachable) {
        // Drain anything left in the persistent image queue (queued or
        // recovered-from-stalled). No-op when the queue is empty or paused.
        void processImageQueue();
      }
      prevReachable = reachableNow;
    });
    return () => unsub();
  }, [isLoggedIn]);

  // --- Resume the album-detail walk on AppState active transitions ---
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void recoverStalledSync();
        // Resume image-cache draining if a cycle is mid-flight and the
        // user hasn't explicitly paused it. Respects isPaused internally.
        void processImageQueue();
        // Re-sync the home-screen album lists so plays from other
        // clients during backgrounding appear without a manual refresh
        // (#148). 10-minute threshold dedupes rapid foreground flips.
        void albumListsStore.getState().refreshAllIfDue(FOREGROUND_REFRESH_THRESHOLD_MS);
      } else if (next === 'background' || next === 'inactive') {
        // Flush debounced writes so leaving the app persists the latest state
        // (the debounce windows would otherwise be lost if the OS kills the
        // process while backgrounded): the library-store persist writes and
        // the player queue snapshot.
        void flushAllPersistStorages();
        flushPersistedQueue();
      }
    });
    return () => sub.remove();
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

    // If the effect is torn down (logout / fast unmount) before async
    // hydration resolves, skip the deferred startup work.
    let cancelled = false;

    // Subscriptions don't depend on per-row hydration; register them
    // synchronously so cleanup is deterministic regardless of when the
    // async startup chain below settles.
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
        // dataSyncService owns the prefetch fan-out, matching the startup path.
        onOnlineResume();
      } else if (!prev.offlineMode && state.offlineMode) {
        stopMonitoring();
      }
    });

    // Hydrate per-row SQLite-backed stores BEFORE any data-sync flow reads
    // them, THEN run the startup chain. `rehydrateAllStores` is async now
    // (SQLite IO on a background thread + chunked JSON.parse), so we AWAIT it
    // to preserve the ordering invariant: hydration must complete before
    // `onStartup()` fires its deferred full album-detail walk, which checks
    // `albumDetailStore.albums` 1500 ms later. Symptom of getting this order
    // wrong: a "full library resync" banner showing `missing = library.length`
    // on every launch.
    void (async () => {
      await rehydrateAllStores();
      // Also wait for the startup-critical async-persisted kvStorage stores
      // (offlineMode, the library lists, etc.). They hydrate a microtask after
      // store creation; reading them before that resolves would make the
      // resync comparison and offline/auto-offline branch decisions below act
      // on empty defaults.
      await awaitKvHydration();
      if (cancelled) return;
      // Set up the native player eagerly so playback is available immediately.
      // The persisted-queue RESTORE is deferred to after the splash (see the
      // queueRestoreStartedRef effect below) — its heavy RNTP hydration was
      // freezing the splash animation mid-sweep.
      initPlayer();
      initScrobbleService();
      initFailover();
      // (iOS) bring up the streaming proxy for AVPlayer if the active server is
      // a trusted self-signed host. No-op on Android.
      void syncProxyUpstreams();

      const offline = offlineModeStore.getState().offlineMode;

      // Start auto-offline monitoring if enabled
      if (autoOfflineStore.getState().enabled) {
        startAutoOffline();
      }

      if (!offline) {
        startMonitoring();
        // dataSyncService owns the prefetch fan-out (immediate chain +
        // requestIdleCallback + STARTUP_PREFETCH_SETTLE_MS deferred library
        // prefetches).
        onStartup();
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      unsubAutoOffline();
      stopAutoOffline();
      stopMonitoring();
    };
  }, [rehydrated, isLoggedIn]);

  // --- Deferred persisted-queue restore (after the animated splash) ---
  // The native player is set up eagerly above; only the heavy queue RESTORE +
  // RNTP hydration is deferred here — it froze the splash mid-sweep when it ran
  // during boot. Running it once the splash has hidden keeps the animation
  // smooth, and means the restore happens AFTER migrations so the one-time
  // queue-clear migration actually takes effect instead of being restored over.
  const queueRestoreStartedRef = useRef(false);
  useEffect(() => {
    if (!rehydrated || !isLoggedIn || splashVisible || queueRestoreStartedRef.current) {
      return;
    }
    queueRestoreStartedRef.current = true;
    restorePersistedQueueAfterBoot();
  }, [rehydrated, isLoggedIn, splashVisible]);

  // --- Android: background the app instead of killing it at the root ---
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = () => {
      // Intercept back on all root tab screens to prevent react-native-screens
      // from calling canNavigateBack() on a tab fragment (not a ScreenStack),
      // which throws IllegalStateException.
      if (segments[0] === '(tabs)') {
        const tab = (segments as string[])[1];
        if (!tab || tab === 'index') {
          // Already on the home tab — background the app
          moveToBack();
        } else {
          // On another tab — navigate to the home tab first
          router.navigate('/(tabs)');
        }
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, [segments, router]);

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
      {/* No statusBarTranslucent — the app is edge-to-edge, so kbc forces it
          true anyway; passing it explicitly only trips a dev-only warning. */}
      <KeyboardProvider>
      <I18nextProvider i18n={i18n}>
      <ThemeProvider value={navigationTheme}>
      <RootErrorBoundary colors={colors}>
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
          options={{ ...blurHeaderOptions, title: i18n.t('albums'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="album/[id]"
          options={{
            title: '',
            headerBackTitle: i18n.t('back'),
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="artist/[id]"
          options={{
            title: '',
            headerBackTitle: i18n.t('back'),
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="playlist/[id]"
          options={{
            title: '',
            headerBackTitle: i18n.t('back'),
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="image-cache-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('imageCache'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="metadata-cache-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('metadataCache'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="music-cache-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('downloadedMusic'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="download-queue"
          options={{ ...blurHeaderOptions, title: i18n.t('downloads'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="settings-server"
          options={{ ...blurHeaderOptions, title: i18n.t('serverAccount'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="settings-appearance"
          options={{ ...blurHeaderOptions, title: i18n.t('appearanceLayout'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="settings-connectivity"
          options={{ ...blurHeaderOptions, title: i18n.t('connectivity'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="settings-storage"
          options={{ ...blurHeaderOptions, title: i18n.t('storage'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="settings-library-data"
          options={{ ...blurHeaderOptions, title: i18n.t('libraryData'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="player"
          options={{
            title: i18n.t('nowPlaying'),
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
          options={{ ...blurHeaderOptions, title: i18n.t('mbidOverrides'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="scrobble-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('scrobbles'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="scrobble-exclusion-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('scrobbleExclusions'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="share-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('shares'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="bookmarks"
          options={{ ...blurHeaderOptions, title: i18n.t('bookmarks'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="my-listening"
          options={{ ...blurHeaderOptions, title: i18n.t('myListening'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="tuned-in"
          options={{ ...blurHeaderOptions, title: i18n.t('tunedIn'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="radio"
          options={{ ...blurHeaderOptions, title: i18n.t('internetRadio'), headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="radio-browser"
          options={{ ...blurHeaderOptions, title: i18n.t('stationCatalog'), headerBackTitle: i18n.t('internetRadio') }}
        />
        <Stack.Screen
          name="settings-playback"
          options={{ ...blurHeaderOptions, title: i18n.t('soundPlayback'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="file-explorer"
          options={{ ...blurHeaderOptions, title: i18n.t('fileExplorer'), headerBackTitle: i18n.t('settings') }}
        />
        <Stack.Screen
          name="file-viewer"
          options={{ ...blurHeaderOptions, title: '', headerBackTitle: i18n.t('back') }}
        />
        <Stack.Screen
          name="logging"
          options={{ ...blurHeaderOptions, title: i18n.t('logging'), headerBackTitle: i18n.t('back') }}
        />
            </Stack>
          </View>
        }
        panel={showPanel ? <PlayerTabletSplitview /> : null}
        panelPlaceholder={<GradientBackground style={{ flex: 1 }}>{null}</GradientBackground>}
      />

      {/* Full-screen expanded player — covers everything including SplitLayout */}
      {showPanel && (
        <PlayerTabletLandscape expandProgress={expandProgress} />
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

      {/* Global sleep timer sheet driven by sleepTimerStore */}
      <SleepTimerSheet />

      {/* Global audio route / cast picker driven by useRoutePickerStore */}
      <RoutePickerSheet />

      {/* Global bookmark name/rename sheet driven by bookmarkSheetStore */}
      <BookmarkNameSheet />

      {/* Global themed alert host driven by themedAlertStore — decouples
          alert Modal lifecycle from any caller's React subtree so chained
          opens (e.g. after closing MoreOptionsSheet's BottomSheet on
          Android) don't race the previous Modal's native dismiss. */}
      <ThemedAlertHost />

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

      {/* Global error pill. Used by `playerService.fail(...)` to surface
          genuine playback failures (offline + no cached tracks, RNTP
          errors). Lifts itself above the BottomChrome (DownloadBanner +
          mini player) when present so it doesn't stack on top. */}
      <PlaybackToast />


      {/* Onboarding welcome guide shown once after first login */}
      <OnboardingGuide />

      {/* One-time Fire-OS background-playback guidance, shown over the first
          playback (driven by backgroundPlaybackPromptStore). */}
      <BackgroundPlaybackPromptModal />

      {/* Animated splash renders as an overlay on top of the Stack so the
          navigator is always mounted and ready for auth-based navigation. */}
      {splashVisible && (
        <AnimatedSplashScreen onFinish={handleSplashFinish} />
      )}
      </RootErrorBoundary>
      </ThemeProvider>
      </I18nextProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
