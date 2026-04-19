jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { scanStatusStore } from '../scanStatusStore';

beforeEach(() => {
  scanStatusStore.setState({
    scanning: false,
    count: 0,
    lastScan: null,
    folderCount: null,
    loading: false,
    error: null,
  });
});

describe('scanStatusStore', () => {
  it('setScanStatus updates all scan fields and clears error', () => {
    scanStatusStore.setState({ error: 'old error' });
    scanStatusStore.getState().setScanStatus({
      scanning: true,
      count: 42,
      lastScan: 1000,
      folderCount: 5,
    });
    const state = scanStatusStore.getState();
    expect(state.scanning).toBe(true);
    expect(state.count).toBe(42);
    expect(state.lastScan).toBe(1000);
    expect(state.folderCount).toBe(5);
    expect(state.error).toBeNull();
  });

  it('setLoading updates loading', () => {
    scanStatusStore.getState().setLoading(true);
    expect(scanStatusStore.getState().loading).toBe(true);
  });

  it('setError sets error and clears loading', () => {
    scanStatusStore.setState({ loading: true });
    scanStatusStore.getState().setError('Scan failed');
    const state = scanStatusStore.getState();
    expect(state.error).toBe('Scan failed');
    expect(state.loading).toBe(false);
  });

  it('setError with null clears error', () => {
    scanStatusStore.setState({ error: 'old' });
    scanStatusStore.getState().setError(null);
    expect(scanStatusStore.getState().error).toBeNull();
  });

  it('clearScanStatus resets all fields', () => {
    scanStatusStore.getState().setScanStatus({
      scanning: true,
      count: 42,
      lastScan: 1000,
      folderCount: 5,
    });
    scanStatusStore.getState().clearScanStatus();
    const state = scanStatusStore.getState();
    expect(state.scanning).toBe(false);
    expect(state.count).toBe(0);
    expect(state.lastScan).toBeNull();
    expect(state.folderCount).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });
});
