import { ratingStore } from '../ratingStore';

jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

beforeEach(() => {
  ratingStore.getState().clearOverrides();
});

describe('setOverride', () => {
  it('stores rating', () => {
    ratingStore.getState().setOverride('song-1', 5);
    expect(ratingStore.getState().overrides['song-1']).toEqual({
      rating: 5,
    });
  });

  it('overwrites existing override', () => {
    ratingStore.getState().setOverride('song-1', 3);
    ratingStore.getState().setOverride('song-1', 5);
    expect(ratingStore.getState().overrides['song-1']!.rating).toBe(5);
  });
});

describe('removeOverride', () => {
  it('removes a specific override', () => {
    ratingStore.getState().setOverride('song-1', 4);
    ratingStore.getState().setOverride('song-2', 3);
    ratingStore.getState().removeOverride('song-1');
    expect(ratingStore.getState().overrides['song-1']).toBeUndefined();
    expect(ratingStore.getState().overrides['song-2']).toBeDefined();
  });

  it('is a no-op for nonexistent override', () => {
    ratingStore.getState().setOverride('song-1', 4);
    ratingStore.getState().removeOverride('nonexistent');
    expect(Object.keys(ratingStore.getState().overrides)).toHaveLength(1);
  });
});

describe('clearOverrides', () => {
  it('removes all overrides', () => {
    ratingStore.getState().setOverride('song-1', 4);
    ratingStore.getState().setOverride('song-2', 3);
    ratingStore.getState().clearOverrides();
    expect(ratingStore.getState().overrides).toEqual({});
  });
});

describe('reconcileRatings', () => {
  it('updates override when server has a different value', () => {
    ratingStore.getState().setOverride('song-1', 4);
    ratingStore.getState().reconcileRatings([{ id: 'song-1', serverRating: 5 }]);
    expect(ratingStore.getState().overrides['song-1']).toEqual({ rating: 5 });
  });

  it('does not change override when server matches', () => {
    ratingStore.getState().setOverride('song-1', 4);
    const before = ratingStore.getState();
    ratingStore.getState().reconcileRatings([{ id: 'song-1', serverRating: 4 }]);
    expect(ratingStore.getState()).toBe(before);
  });

  it('does not create overrides for entities without one', () => {
    ratingStore.getState().reconcileRatings([{ id: 'song-1', serverRating: 5 }]);
    expect(ratingStore.getState().overrides['song-1']).toBeUndefined();
  });

  it('is a no-op with empty entries', () => {
    ratingStore.getState().setOverride('song-1', 4);
    const before = ratingStore.getState();
    ratingStore.getState().reconcileRatings([]);
    expect(ratingStore.getState()).toBe(before);
  });

  it('handles batch reconciliation', () => {
    ratingStore.getState().setOverride('s1', 4);
    ratingStore.getState().setOverride('s2', 3);
    ratingStore.getState().setOverride('s3', 2);
    ratingStore.getState().reconcileRatings([
      { id: 's1', serverRating: 4 },
      { id: 's3', serverRating: 5 },
    ]);
    expect(ratingStore.getState().overrides['s1']!.rating).toBe(4);
    expect(ratingStore.getState().overrides['s2']!.rating).toBe(3);
    expect(ratingStore.getState().overrides['s3']!.rating).toBe(5);
  });
});
