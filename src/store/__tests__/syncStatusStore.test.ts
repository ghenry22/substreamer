import { syncStatusStore } from '../syncStatusStore';

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

function resetStore() {
  syncStatusStore.setState({
    detailSyncPhase: 'idle',
    detailSyncTotal: 0,
    detailSyncCompleted: 0,
    bannerDismissedAt: null,
    lastChangeDetectionAt: null,
    lastKnownServerSongCount: null,
    lastKnownServerScanTime: null,
    lastKnownNewestAlbumId: null,
    lastKnownNewestAlbumCreated: null,
    generation: 0,
    inFlight: new Map(),
  });
}

beforeEach(() => {
  resetStore();
});

describe('syncStatusStore', () => {
  describe('detail sync phase', () => {
    it('setDetailSyncPhase updates the phase', () => {
      syncStatusStore.getState().setDetailSyncPhase('syncing');
      expect(syncStatusStore.getState().detailSyncPhase).toBe('syncing');
    });

    it('setDetailSyncPhase("idle") clears bannerDismissedAt', () => {
      syncStatusStore.setState({ bannerDismissedAt: 123 });
      syncStatusStore.getState().setDetailSyncPhase('idle');
      expect(syncStatusStore.getState().bannerDismissedAt).toBe(null);
    });

    it('non-idle phase does not clear bannerDismissedAt', () => {
      syncStatusStore.setState({ bannerDismissedAt: 123 });
      syncStatusStore.getState().setDetailSyncPhase('paused-offline');
      expect(syncStatusStore.getState().bannerDismissedAt).toBe(123);
    });
  });

  describe('total / completed', () => {
    it('setDetailSyncTotal stores the total and resets completed', () => {
      syncStatusStore.setState({ detailSyncCompleted: 42 });
      syncStatusStore.getState().setDetailSyncTotal(1000);
      expect(syncStatusStore.getState().detailSyncTotal).toBe(1000);
      expect(syncStatusStore.getState().detailSyncCompleted).toBe(0);
    });

    it('incrementDetailSyncCompleted bumps by one', () => {
      expect(syncStatusStore.getState().detailSyncCompleted).toBe(0);
      syncStatusStore.getState().incrementDetailSyncCompleted();
      expect(syncStatusStore.getState().detailSyncCompleted).toBe(1);
      syncStatusStore.getState().incrementDetailSyncCompleted();
      expect(syncStatusStore.getState().detailSyncCompleted).toBe(2);
    });
  });

  describe('last-known markers', () => {
    it('setLastKnownMarkers merges a partial update', () => {
      syncStatusStore.getState().setLastKnownMarkers({
        lastChangeDetectionAt: 999,
        lastKnownServerSongCount: 1234,
      });
      const s = syncStatusStore.getState();
      expect(s.lastChangeDetectionAt).toBe(999);
      expect(s.lastKnownServerSongCount).toBe(1234);
      expect(s.lastKnownServerScanTime).toBe(null);
    });

    it('successive setLastKnownMarkers preserve prior fields', () => {
      syncStatusStore.getState().setLastKnownMarkers({ lastKnownServerSongCount: 1 });
      syncStatusStore.getState().setLastKnownMarkers({ lastKnownNewestAlbumId: 'abc' });
      const s = syncStatusStore.getState();
      expect(s.lastKnownServerSongCount).toBe(1);
      expect(s.lastKnownNewestAlbumId).toBe('abc');
    });
  });

  describe('banner dismissal', () => {
    it('setBannerDismissedAt stores the timestamp', () => {
      syncStatusStore.getState().setBannerDismissedAt(999);
      expect(syncStatusStore.getState().bannerDismissedAt).toBe(999);
    });
  });

  describe('reset', () => {
    it('resetDetailSync clears only the sync-progress fields', () => {
      syncStatusStore.setState({
        detailSyncPhase: 'syncing',
        detailSyncTotal: 500,
        bannerDismissedAt: 42,
        lastKnownServerSongCount: 999,
      });
      syncStatusStore.getState().resetDetailSync();
      const s = syncStatusStore.getState();
      expect(s.detailSyncPhase).toBe('idle');
      expect(s.detailSyncTotal).toBe(0);
      expect(s.bannerDismissedAt).toBe(null);
      // Last-known markers preserved (they have separate lifecycle).
      expect(s.lastKnownServerSongCount).toBe(999);
    });
  });

  describe('generation counter', () => {
    it('bumpGeneration increments by one', () => {
      expect(syncStatusStore.getState().generation).toBe(0);
      syncStatusStore.getState().bumpGeneration();
      expect(syncStatusStore.getState().generation).toBe(1);
      syncStatusStore.getState().bumpGeneration();
      expect(syncStatusStore.getState().generation).toBe(2);
    });
  });

  describe('inFlight map', () => {
    it('setInFlight / getInFlight round-trip', () => {
      const promise = Promise.resolve();
      syncStatusStore.getState().setInFlight('albums', promise);
      expect(syncStatusStore.getState().getInFlight('albums')).toBe(promise);
      expect(syncStatusStore.getState().getInFlight('artists')).toBeUndefined();
    });

    it('clearInFlight removes the scope entry', () => {
      const promise = Promise.resolve();
      syncStatusStore.getState().setInFlight('albums', promise);
      syncStatusStore.getState().clearInFlight('albums');
      expect(syncStatusStore.getState().getInFlight('albums')).toBeUndefined();
    });

    it('multiple scopes coexist', () => {
      const a = Promise.resolve();
      const b = Promise.resolve();
      syncStatusStore.getState().setInFlight('albums', a);
      syncStatusStore.getState().setInFlight('artists', b);
      expect(syncStatusStore.getState().getInFlight('albums')).toBe(a);
      expect(syncStatusStore.getState().getInFlight('artists')).toBe(b);
    });
  });

  describe('full-sync + last-updated markers', () => {
    it('fullSyncCompletedAt is stamped only once BOTH flags complete (songs first)', () => {
      syncStatusStore.setState({
        librarySyncComplete: false,
        songSyncComplete: false,
        fullSyncCompletedAt: null,
      });
      syncStatusStore.getState().markSongSyncComplete();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBeNull();
      syncStatusStore.getState().markLibrarySyncComplete();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBeGreaterThan(0);
    });

    it('fullSyncCompletedAt is stamped in the reverse order too (library first)', () => {
      syncStatusStore.setState({
        librarySyncComplete: false,
        songSyncComplete: false,
        fullSyncCompletedAt: null,
      });
      syncStatusStore.getState().markLibrarySyncComplete();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBeNull();
      syncStatusStore.getState().markSongSyncComplete();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBeGreaterThan(0);
    });

    it('keeps fullSyncCompletedAt across a reset — it describes the LAST COMPLETED sync', () => {
      // The resets run at the START of a resync. The settings card shows this as
      // "Last sync", and it has to keep reading the previous completed run until the
      // new one finishes — otherwise starting a sync blanks the only record of when
      // the library was last known good.
      syncStatusStore.setState({ fullSyncCompletedAt: 123 });
      syncStatusStore.getState().resetSongSync();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBe(123);
      syncStatusStore.getState().resetLibrarySync();
      expect(syncStatusStore.getState().fullSyncCompletedAt).toBe(123);
    });

    it('bumpLibraryUpdated stamps libraryLastUpdatedAt', () => {
      syncStatusStore.setState({ libraryLastUpdatedAt: null });
      syncStatusStore.getState().bumpLibraryUpdated();
      expect(syncStatusStore.getState().libraryLastUpdatedAt).toBeGreaterThan(0);
    });
  });

  describe('the reap epoch', () => {
    const complete = (librarySyncComplete: boolean, songSyncComplete: boolean) =>
      syncStatusStore.setState({ librarySyncComplete, songSyncComplete, fullResyncEpoch: null });

    it('starts null — never earned is not an epoch of 0', () => {
      // 0 would authorise a reap (`synced_at < 0` is vacuous today, but the distinction
      // is the caller's contract). null is the only "nothing has been proven" value.
      expect(syncStatusStore.getInitialState().fullResyncEpoch).toBeNull();
    });

    it('records the epoch once both halves are complete', () => {
      complete(true, true);
      syncStatusStore.getState().recordFullResyncEpoch(1234);
      expect(syncStatusStore.getState().fullResyncEpoch).toBe(1234);
    });

    it('refuses the epoch when the album half is not complete', () => {
      complete(false, true);
      syncStatusStore.getState().recordFullResyncEpoch(1234);
      expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();
    });

    it('refuses the epoch when the song half is not complete', () => {
      complete(true, false);
      syncStatusStore.getState().recordFullResyncEpoch(1234);
      expect(syncStatusStore.getState().fullResyncEpoch).toBeNull();
    });

    it('survives the resets that start a full resync', () => {
      // The resets run at the START of a full resync. Clearing the epoch there would let
      // an interrupted run destroy an authorisation an earlier completed run earned —
      // and every later write only ever carries a FRESHER stamp, so it stays valid.
      complete(true, true);
      syncStatusStore.getState().recordFullResyncEpoch(1234);
      syncStatusStore.getState().resetLibrarySync();
      syncStatusStore.getState().resetSongSync();
      expect(syncStatusStore.getState().fullResyncEpoch).toBe(1234);
    });
  });

  describe('alwaysUseServerSearch', () => {
    it('defaults to false and updates via setAlwaysUseServerSearch', () => {
      expect(syncStatusStore.getInitialState().alwaysUseServerSearch).toBe(false);
      syncStatusStore.getState().setAlwaysUseServerSearch(true);
      expect(syncStatusStore.getState().alwaysUseServerSearch).toBe(true);
      syncStatusStore.getState().setAlwaysUseServerSearch(false);
      expect(syncStatusStore.getState().alwaysUseServerSearch).toBe(false);
    });
  });
});
