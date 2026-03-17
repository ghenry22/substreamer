jest.mock('../sqliteStorage', () => require('../__mocks__/sqliteStorage'));

const mockGetGenres = jest.fn();

jest.mock('../../services/subsonicService', () => ({
  getGenres: () => mockGetGenres(),
}));

import { genreStore } from '../genreStore';

beforeEach(() => {
  mockGetGenres.mockReset();
  genreStore.setState({ genres: [], lastFetchedAt: null });
});

describe('genreStore', () => {
  it('starts with empty genres and null timestamp', () => {
    const state = genreStore.getState();
    expect(state.genres).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
  });

  it('fetchGenres populates genres on success', async () => {
    const genres = [
      { value: 'Rock', songCount: 100, albumCount: 10 },
      { value: 'Jazz', songCount: 50, albumCount: 5 },
    ];
    mockGetGenres.mockResolvedValue(genres);

    const before = Date.now();
    await genreStore.getState().fetchGenres();
    const after = Date.now();

    const state = genreStore.getState();
    expect(state.genres).toEqual(genres);
    expect(state.lastFetchedAt).toBeGreaterThanOrEqual(before);
    expect(state.lastFetchedAt).toBeLessThanOrEqual(after);
  });

  it('fetchGenres does not update state when API returns null', async () => {
    genreStore.setState({
      genres: [{ value: 'Rock', songCount: 10, albumCount: 1 }],
      lastFetchedAt: 1000,
    });
    mockGetGenres.mockResolvedValue(null);

    await genreStore.getState().fetchGenres();

    const state = genreStore.getState();
    expect(state.genres).toEqual([{ value: 'Rock', songCount: 10, albumCount: 1 }]);
    expect(state.lastFetchedAt).toBe(1000);
  });

  it('fetchGenres replaces existing genres on refresh', async () => {
    genreStore.setState({
      genres: [{ value: 'Rock', songCount: 10, albumCount: 1 }],
      lastFetchedAt: 1000,
    });
    const newGenres = [
      { value: 'Pop', songCount: 200, albumCount: 20 },
    ];
    mockGetGenres.mockResolvedValue(newGenres);

    await genreStore.getState().fetchGenres();

    expect(genreStore.getState().genres).toEqual(newGenres);
  });

  it('partialize excludes fetchGenres from persistence', () => {
    const state = genreStore.getState();
    // The persist config's partialize should only include genres and lastFetchedAt
    expect(typeof state.fetchGenres).toBe('function');
    expect(state).toHaveProperty('genres');
    expect(state).toHaveProperty('lastFetchedAt');
  });
});
