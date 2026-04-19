jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { getOverride, mbidOverrideStore } from '../mbidOverrideStore';

beforeEach(() => {
  mbidOverrideStore.setState({ overrides: {} });
});

describe('mbidOverrideStore', () => {
  it('setOverride adds an artist override entry', () => {
    mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'mbid-123');
    const entry = mbidOverrideStore.getState().overrides['artist:ar1'];
    expect(entry).toEqual({
      type: 'artist',
      entityId: 'ar1',
      entityName: 'Radiohead',
      mbid: 'mbid-123',
    });
  });

  it('setOverride adds an album override entry', () => {
    mbidOverrideStore.getState().setOverride('album', 'al1', 'OK Computer', 'mbid-456');
    const entry = mbidOverrideStore.getState().overrides['album:al1'];
    expect(entry).toEqual({
      type: 'album',
      entityId: 'al1',
      entityName: 'OK Computer',
      mbid: 'mbid-456',
    });
  });

  it('setOverride overwrites existing entry', () => {
    mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'old-mbid');
    mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'new-mbid');
    expect(mbidOverrideStore.getState().overrides['artist:ar1'].mbid).toBe('new-mbid');
  });

  it('artist and album keys do not collide', () => {
    mbidOverrideStore.getState().setOverride('artist', 'id1', 'Name A', 'mbid-a');
    mbidOverrideStore.getState().setOverride('album', 'id1', 'Name B', 'mbid-b');
    expect(Object.keys(mbidOverrideStore.getState().overrides)).toHaveLength(2);
    expect(mbidOverrideStore.getState().overrides['artist:id1'].mbid).toBe('mbid-a');
    expect(mbidOverrideStore.getState().overrides['album:id1'].mbid).toBe('mbid-b');
  });

  it('removeOverride removes the entry', () => {
    mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'mbid-123');
    mbidOverrideStore.getState().setOverride('artist', 'ar2', 'Muse', 'mbid-456');
    mbidOverrideStore.getState().removeOverride('artist', 'ar1');
    expect(mbidOverrideStore.getState().overrides['artist:ar1']).toBeUndefined();
    expect(mbidOverrideStore.getState().overrides['artist:ar2']).toBeDefined();
  });

  it('removeOverride is safe when key does not exist', () => {
    mbidOverrideStore.getState().removeOverride('artist', 'nonexistent');
    expect(mbidOverrideStore.getState().overrides).toEqual({});
  });

  it('clearOverrides removes all entries', () => {
    mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'mbid-123');
    mbidOverrideStore.getState().setOverride('album', 'al1', 'OK Computer', 'mbid-456');
    mbidOverrideStore.getState().clearOverrides();
    expect(mbidOverrideStore.getState().overrides).toEqual({});
  });

  describe('getOverride', () => {
    it('returns the matching override', () => {
      mbidOverrideStore.getState().setOverride('artist', 'ar1', 'Radiohead', 'mbid-123');
      const result = getOverride(mbidOverrideStore.getState().overrides, 'artist', 'ar1');
      expect(result?.mbid).toBe('mbid-123');
    });

    it('returns undefined for missing override', () => {
      const result = getOverride(mbidOverrideStore.getState().overrides, 'artist', 'missing');
      expect(result).toBeUndefined();
    });

    it('differentiates between artist and album with same id', () => {
      mbidOverrideStore.getState().setOverride('artist', 'id1', 'Artist', 'mbid-a');
      mbidOverrideStore.getState().setOverride('album', 'id1', 'Album', 'mbid-b');
      expect(getOverride(mbidOverrideStore.getState().overrides, 'artist', 'id1')?.mbid).toBe('mbid-a');
      expect(getOverride(mbidOverrideStore.getState().overrides, 'album', 'id1')?.mbid).toBe('mbid-b');
    });
  });
});
