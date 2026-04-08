import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { AppState, Linking, Platform, type NativeEventSubscription } from 'react-native';

import { autoOfflineStore } from '../store/autoOfflineStore';
import { offlineModeStore } from '../store/offlineModeStore';

let unsubscribeNetInfo: (() => void) | null = null;
let unsubscribeStore: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

function handleNetworkChange(state: NetInfoState): void {
  const { mode, homeSSIDs } = autoOfflineStore.getState();

  if (mode === 'wifi-only') {
    const isOnline = state.type === 'wifi' || state.type === 'ethernet';
    offlineModeStore.getState().setOfflineMode(!isOnline);
    return;
  }

  // home-wifi mode — requires at least one configured SSID to function
  if (homeSSIDs.length === 0) {
    console.warn('[AutoOffline] Home WiFi mode active but no SSIDs configured. Skipping toggle.');
    return;
  }

  if (state.type !== 'wifi') {
    offlineModeStore.getState().setOfflineMode(true);
    return;
  }

  const ssid = (state.details as { ssid?: string | null })?.ssid ?? null;
  if (ssid == null) {
    console.warn('[AutoOffline] SSID is null — location permission may be denied or unavailable (simulators cannot read SSIDs). Skipping toggle.');
    return;
  }

  const isHome = homeSSIDs.includes(ssid);
  console.log(`[AutoOffline] WiFi SSID "${ssid}" ${isHome ? 'matches' : 'does not match'} home networks → ${isHome ? 'online' : 'offline'}`);
  offlineModeStore.getState().setOfflineMode(!isHome);
}

function subscribe(): void {
  if (unsubscribeNetInfo) return;

  unsubscribeNetInfo = NetInfo.addEventListener(handleNetworkChange);

  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      NetInfo.refresh().then(handleNetworkChange);
    }
  });
}

function unsubscribe(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

export function startAutoOffline(): void {
  if (!autoOfflineStore.getState().enabled) return;
  subscribe();

  // Fresh evaluation on cold start. The first NetInfo result on Android
  // immediately after launch can be a false negative (type === 'unknown'
  // or 'none' even when the device is on wifi) — react-native-netinfo#781.
  // If the first result looks stale, retry once after 500ms; the underlying
  // ConnectivityManager has had time to populate the real state by then.
  NetInfo.refresh().then((state) => {
    if (state.type === 'unknown' || state.type === 'none') {
      setTimeout(() => {
        NetInfo.refresh().then(handleNetworkChange);
      }, 500);
    } else {
      handleNetworkChange(state);
    }
  });

  // Re-subscribe when store settings change
  unsubscribeStore = autoOfflineStore.subscribe((state, prev) => {
    if (!state.enabled) {
      unsubscribe();
      return;
    }

    const modeChanged = state.mode !== prev.mode;
    const ssidsChanged = state.homeSSIDs !== prev.homeSSIDs;
    const enabledChanged = state.enabled !== prev.enabled;

    if (modeChanged || enabledChanged) {
      // Restart with new config
      unsubscribe();
      subscribe();
    } else if (ssidsChanged && state.mode === 'home-wifi') {
      // Re-evaluate with current network state
      NetInfo.fetch().then(handleNetworkChange);
    }
  });
}

export function stopAutoOffline(): void {
  unsubscribe();
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
}

export async function getCurrentSSID(): Promise<string | null> {
  try {
    const state = await NetInfo.refresh();
    if (state.type !== 'wifi') return null;
    return (state.details as { ssid?: string | null })?.ssid ?? null;
  } catch {
    return null;
  }
}

const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 3;

export async function getCurrentSSIDWithRetry(): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ssid = await getCurrentSSID();
    if (ssid != null) return ssid;

    // If not on wifi, no point retrying
    try {
      const state = await NetInfo.refresh();
      if (state.type !== 'wifi') return null;
    } catch {
      return null;
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === 'granted';
    autoOfflineStore.getState().setLocationPermissionGranted(granted);
    return granted;
  } catch {
    return false;
  }
}

export async function checkLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    const granted = status === 'granted';
    autoOfflineStore.getState().setLocationPermissionGranted(granted);
    return granted;
  } catch {
    return false;
  }
}

export function openAppSettings(): void {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  } else {
    Linking.openSettings();
  }
}
