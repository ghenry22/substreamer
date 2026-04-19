import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

export interface TrustedCertEntry {
  /** SHA-256 fingerprint of the trusted certificate (colon-separated hex) */
  sha256: string;
  /** Timestamp when the user accepted this certificate (epoch ms) */
  acceptedAt: number;
  /** Certificate validity end date as ISO 8601 string, if known */
  validTo?: string;
}

interface SslCertState {
  /** Map of hostname -> trusted certificate entry */
  trustedCerts: Record<string, TrustedCertEntry>;
  /**
   * Set when the native trust store could not be installed (e.g. broken
   * JSSE provider on a stripped Android OEM ROM). Null when healthy. The
   * value is a short error message suitable for surfacing in a banner.
   */
  installFailed: string | null;
  /** Add or update a trusted certificate for a hostname */
  trustCertificate: (hostname: string, sha256: string, validTo?: string) => void;
  /** Remove a trusted certificate by hostname */
  removeTrustedCertificate: (hostname: string) => void;
  /** Check if a hostname has a trusted certificate */
  isTrusted: (hostname: string) => boolean;
  /** Get the trusted fingerprint for a hostname, or null */
  getTrustedFingerprint: (hostname: string) => string | null;
  /** Record that the native trust store install failed. */
  setInstallFailed: (error: string | null) => void;
  /** Clear any previously recorded install failure. */
  clearInstallFailed: () => void;
}

const PERSIST_KEY = 'substreamer-ssl-certs';

export const sslCertStore = create<SslCertState>()(
  persist(
    (set, get) => ({
      trustedCerts: {},
      installFailed: null,

      trustCertificate: (hostname: string, sha256: string, validTo?: string) =>
        set((state) => ({
          trustedCerts: {
            ...state.trustedCerts,
            [hostname]: {
              sha256: sha256.toUpperCase(),
              acceptedAt: Date.now(),
              ...(validTo ? { validTo } : {}),
            },
          },
        })),

      removeTrustedCertificate: (hostname: string) =>
        set((state) => {
          const { [hostname]: _, ...rest } = state.trustedCerts;
          return { trustedCerts: rest };
        }),

      isTrusted: (hostname: string) => {
        return hostname in get().trustedCerts;
      },

      getTrustedFingerprint: (hostname: string) => {
        return get().trustedCerts[hostname]?.sha256 ?? null;
      },

      setInstallFailed: (error: string | null) => set({ installFailed: error }),
      clearInstallFailed: () => set({ installFailed: null }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => kvStorage),
      // installFailed is transient: a fresh launch should re-evaluate.
      partialize: (state) => ({
        trustedCerts: state.trustedCerts,
      }),
    }
  )
);
