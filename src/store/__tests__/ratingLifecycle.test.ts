import { ratingStore } from '../ratingStore';

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

/**
 * Mirrors `useRating`'s selector logic without React.
 * Returns the override rating if one exists, otherwise the serverRating.
 */
function resolveRating(id: string, serverRating: number): number {
  return ratingStore.getState().overrides[id]?.rating ?? serverRating;
}

/** Calls `reconcileRatings` — simulates a store fetching fresh data from the server. */
function simulateRefresh(entries: Array<{ id: string; serverRating: number }>) {
  ratingStore.getState().reconcileRatings(entries);
}

beforeEach(() => {
  ratingStore.getState().clearOverrides();
});

describe('Song lifecycle', () => {
  const SONG = 'song-1';

  it('progresses through rating changes, stale views, external changes, and clearing', () => {
    // Step 1: Song unrated (sr=0 everywhere). User rates to 4.
    ratingStore.getState().setOverride(SONG, 4);
    expect(resolveRating(SONG, 0)).toBe(4); // stale album detail view
    expect(resolveRating(SONG, 0)).toBe(4); // stale favorites view
    expect(resolveRating(SONG, 0)).toBe(4); // stale playlist view
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(4);

    // Step 2: Refresh album detail (server confirms 4). Reconcile.
    simulateRefresh([{ id: SONG, serverRating: 4 }]);
    expect(ratingStore.getState().overrides[SONG]).toBeDefined();
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(4);
    expect(resolveRating(SONG, 4)).toBe(4); // refreshed album detail
    expect(resolveRating(SONG, 0)).toBe(4); // stale favorites (override protects)
    expect(resolveRating(SONG, 0)).toBe(4); // stale playlist (override protects)

    // Step 3: Change rating to 1.
    ratingStore.getState().setOverride(SONG, 1);
    expect(resolveRating(SONG, 4)).toBe(1); // refreshed album detail
    expect(resolveRating(SONG, 0)).toBe(1); // stale favorites
    expect(resolveRating(SONG, 0)).toBe(1); // stale playlist
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(1);

    // Step 4: Navigate back to stale view — override must NOT be corrupted.
    expect(resolveRating(SONG, 0)).toBe(1); // stale view does not corrupt
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(1); // override unchanged

    // Step 5: Refresh album detail (server confirms 1). Reconcile.
    simulateRefresh([{ id: SONG, serverRating: 1 }]);
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(1);
    expect(resolveRating(SONG, 1)).toBe(1); // refreshed
    expect(resolveRating(SONG, 0)).toBe(1); // stale favorites still protected

    // Step 6: Rating changed to 3 on server (outside Substreamer). Refresh album detail.
    simulateRefresh([{ id: SONG, serverRating: 3 }]);
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(3);
    expect(resolveRating(SONG, 3)).toBe(3); // refreshed album detail
    expect(resolveRating(SONG, 0)).toBe(3); // stale favorites sees new value via override
    expect(resolveRating(SONG, 1)).toBe(3); // stale playlist (had sr=1) sees 3 via override

    // Step 7: Clear rating (set to 0).
    ratingStore.getState().setOverride(SONG, 0);
    expect(resolveRating(SONG, 3)).toBe(0); // refreshed view
    expect(resolveRating(SONG, 0)).toBe(0); // stale view
    expect(resolveRating(SONG, 1)).toBe(0); // another stale view
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(0);

    // Step 8: Refresh (server confirms 0). Reconcile.
    simulateRefresh([{ id: SONG, serverRating: 0 }]);
    expect(ratingStore.getState().overrides[SONG]!.rating).toBe(0);
    expect(resolveRating(SONG, 0)).toBe(0);
  });
});

describe('Album lifecycle', () => {
  const ALBUM = 'album-1';

  it('progresses through rating changes, stale views, external changes, and clearing', () => {
    // Step 1: Album unrated. Set rating to 5.
    ratingStore.getState().setOverride(ALBUM, 5);
    expect(resolveRating(ALBUM, 0)).toBe(5); // home screen (stale)
    expect(resolveRating(ALBUM, 0)).toBe(5); // library (stale)

    // Step 2: Refresh home screen (server=5). Reconcile.
    simulateRefresh([{ id: ALBUM, serverRating: 5 }]);
    expect(resolveRating(ALBUM, 5)).toBe(5); // refreshed home
    expect(resolveRating(ALBUM, 0)).toBe(5); // stale library (override protects)

    // Step 3: Change to 2.
    ratingStore.getState().setOverride(ALBUM, 2);
    expect(resolveRating(ALBUM, 5)).toBe(2); // home
    expect(resolveRating(ALBUM, 0)).toBe(2); // library

    // Step 4: Stale library view does not corrupt.
    expect(ratingStore.getState().overrides[ALBUM]!.rating).toBe(2);

    // Step 5: External change to 4. Refresh. Reconcile.
    simulateRefresh([{ id: ALBUM, serverRating: 4 }]);
    expect(ratingStore.getState().overrides[ALBUM]!.rating).toBe(4);
    expect(resolveRating(ALBUM, 4)).toBe(4);
    expect(resolveRating(ALBUM, 0)).toBe(4); // stale view protected

    // Step 6: Clear.
    ratingStore.getState().setOverride(ALBUM, 0);
    expect(resolveRating(ALBUM, 4)).toBe(0);
    simulateRefresh([{ id: ALBUM, serverRating: 0 }]);
    expect(resolveRating(ALBUM, 0)).toBe(0);
  });
});

describe('Artist lifecycle', () => {
  const ARTIST = 'artist-1';

  it('progresses through rating changes, stale views, external changes, and clearing', () => {
    // Step 1: Artist unrated. Set rating to 3.
    ratingStore.getState().setOverride(ARTIST, 3);
    expect(resolveRating(ARTIST, 0)).toBe(3);

    // Step 2: Reconcile (server=3). No change.
    simulateRefresh([{ id: ARTIST, serverRating: 3 }]);
    expect(resolveRating(ARTIST, 3)).toBe(3);
    expect(resolveRating(ARTIST, 0)).toBe(3); // stale

    // Step 3: Change to 5.
    ratingStore.getState().setOverride(ARTIST, 5);
    expect(resolveRating(ARTIST, 3)).toBe(5);
    expect(resolveRating(ARTIST, 0)).toBe(5);

    // Step 4: External change to 1. Reconcile.
    simulateRefresh([{ id: ARTIST, serverRating: 1 }]);
    expect(ratingStore.getState().overrides[ARTIST]!.rating).toBe(1);
    expect(resolveRating(ARTIST, 0)).toBe(1); // stale protected

    // Step 5: Clear. Reconcile.
    ratingStore.getState().setOverride(ARTIST, 0);
    simulateRefresh([{ id: ARTIST, serverRating: 0 }]);
    expect(resolveRating(ARTIST, 0)).toBe(0);
  });
});

describe('Cross-store stale data protection', () => {
  it('override protects all stale stores when only one store refreshes', () => {
    ratingStore.getState().setOverride('s1', 4);

    // 4 different views with sr=0 (album detail, favorites, playlist, search)
    expect(resolveRating('s1', 0)).toBe(4);
    expect(resolveRating('s1', 0)).toBe(4);
    expect(resolveRating('s1', 0)).toBe(4);
    expect(resolveRating('s1', 0)).toBe(4);

    // One store refreshes
    simulateRefresh([{ id: 's1', serverRating: 4 }]);

    // All views still return 4
    expect(resolveRating('s1', 4)).toBe(4); // refreshed
    expect(resolveRating('s1', 0)).toBe(4); // stale
    expect(resolveRating('s1', 0)).toBe(4); // stale
    expect(resolveRating('s1', 0)).toBe(4); // stale

    // Override was NOT removed
    expect(ratingStore.getState().overrides['s1']).toBeDefined();
  });
});

describe('Multi-entity independence', () => {
  it('reconciling one entity does not affect other entities overrides', () => {
    ratingStore.getState().setOverride('song', 4);
    ratingStore.getState().setOverride('album', 5);
    ratingStore.getState().setOverride('artist', 3);

    simulateRefresh([{ id: 'song', serverRating: 4 }]);

    expect(ratingStore.getState().overrides['song']!.rating).toBe(4);
    expect(ratingStore.getState().overrides['album']!.rating).toBe(5);
    expect(ratingStore.getState().overrides['artist']!.rating).toBe(3);
  });

  it('batch reconciliation updates multiple overrides', () => {
    ratingStore.getState().setOverride('s1', 4);
    ratingStore.getState().setOverride('s2', 3);
    ratingStore.getState().setOverride('s3', 2);

    simulateRefresh([
      { id: 's1', serverRating: 4 },
      { id: 's3', serverRating: 5 },
    ]);

    expect(ratingStore.getState().overrides['s1']!.rating).toBe(4);
    expect(ratingStore.getState().overrides['s2']!.rating).toBe(3);
    expect(ratingStore.getState().overrides['s3']!.rating).toBe(5);
  });

  it('reconciling entities without overrides does not create new overrides', () => {
    ratingStore.getState().setOverride('s1', 4);

    simulateRefresh([
      { id: 's1', serverRating: 4 },
      { id: 's2', serverRating: 3 },
    ]);

    expect(ratingStore.getState().overrides['s1']).toBeDefined();
    expect(ratingStore.getState().overrides['s2']).toBeUndefined();
  });
});

describe('Edge cases', () => {
  it('idempotent: setting same rating twice', () => {
    ratingStore.getState().setOverride('s1', 4);
    ratingStore.getState().setOverride('s1', 4);
    expect(ratingStore.getState().overrides['s1']!.rating).toBe(4);
  });

  it('last write wins', () => {
    ratingStore.getState().setOverride('s1', 4);
    ratingStore.getState().setOverride('s1', 2);
    ratingStore.getState().setOverride('s1', 5);
    expect(ratingStore.getState().overrides['s1']!.rating).toBe(5);
  });

  it('resolveRating returns serverRating when no override exists', () => {
    expect(resolveRating('s1', 3)).toBe(3);
    expect(resolveRating('s1', 0)).toBe(0);
  });

  it('reconcile with no matching overrides is a no-op (same state ref)', () => {
    ratingStore.getState().setOverride('s1', 4);
    const before = ratingStore.getState();
    ratingStore.getState().reconcileRatings([{ id: 'nonexistent', serverRating: 5 }]);
    expect(ratingStore.getState()).toBe(before);
  });

  it('reconcile when override already matches server is a no-op', () => {
    ratingStore.getState().setOverride('s1', 4);
    const before = ratingStore.getState();
    ratingStore.getState().reconcileRatings([{ id: 's1', serverRating: 4 }]);
    expect(ratingStore.getState()).toBe(before);
  });

  it('reconcile with empty entries array is a no-op', () => {
    ratingStore.getState().setOverride('s1', 4);
    const before = ratingStore.getState();
    ratingStore.getState().reconcileRatings([]);
    expect(ratingStore.getState()).toBe(before);
  });

  it('override with rating=0 (cleared) persists and protects stale views', () => {
    ratingStore.getState().setOverride('s1', 0);
    expect(resolveRating('s1', 5)).toBe(0); // stale view with old rating
    expect(resolveRating('s1', 3)).toBe(0); // another stale view
    simulateRefresh([{ id: 's1', serverRating: 0 }]);
    expect(ratingStore.getState().overrides['s1']).toBeDefined();
    expect(ratingStore.getState().overrides['s1']!.rating).toBe(0);
  });

  it('clearOverrides removes all overrides', () => {
    ratingStore.getState().setOverride('s1', 4);
    ratingStore.getState().setOverride('s2', 3);
    ratingStore.getState().setOverride('s3', 2);
    ratingStore.getState().clearOverrides();
    expect(resolveRating('s1', 0)).toBe(0);
    expect(resolveRating('s2', 0)).toBe(0);
    expect(resolveRating('s3', 0)).toBe(0);
  });
});
