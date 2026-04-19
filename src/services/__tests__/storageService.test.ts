import { storageLimitStore } from '../../store/storageLimitStore';
import {
  checkStorageLimit,
  getEffectiveBudget,
  getStorageBreakdown,
} from '../storageService';

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
jest.mock('expo-file-system', () => ({
  Paths: {
    availableDiskSpace: 10 * 1024 ** 3,
    totalDiskSpace: 64 * 1024 ** 3,
  },
}));

beforeEach(() => {
  storageLimitStore.setState({
    limitMode: 'none',
    maxCacheSizeGB: 0,
    isStorageFull: false,
  });
  const { imageCacheStore } = require('../../store/imageCacheStore');
  const { musicCacheStore } = require('../../store/musicCacheStore');
  imageCacheStore.setState({ totalBytes: 0 });
  musicCacheStore.setState({ totalBytes: 0 });
});

describe('getEffectiveBudget', () => {
  it('returns Infinity when unlimited', () => {
    expect(getEffectiveBudget()).toBe(Infinity);
  });

  it('returns fixed bytes when limitMode is fixed', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 5 });
    expect(getEffectiveBudget()).toBe(5 * 1024 ** 3);
  });

  it('returns Infinity when limitMode is fixed but maxCacheSizeGB is 0', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 0 });
    expect(getEffectiveBudget()).toBe(Infinity);
  });
});

describe('checkStorageLimit', () => {
  it('sets isStorageFull false and returns false when unlimited', () => {
    const result = checkStorageLimit();
    expect(result).toBe(false);
    expect(storageLimitStore.getState().isStorageFull).toBe(false);
  });

  it('sets isStorageFull true and returns true when over budget', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 1 });
    const { imageCacheStore } = require('../../store/imageCacheStore');
    const { musicCacheStore } = require('../../store/musicCacheStore');
    imageCacheStore.setState({ totalBytes: 0.5 * 1024 ** 3 });
    musicCacheStore.setState({ totalBytes: 0.6 * 1024 ** 3 });
    const result = checkStorageLimit();
    expect(result).toBe(true);
    expect(storageLimitStore.getState().isStorageFull).toBe(true);
  });

  it('returns true when exactly at budget boundary', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 1 });
    const { musicCacheStore } = require('../../store/musicCacheStore');
    musicCacheStore.setState({ totalBytes: 1 * 1024 ** 3 });
    const result = checkStorageLimit();
    expect(result).toBe(true);
    expect(storageLimitStore.getState().isStorageFull).toBe(true);
  });

  it('returns false when under budget', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 2 });
    const { musicCacheStore } = require('../../store/musicCacheStore');
    musicCacheStore.setState({ totalBytes: 0.5 * 1024 ** 3 });
    const result = checkStorageLimit();
    expect(result).toBe(false);
    expect(storageLimitStore.getState().isStorageFull).toBe(false);
  });
});

describe('getStorageBreakdown', () => {
  it('returns breakdown with image and music bytes', () => {
    const { imageCacheStore } = require('../../store/imageCacheStore');
    const { musicCacheStore } = require('../../store/musicCacheStore');
    imageCacheStore.setState({ totalBytes: 1000 });
    musicCacheStore.setState({ totalBytes: 2000 });
    const breakdown = getStorageBreakdown();
    expect(breakdown.imageBytes).toBe(1000);
    expect(breakdown.musicBytes).toBe(2000);
  });

  it('includes budgetBytes and disk space in breakdown', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 5 });
    const breakdown = getStorageBreakdown();
    expect(breakdown.budgetBytes).toBe(5 * 1024 ** 3);
    expect(breakdown.freeDiskBytes).toBe(10 * 1024 ** 3);
    expect(breakdown.totalDiskBytes).toBe(64 * 1024 ** 3);
  });

  it('computes availableInBudget for finite budget', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 2 });
    const { musicCacheStore } = require('../../store/musicCacheStore');
    musicCacheStore.setState({ totalBytes: 1 * 1024 ** 3 });
    const breakdown = getStorageBreakdown();
    expect(breakdown.availableInBudget).toBe(1 * 1024 ** 3);
  });

  it('returns freeDiskBytes as availableInBudget when unlimited', () => {
    const breakdown = getStorageBreakdown();
    expect(breakdown.budgetBytes).toBe(Infinity);
    expect(breakdown.availableInBudget).toBe(10 * 1024 ** 3);
  });

  it('clamps availableInBudget to 0 when over budget', () => {
    storageLimitStore.setState({ limitMode: 'fixed', maxCacheSizeGB: 1 });
    const { musicCacheStore } = require('../../store/musicCacheStore');
    musicCacheStore.setState({ totalBytes: 2 * 1024 ** 3 });
    const breakdown = getStorageBreakdown();
    expect(breakdown.availableInBudget).toBe(0);
  });
});
