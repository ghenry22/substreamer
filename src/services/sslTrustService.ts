import {
  initTrustStore,
  trustCertificate as nativeTrustCertificate,
  removeTrustedCertificate as nativeRemoveTrustedCertificate,
} from '../../modules/expo-ssl-trust/src';
import { sslCertStore } from '../store/sslCertStore';

let initialized = false;

/**
 * Initialise the SSL trust store. Should be called early in app startup
 * (at module scope in _layout.tsx) before any network requests are made.
 *
 * Loads persisted trusted certificates from the Zustand store and syncs
 * them to the native trust store so the custom TrustManager (Android) /
 * URLProtocol (iOS) is configured before any connections happen.
 */
export function initSslTrustStore(): void {
  if (initialized) return;
  initialized = true;

  // Initialize the native trust store (installs custom TrustManager / URLProtocol)
  initTrustStore().catch((err) => {
    console.warn('[sslTrustService] Failed to init native trust store:', err);
  });

  // Sync any persisted trusted certs from Zustand -> native
  // Use a small delay to ensure the native module is ready
  setTimeout(() => {
    syncToNative();
  }, 100);
}

/**
 * Sync all trusted certificates from the Zustand store to the native module.
 * Called on startup and whenever the Zustand store changes.
 */
async function syncToNative(): Promise<void> {
  const { trustedCerts } = sslCertStore.getState();
  for (const [hostname, entry] of Object.entries(trustedCerts)) {
    try {
      await nativeTrustCertificate(hostname, entry.sha256);
    } catch (err) {
      console.warn(`[sslTrustService] Failed to sync cert for ${hostname}:`, err);
    }
  }
}

/**
 * Trust a certificate for a hostname, persisting in both Zustand and native stores.
 */
export async function trustCertificateForHost(
  hostname: string,
  sha256Fingerprint: string,
  validTo?: string,
): Promise<void> {
  // Persist in Zustand store (SQLite)
  sslCertStore.getState().trustCertificate(hostname, sha256Fingerprint, validTo);
  // Sync to native store
  await nativeTrustCertificate(hostname, sha256Fingerprint);
}

/**
 * Remove trust for a hostname from both Zustand and native stores.
 */
export async function removeTrustForHost(hostname: string): Promise<void> {
  sslCertStore.getState().removeTrustedCertificate(hostname);
  await nativeRemoveTrustedCertificate(hostname);
}
