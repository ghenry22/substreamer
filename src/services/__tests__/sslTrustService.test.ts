const mockInitTrustStore = jest.fn().mockResolvedValue(undefined);
const mockNativeTrustCertificate = jest.fn().mockResolvedValue(undefined);
const mockNativeRemoveTrustedCertificate = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../modules/expo-ssl-trust/src', () => ({
  initTrustStore: mockInitTrustStore,
  trustCertificate: mockNativeTrustCertificate,
  removeTrustedCertificate: mockNativeRemoveTrustedCertificate,
}));

const mockTrustCertificateAction = jest.fn();
const mockRemoveTrustedCertificateAction = jest.fn();
let mockTrustedCerts: Record<string, { sha256: string; acceptedAt: number }> = {};

jest.mock('../../store/sslCertStore', () => ({
  sslCertStore: {
    getState: jest.fn(() => ({
      trustedCerts: mockTrustedCerts,
      trustCertificate: mockTrustCertificateAction,
      removeTrustedCertificate: mockRemoveTrustedCertificateAction,
    })),
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockInitTrustStore.mockClear().mockResolvedValue(undefined);
  mockNativeTrustCertificate.mockClear().mockResolvedValue(undefined);
  mockNativeRemoveTrustedCertificate.mockClear().mockResolvedValue(undefined);
  mockTrustCertificateAction.mockClear();
  mockRemoveTrustedCertificateAction.mockClear();
  mockTrustedCerts = {};
});

afterEach(() => {
  jest.useRealTimers();
});

function loadFreshService() {
  jest.resetModules();
  return require('../sslTrustService') as typeof import('../sslTrustService');
}

describe('initSslTrustStore', () => {
  it('calls native initTrustStore', () => {
    const { initSslTrustStore } = loadFreshService();
    initSslTrustStore();
    expect(mockInitTrustStore).toHaveBeenCalledTimes(1);
  });

  it('syncs persisted certs to native after a short delay', async () => {
    mockTrustedCerts = {
      'example.com': { sha256: 'AA:BB', acceptedAt: 1000 },
    };

    const { initSslTrustStore } = loadFreshService();
    initSslTrustStore();

    expect(mockNativeTrustCertificate).not.toHaveBeenCalled();

    // Advance past the 100ms setTimeout
    jest.advanceTimersByTime(150);
    // Allow the async syncToNative() to process
    await jest.runAllTimersAsync();
    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNativeTrustCertificate).toHaveBeenCalledWith('example.com', 'AA:BB');
  });

  it('is idempotent on repeated calls', () => {
    const { initSslTrustStore } = loadFreshService();
    initSslTrustStore();
    initSslTrustStore();
    expect(mockInitTrustStore).toHaveBeenCalledTimes(1);
  });

  it('handles native init failure gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockInitTrustStore.mockRejectedValueOnce(new Error('native fail'));
    const { initSslTrustStore } = loadFreshService();
    expect(() => initSslTrustStore()).not.toThrow();

    // Flush the rejected promise so the .catch() handler runs
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to init native trust store'),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it('handles sync failure for individual certs gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockTrustedCerts = {
      'good.com': { sha256: 'AA:BB', acceptedAt: 1000 },
      'bad.com': { sha256: 'CC:DD', acceptedAt: 2000 },
    };
    mockNativeTrustCertificate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('sync fail'));

    const { initSslTrustStore } = loadFreshService();
    initSslTrustStore();

    jest.advanceTimersByTime(150);
    await jest.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNativeTrustCertificate).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to sync cert'),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});

describe('trustCertificateForHost', () => {
  it('persists in Zustand store and syncs to native', async () => {
    const { trustCertificateForHost, initSslTrustStore } = loadFreshService();
    initSslTrustStore();

    await trustCertificateForHost('music.example.com', 'FF:EE:DD');

    expect(mockTrustCertificateAction).toHaveBeenCalledWith('music.example.com', 'FF:EE:DD', undefined);
    expect(mockNativeTrustCertificate).toHaveBeenCalledWith('music.example.com', 'FF:EE:DD');
  });
});

describe('removeTrustForHost', () => {
  it('removes from Zustand store and native', async () => {
    const { removeTrustForHost, initSslTrustStore } = loadFreshService();
    initSslTrustStore();

    await removeTrustForHost('old.example.com');

    expect(mockRemoveTrustedCertificateAction).toHaveBeenCalledWith('old.example.com');
    expect(mockNativeRemoveTrustedCertificate).toHaveBeenCalledWith('old.example.com');
  });
});
