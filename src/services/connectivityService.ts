import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type NativeEventSubscription } from 'react-native';

import { connectivityStore } from '../store/connectivityStore';
import { getApiUnchecked } from './subsonicService';

const PING_INTERVAL_REACHABLE_MS = 10_000;
const PING_INTERVAL_UNREACHABLE_MS = 5_000;
const PING_TIMEOUT_MS = 5_000;
const RECONNECTED_DISPLAY_MS = 2_500;

let unsubscribeNetInfo: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let pingTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectedTimer: ReturnType<typeof setTimeout> | null = null;
let initialCheck = true;
let pingInFlight = false;

function clearPingTimer(): void {
  if (pingTimer != null) {
    clearTimeout(pingTimer);
    pingTimer = null;
  }
}

function clearReconnectedTimer(): void {
  if (reconnectedTimer != null) {
    clearTimeout(reconnectedTimer);
    reconnectedTimer = null;
  }
}

function schedulePing(): void {
  clearPingTimer();
  const { isServerReachable } = connectivityStore.getState();
  const interval = isServerReachable
    ? PING_INTERVAL_REACHABLE_MS
    : PING_INTERVAL_UNREACHABLE_MS;
  pingTimer = setTimeout(() => {
    pingServer();
  }, interval);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ping timeout')), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function pingServer(): Promise<void> {
  if (pingInFlight) return;

  const api = getApiUnchecked();
  if (!api) {
    schedulePing();
    return;
  }

  pingInFlight = true;
  try {
    const response = await withTimeout(api.ping(), PING_TIMEOUT_MS);
    handleServerResult(response.status === 'ok');
  } catch {
    handleServerResult(false);
  } finally {
    pingInFlight = false;
  }
}

function handleServerResult(reachable: boolean): void {
  const store = connectivityStore.getState();
  const wasReachable = store.isServerReachable;

  store.setServerReachable(reachable);

  if (reachable) {
    store.setInternetReachable(true);
  }

  if (reachable && !wasReachable && !initialCheck) {
    clearReconnectedTimer();
    store.setBannerState('reconnected');
    reconnectedTimer = setTimeout(() => {
      connectivityStore.getState().setBannerState('hidden');
    }, RECONNECTED_DISPLAY_MS);
  } else if (!reachable) {
    clearReconnectedTimer();
    store.setBannerState('unreachable');
  }

  initialCheck = false;
  schedulePing();
}

function handleNetInfoChange(state: NetInfoState): void {
  const reachable = state.isInternetReachable ?? true;
  connectivityStore.getState().setInternetReachable(reachable);

  // NetInfo change is a hint — trigger an immediate ping for fast response.
  // The ping result is the ground truth for server reachability.
  if (!pingInFlight) {
    clearPingTimer();
    pingServer();
  }
}

export function startMonitoring(): void {
  if (unsubscribeNetInfo) return;

  initialCheck = true;
  pingInFlight = false;

  unsubscribeNetInfo = NetInfo.addEventListener(handleNetInfoChange);

  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      clearPingTimer();
      pingServer();
    }
  });
}

export function stopMonitoring(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  clearPingTimer();
  clearReconnectedTimer();

  const store = connectivityStore.getState();
  store.setInternetReachable(true);
  store.setServerReachable(true);
  store.setBannerState('hidden');
  initialCheck = true;
  pingInFlight = false;
}
