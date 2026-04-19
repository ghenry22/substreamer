import { storageLimitStore } from '../storageLimitStore';

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

beforeEach(() => {
  storageLimitStore.setState({
    limitMode: 'none',
    maxCacheSizeGB: 0,
    isStorageFull: false,
  });
});

describe('storageLimitStore', () => {
  it('setLimitMode updates the mode', () => {
    storageLimitStore.getState().setLimitMode('fixed');
    expect(storageLimitStore.getState().limitMode).toBe('fixed');
    storageLimitStore.getState().setLimitMode('none');
    expect(storageLimitStore.getState().limitMode).toBe('none');
  });

  it('setMaxCacheSizeGB updates the limit', () => {
    storageLimitStore.getState().setMaxCacheSizeGB(10);
    expect(storageLimitStore.getState().maxCacheSizeGB).toBe(10);
    storageLimitStore.getState().setMaxCacheSizeGB(0);
    expect(storageLimitStore.getState().maxCacheSizeGB).toBe(0);
  });

  it('setStorageFull updates the flag', () => {
    storageLimitStore.getState().setStorageFull(true);
    expect(storageLimitStore.getState().isStorageFull).toBe(true);
    storageLimitStore.getState().setStorageFull(false);
    expect(storageLimitStore.getState().isStorageFull).toBe(false);
  });
});
