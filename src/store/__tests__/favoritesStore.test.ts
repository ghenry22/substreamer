jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
}));

import { getStarred2 } from '../../services/subsonicService';
import { favoritesStore } from '../favoritesStore';

const mockGetStarred2 = getStarred2 as jest.MockedFunction<typeof getStarred2>;

beforeEach(() => {
  jest.clearAllMocks();
  favoritesStore.getState().clearFavorites();
  mockGetStarred2.mockResolvedValue({ songs: [], albums: [], artists: [] });
});

describe('setOverride', () => {
  it('sets optimistic override for item', () => {
    favoritesStore.getState().setOverride('album-1', true);
    expect(favoritesStore.getState().overrides['album-1']).toBe(true);

    favoritesStore.getState().setOverride('album-1', false);
    expect(favoritesStore.getState().overrides['album-1']).toBe(false);
  });

  it('supports multiple overrides simultaneously', () => {
    favoritesStore.getState().setOverride('a', true);
    favoritesStore.getState().setOverride('b', false);
    favoritesStore.getState().setOverride('c', true);
    expect(favoritesStore.getState().overrides).toEqual({ a: true, b: false, c: true });
  });
});

describe('fetchStarred', () => {
  it('clears overrides on success', async () => {
    favoritesStore.getState().setOverride('album-1', true);
    expect(favoritesStore.getState().overrides['album-1']).toBe(true);

    await favoritesStore.getState().fetchStarred();

    expect(favoritesStore.getState().overrides).toEqual({});
  });

  it('populates songs, albums, artists from server response', async () => {
    mockGetStarred2.mockResolvedValue({
      songs: [{ id: 's1', title: 'Song', isDir: false }],
      albums: [{ id: 'a1', name: 'Album', created: new Date(), duration: 0, songCount: 0 }],
      artists: [{ id: 'ar1', name: 'Artist', albumCount: 0 }],
    });
    await favoritesStore.getState().fetchStarred();
    expect(favoritesStore.getState().songs).toHaveLength(1);
    expect(favoritesStore.getState().albums).toHaveLength(1);
    expect(favoritesStore.getState().artists).toHaveLength(1);
  });

  it('sets lastFetchedAt on success', async () => {
    expect(favoritesStore.getState().lastFetchedAt).toBeNull();
    await favoritesStore.getState().fetchStarred();
    expect(favoritesStore.getState().lastFetchedAt).toBeGreaterThan(0);
  });

  it('sets error and clears loading on API failure', async () => {
    mockGetStarred2.mockRejectedValue(new Error('Network error'));
    await favoritesStore.getState().fetchStarred();
    expect(favoritesStore.getState().loading).toBe(false);
    expect(favoritesStore.getState().error).toBe('Network error');
  });

  it('sets generic error for non-Error throws', async () => {
    mockGetStarred2.mockRejectedValue('some string');
    await favoritesStore.getState().fetchStarred();
    expect(favoritesStore.getState().error).toBe('Failed to load favorites');
  });

  it('prevents duplicate concurrent fetches', async () => {
    let callCount = 0;
    mockGetStarred2.mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 100));
      return { songs: [], albums: [], artists: [] };
    });
    // Both calls start while the first is still in-flight
    const p1 = favoritesStore.getState().fetchStarred();
    const p2 = favoritesStore.getState().fetchStarred();
    await Promise.all([p1, p2]);
    expect(callCount).toBe(1);
  });

  it('does not clear overrides on failure', async () => {
    favoritesStore.getState().setOverride('album-1', true);
    mockGetStarred2.mockRejectedValue(new Error('fail'));
    await favoritesStore.getState().fetchStarred();
    expect(favoritesStore.getState().overrides['album-1']).toBe(true);
  });
});
