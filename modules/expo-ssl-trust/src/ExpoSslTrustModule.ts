import { requireNativeModule } from 'expo-modules-core';

import { type CertificateInfo, type TrustedCert } from './ExpoSslTrust';

interface ExpoSslTrustNative {
  initTrustStore(): Promise<void>;
  getCertificateInfo(url: string): Promise<CertificateInfo>;
  trustCertificate(hostname: string, sha256Fingerprint: string): Promise<void>;
  removeTrustedCertificate(hostname: string): Promise<void>;
  getTrustedCertificates(): Promise<TrustedCert[]>;
  isCertificateTrusted(hostname: string): Promise<boolean>;
}

// Load the native module from JSI. If the native module is not available
// (e.g. during development before a native rebuild), provide a stub that
// logs warnings instead of crashing the app.
let module: ExpoSslTrustNative;

try {
  module = requireNativeModule<ExpoSslTrustNative>('ExpoSslTrust');
} catch {
  console.warn(
    '[expo-ssl-trust] Native module not found. ' +
      'Run `npx expo run:ios` or `npx expo run:android` to rebuild with the native module.'
  );

  // Provide a no-op stub so the JS side doesn't crash
  const noop = () => Promise.resolve(null);
  module = {
    initTrustStore: noop,
    getCertificateInfo: () =>
      Promise.reject(new Error('expo-ssl-trust native module not available. Rebuild the app.')),
    trustCertificate: noop,
    removeTrustedCertificate: noop,
    getTrustedCertificates: () => Promise.resolve([]),
    isCertificateTrusted: () => Promise.resolve(false),
  } as any;
}

export default module;
