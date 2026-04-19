jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { sslCertStore } from '../sslCertStore';

beforeEach(() => {
  sslCertStore.setState({ trustedCerts: {}, installFailed: null });
});

describe('sslCertStore', () => {
  it('trustCertificate adds entry with uppercased fingerprint', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    const entry = sslCertStore.getState().trustedCerts['example.com'];
    expect(entry.sha256).toBe('AA:BB:CC');
    expect(entry.acceptedAt).toBeGreaterThan(0);
  });

  it('trustCertificate stores validTo when provided', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc', '2027-01-01T00:00:00Z');
    const entry = sslCertStore.getState().trustedCerts['example.com'];
    expect(entry.validTo).toBe('2027-01-01T00:00:00Z');
  });

  it('trustCertificate omits validTo when not provided', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    const entry = sslCertStore.getState().trustedCerts['example.com'];
    expect(entry.validTo).toBeUndefined();
  });

  it('trustCertificate overwrites existing entry', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    sslCertStore.getState().trustCertificate('example.com', 'dd:ee:ff');
    expect(sslCertStore.getState().trustedCerts['example.com'].sha256).toBe('DD:EE:FF');
  });

  it('removeTrustedCertificate removes entry', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    sslCertStore.getState().trustCertificate('other.com', 'dd:ee:ff');
    sslCertStore.getState().removeTrustedCertificate('example.com');
    expect(sslCertStore.getState().trustedCerts['example.com']).toBeUndefined();
    expect(sslCertStore.getState().trustedCerts['other.com']).toBeDefined();
  });

  it('removeTrustedCertificate is safe for non-existing host', () => {
    sslCertStore.getState().removeTrustedCertificate('nonexistent.com');
    expect(sslCertStore.getState().trustedCerts).toEqual({});
  });

  it('isTrusted returns true for trusted host', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    expect(sslCertStore.getState().isTrusted('example.com')).toBe(true);
  });

  it('isTrusted returns false for unknown host', () => {
    expect(sslCertStore.getState().isTrusted('unknown.com')).toBe(false);
  });

  it('getTrustedFingerprint returns fingerprint for trusted host', () => {
    sslCertStore.getState().trustCertificate('example.com', 'aa:bb:cc');
    expect(sslCertStore.getState().getTrustedFingerprint('example.com')).toBe('AA:BB:CC');
  });

  it('getTrustedFingerprint returns null for unknown host', () => {
    expect(sslCertStore.getState().getTrustedFingerprint('unknown.com')).toBeNull();
  });

  describe('installFailed state', () => {
    it('starts as null', () => {
      expect(sslCertStore.getState().installFailed).toBeNull();
    });

    it('setInstallFailed records an error message', () => {
      sslCertStore.getState().setInstallFailed('JSSE provider broken');
      expect(sslCertStore.getState().installFailed).toBe('JSSE provider broken');
    });

    it('setInstallFailed accepts null to clear', () => {
      sslCertStore.getState().setInstallFailed('something');
      sslCertStore.getState().setInstallFailed(null);
      expect(sslCertStore.getState().installFailed).toBeNull();
    });

    it('clearInstallFailed resets to null', () => {
      sslCertStore.getState().setInstallFailed('something');
      sslCertStore.getState().clearInstallFailed();
      expect(sslCertStore.getState().installFailed).toBeNull();
    });
  });
});
