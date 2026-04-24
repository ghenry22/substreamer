jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

// Mock the imageCacheTable module so we can drive what hydrateImageCacheAggregates
// returns per test without needing a real DB. Keep getDb pointing at a stub so
// db.ts's module-load init doesn't crash.
let mockAggregates = {
  totalBytes: 0,
  fileCount: 0,
  imageCount: 0,
  incompleteCount: 0,
};
jest.mock('../persistence/imageCacheTable', () => ({
  hydrateImageCacheAggregates: jest.fn(() => mockAggregates),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

import { kvStorage } from '../persistence/__mocks__/kvStorage';
import {
  getFsKeyMigrationDone,
  getLastReconcileMs,
  imageCacheStore,
  markFsKeyMigrationDone,
  markReconcileRan,
} from '../imageCacheStore';

beforeEach(() => {
  mockAggregates = { totalBytes: 0, fileCount: 0, imageCount: 0, incompleteCount: 0 };
  imageCacheStore.setState({
    totalBytes: 0,
    fileCount: 0,
    imageCount: 0,
    incompleteCount: 0,
    maxConcurrentImageDownloads: 5,
    hasHydrated: false,
  });
  kvStorage.removeItem('substreamer-image-cache-settings');
});

describe('imageCacheStore — hydrateFromDb', () => {
  it('pulls the four aggregates from SQL and marks hasHydrated', () => {
    mockAggregates = { totalBytes: 12000, fileCount: 17, imageCount: 5, incompleteCount: 1 };
    imageCacheStore.getState().hydrateFromDb();
    const state = imageCacheStore.getState();
    expect(state.totalBytes).toBe(12000);
    expect(state.fileCount).toBe(17);
    expect(state.imageCount).toBe(5);
    expect(state.incompleteCount).toBe(1);
    expect(state.hasHydrated).toBe(true);
  });

  it('defaults maxConcurrentImageDownloads=5 when no settings blob is persisted', () => {
    imageCacheStore.getState().hydrateFromDb();
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(5);
  });

  it('loads maxConcurrentImageDownloads from the persisted settings blob', () => {
    kvStorage.setItem(
      'substreamer-image-cache-settings',
      JSON.stringify({ maxConcurrentImageDownloads: 10 }),
    );
    imageCacheStore.getState().hydrateFromDb();
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(10);
  });

  it('ignores invalid persisted settings values', () => {
    kvStorage.setItem(
      'substreamer-image-cache-settings',
      JSON.stringify({ maxConcurrentImageDownloads: 99 }),
    );
    imageCacheStore.getState().hydrateFromDb();
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(5);
  });

  it('falls back to default on unparseable settings blob', () => {
    kvStorage.setItem('substreamer-image-cache-settings', 'not-json{');
    imageCacheStore.getState().hydrateFromDb();
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(5);
  });

  it('is idempotent — a second call re-reads and produces the same state', () => {
    mockAggregates = { totalBytes: 500, fileCount: 4, imageCount: 1, incompleteCount: 0 };
    imageCacheStore.getState().hydrateFromDb();
    imageCacheStore.getState().hydrateFromDb();
    expect(imageCacheStore.getState().totalBytes).toBe(500);
    expect(imageCacheStore.getState().hasHydrated).toBe(true);
  });
});

describe('imageCacheStore — recalculateFromDb', () => {
  it('updates the four aggregates without touching hasHydrated or maxConcurrent', () => {
    imageCacheStore.setState({
      hasHydrated: true,
      maxConcurrentImageDownloads: 10,
    });
    mockAggregates = { totalBytes: 777, fileCount: 3, imageCount: 1, incompleteCount: 1 };
    imageCacheStore.getState().recalculateFromDb();
    const state = imageCacheStore.getState();
    expect(state.totalBytes).toBe(777);
    expect(state.fileCount).toBe(3);
    expect(state.imageCount).toBe(1);
    expect(state.incompleteCount).toBe(1);
    expect(state.hasHydrated).toBe(true);
    expect(state.maxConcurrentImageDownloads).toBe(10);
  });
});

describe('imageCacheStore — reset', () => {
  it('zeroes the aggregates', () => {
    imageCacheStore.setState({
      totalBytes: 5000,
      fileCount: 10,
      imageCount: 3,
      incompleteCount: 1,
    });
    imageCacheStore.getState().reset();
    const state = imageCacheStore.getState();
    expect(state.totalBytes).toBe(0);
    expect(state.fileCount).toBe(0);
    expect(state.imageCount).toBe(0);
    expect(state.incompleteCount).toBe(0);
  });
});

describe('imageCacheStore — setMaxConcurrentImageDownloads', () => {
  it('updates the setting and persists it to the KV blob', () => {
    imageCacheStore.getState().setMaxConcurrentImageDownloads(10);
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(10);
    const persisted = kvStorage.getItem('substreamer-image-cache-settings');
    expect(persisted).toBe(JSON.stringify({ maxConcurrentImageDownloads: 10 }));

    imageCacheStore.getState().setMaxConcurrentImageDownloads(1);
    expect(imageCacheStore.getState().maxConcurrentImageDownloads).toBe(1);
    expect(kvStorage.getItem('substreamer-image-cache-settings')).toBe(
      JSON.stringify({ maxConcurrentImageDownloads: 1 }),
    );
  });

  it('preserves lastReconcileMs when the concurrency limit is changed', () => {
    markReconcileRan(1700000000000);
    imageCacheStore.getState().setMaxConcurrentImageDownloads(3);

    expect(getLastReconcileMs()).toBe(1700000000000);
    const persisted = JSON.parse(
      kvStorage.getItem('substreamer-image-cache-settings') as string,
    );
    expect(persisted).toEqual({
      maxConcurrentImageDownloads: 3,
      lastReconcileMs: 1700000000000,
    });
  });
});

describe('imageCacheStore — reconcile timestamp helpers', () => {
  it('returns undefined when no reconcile has ever run', () => {
    expect(getLastReconcileMs()).toBeUndefined();
  });

  it('persists and reads back a reconcile timestamp', () => {
    markReconcileRan(1700000000000);
    expect(getLastReconcileMs()).toBe(1700000000000);
  });

  it('updates the timestamp on subsequent calls', () => {
    markReconcileRan(1700000000000);
    markReconcileRan(1700000123456);
    expect(getLastReconcileMs()).toBe(1700000123456);
  });

  it('preserves an existing maxConcurrentImageDownloads setting', () => {
    imageCacheStore.getState().setMaxConcurrentImageDownloads(10);
    markReconcileRan(1700000000000);

    const persisted = JSON.parse(
      kvStorage.getItem('substreamer-image-cache-settings') as string,
    );
    expect(persisted).toEqual({
      maxConcurrentImageDownloads: 10,
      lastReconcileMs: 1700000000000,
    });
  });

  it('ignores malformed timestamp values in the persisted blob', () => {
    kvStorage.setItem(
      'substreamer-image-cache-settings',
      JSON.stringify({ maxConcurrentImageDownloads: 5, lastReconcileMs: 'not-a-number' }),
    );
    expect(getLastReconcileMs()).toBeUndefined();
  });

  it('ignores non-positive timestamps', () => {
    kvStorage.setItem(
      'substreamer-image-cache-settings',
      JSON.stringify({ maxConcurrentImageDownloads: 5, lastReconcileMs: 0 }),
    );
    expect(getLastReconcileMs()).toBeUndefined();
  });
});

describe('imageCacheStore — FS-hostile-key migration flag', () => {
  it('returns false when the flag has never been set', () => {
    expect(getFsKeyMigrationDone()).toBe(false);
  });

  it('persists and reads back the done flag', () => {
    markFsKeyMigrationDone();
    expect(getFsKeyMigrationDone()).toBe(true);
  });

  it('preserves maxConcurrentImageDownloads and lastReconcileMs when setting the flag', () => {
    imageCacheStore.getState().setMaxConcurrentImageDownloads(10);
    markReconcileRan(1700000000000);
    markFsKeyMigrationDone();

    const persisted = JSON.parse(
      kvStorage.getItem('substreamer-image-cache-settings') as string,
    );
    expect(persisted).toEqual({
      maxConcurrentImageDownloads: 10,
      lastReconcileMs: 1700000000000,
      fsKeyMigrationV1Done: true,
    });
  });

  it('ignores a non-boolean-true value in the persisted blob', () => {
    kvStorage.setItem(
      'substreamer-image-cache-settings',
      JSON.stringify({ maxConcurrentImageDownloads: 5, fsKeyMigrationV1Done: 'yes' }),
    );
    expect(getFsKeyMigrationDone()).toBe(false);
  });
});
