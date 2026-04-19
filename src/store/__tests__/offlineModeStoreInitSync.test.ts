/**
 * Separate test file for the module-level initial sync in offlineModeStore.
 *
 * The store syncs filterBarStore.downloadedOnly at import time when
 * offlineMode is already true (line 47-49). We test this by pre-populating
 * the mock storage before importing the store module.
 */

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

// `persistence/db.ts` imports `expo-sqlite` at module load; stub it so the
// import doesn't hit the native bridge during tests.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

it('syncs downloadedOnly on import when offlineMode is persisted as true', () => {
  // Get the mock storage that all stores will use (via the jest.mock above).
  const { kvStorage } = require('../persistence/__mocks__/kvStorage');

  // Pre-populate so offlineModeStore rehydrates with offlineMode=true.
  kvStorage.setItem(
    'substreamer-offline-mode',
    JSON.stringify({
      state: { offlineMode: true, showInFilterBar: true },
      version: 0,
    }),
  );

  // Import filterBarStore first so we can check its state after.
  const { filterBarStore } = require('../filterBarStore');

  // Importing offlineModeStore triggers rehydration + the initial sync check.
  require('../offlineModeStore');

  expect(filterBarStore.getState().downloadedOnly).toBe(true);
});
