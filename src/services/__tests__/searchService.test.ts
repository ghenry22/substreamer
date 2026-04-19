jest.mock('../subsonicService');
jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));
jest.mock('../imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
}));

import { ensureCoverArtAuth, search3 } from '../subsonicService';
import { albumDetailStore } from '../../store/albumDetailStore';
import { albumLibraryStore } from '../../store/albumLibraryStore';
import { favoritesStore } from '../../store/favoritesStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { playlistDetailStore } from '../../store/playlistDetailStore';
import { playlistLibraryStore } from '../../store/playlistLibraryStore';
import {
  performOnlineSearch,
  performOfflineSearch,
  getOfflineSongsByGenre,
} from '../searchService';

const mockSearch3 = search3 as jest.MockedFunction<typeof search3>;
const mockEnsureCoverArtAuth = ensureCoverArtAuth as jest.MockedFunction<typeof ensureCoverArtAuth>;

function resetStores() {
  musicCacheStore.setState({ cachedItems: {}, cachedSongs: {} } as any);
  albumLibraryStore.setState({ albums: [] });
  albumDetailStore.setState({ albums: {} });
  playlistLibraryStore.setState({ playlists: [] });
  playlistDetailStore.setState({ playlists: {} });
  favoritesStore.setState({ songs: [], albums: [], artists: [] } as any);
}

/**
 * Translate a v1-shape {cachedItems: { id: { ..., tracks: [...] } }} seed
 * into the v2 shape {cachedItems: { id: { ..., songIds: [...] } }, cachedSongs}.
 * Keeps the existing tests' per-seed song metadata identical; only restructures.
 */
function seedCache(
  oldItems: Record<string, { name: string; coverArtId?: string; tracks: any[] }>,
) {
  const cachedItems: Record<string, any> = {};
  const cachedSongs: Record<string, any> = {};
  for (const [itemId, item] of Object.entries(oldItems)) {
    const songIds: string[] = [];
    for (const t of item.tracks) {
      if (!t?.id) continue;
      if (!songIds.includes(t.id)) songIds.push(t.id);
      // First occurrence wins for duplicate IDs (matches real-world dedup).
      if (!cachedSongs[t.id]) cachedSongs[t.id] = { ...t };
    }
    cachedItems[itemId] = {
      itemId,
      name: item.name,
      coverArtId: item.coverArtId,
      songIds,
    };
  }
  musicCacheStore.setState({ cachedItems, cachedSongs } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
});

describe('performOnlineSearch', () => {
  it('calls ensureCoverArtAuth then search3', async () => {
    const results = {
      albums: [{ id: 'a1', name: 'Album' }],
      artists: [{ id: 'ar1', name: 'Artist' }],
      songs: [{ id: 's1', title: 'Song' }],
    };
    mockSearch3.mockResolvedValue(results as any);

    const result = await performOnlineSearch('test');

    expect(mockEnsureCoverArtAuth).toHaveBeenCalled();
    expect(mockSearch3).toHaveBeenCalledWith('test');
    expect(result).toEqual(results);
  });

  it('propagates errors from search3', async () => {
    mockSearch3.mockRejectedValue(new Error('Network error'));
    await expect(performOnlineSearch('test')).rejects.toThrow('Network error');
  });
});

describe('performOfflineSearch', () => {
  it('searches cached albums by name', () => {
    seedCache({
        a1: { name: 'Test Album', coverArtId: 'c1', tracks: [] },
    });
    albumLibraryStore.setState({
      albums: [{ id: 'a1', name: 'Test Album', artist: 'Artist' }] as any,
    });

    const result = performOfflineSearch('test');

    expect(result.albums).toHaveLength(1);
    expect(result.albums[0].id).toBe('a1');
  });

  it('searches cached albums by artist name', () => {
    seedCache({
        a1: { name: 'Album', coverArtId: 'c1', tracks: [] },
    });
    albumLibraryStore.setState({
      albums: [{ id: 'a1', name: 'Album', artist: 'Radiohead' }] as any,
    });

    const result = performOfflineSearch('radiohead');

    expect(result.albums).toHaveLength(1);
  });

  it('excludes non-cached albums', () => {
    musicCacheStore.setState({ cachedItems: {}, cachedSongs: {} } as any);
    albumLibraryStore.setState({
      albums: [{ id: 'a1', name: 'Test Album', artist: 'Artist' }] as any,
    });

    const result = performOfflineSearch('test');

    expect(result.albums).toHaveLength(0);
  });

  it('includes cached playlists as album-shaped results', () => {
    seedCache({
        p1: { name: 'My Playlist', coverArtId: 'c1', tracks: [] },
    });
    albumLibraryStore.setState({ albums: [] });
    playlistLibraryStore.setState({
      playlists: [
        { id: 'p1', name: 'My Playlist', owner: 'user', coverArt: 'c1', songCount: 5, duration: 1000, created: '2024-01-01' },
      ] as any,
    });

    const result = performOfflineSearch('my');

    expect(result.albums.some((a) => a.id === 'p1')).toBe(true);
  });

  it('searches cached songs by title', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [
            { id: 't1', title: 'Matching Song', artist: 'Artist', duration: 200 },
            { id: 't2', title: 'Other', artist: 'Nobody', duration: 180 },
          ],
        },
    });

    const result = performOfflineSearch('matching');

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].title).toBe('Matching Song');
  });

  it('searches cached songs by artist', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [
            { id: 't1', title: 'Song', artist: 'Radiohead', duration: 200 },
          ],
        },
    });

    const result = performOfflineSearch('radiohead');

    expect(result.songs).toHaveLength(1);
  });

  it('deduplicates songs by id', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [
            { id: 't1', title: 'Dup Song', artist: 'A', duration: 200 },
            { id: 't1', title: 'Dup Song', artist: 'A', duration: 200 },
          ],
        },
    });

    const result = performOfflineSearch('dup');

    expect(result.songs).toHaveLength(1);
  });

  it('uses cover art from playlistDetail over fallback', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'fallback-cover',
          tracks: [
            { id: 't1', title: 'Track One', artist: 'A', duration: 200 },
          ],
        },
    });
    playlistDetailStore.setState({
      playlists: {
        p1: { playlist: { entry: [{ id: 't1', coverArt: 'playlist-cover' }] } },
      },
    } as any);

    const result = performOfflineSearch('track');

    expect(result.songs[0].coverArt).toBe('playlist-cover');
  });

  it('falls back to cachedItem coverArtId when no detail cover art', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'fallback-cover',
          tracks: [
            { id: 't1', title: 'Track', artist: 'A', duration: 200 },
          ],
        },
    });

    const result = performOfflineSearch('track');

    expect(result.songs[0].coverArt).toBe('fallback-cover');
  });

  it('always returns empty artists array', () => {
    const result = performOfflineSearch('anything');
    expect(result.artists).toEqual([]);
  });

  it('returns empty results for no matches', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [
            { id: 't1', title: 'Song', artist: 'Artist', duration: 200 },
          ],
        },
    });
    albumLibraryStore.setState({
      albums: [{ id: 'a1', name: 'Album', artist: 'Artist' }] as any,
    });

    const result = performOfflineSearch('zzzznotfound');

    expect(result.albums).toHaveLength(0);
    expect(result.songs).toHaveLength(0);
  });

  it('handles album with undefined artist gracefully', () => {
    seedCache({
        a1: { name: 'Album', coverArtId: 'c1', tracks: [] },
    });
    albumLibraryStore.setState({
      albums: [{ id: 'a1', name: 'Album' }] as any,
    });

    const result = performOfflineSearch('someartist');

    expect(result.albums).toHaveLength(0);
  });
});

describe('getOfflineSongsByGenre', () => {
  it('returns songs matching genre from album detail', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [
              { id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false },
              { id: 't2', title: 'Other', artist: 'B', genre: 'Jazz', isDir: false },
            ],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('matches genre case-insensitively', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'ROCK', isDir: false }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('rock');

    expect(result).toHaveLength(1);
  });

  it('matches via genres array with {name} objects (OpenSubsonic)', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [
              { id: 't1', title: 'Song', artist: 'A', genres: [{ name: 'Electronic' }, { name: 'Ambient' }], isDir: false },
            ],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('ambient');

    expect(result).toHaveLength(1);
  });

  it('matches via genres array with plain strings (defensive)', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [
              { id: 't1', title: 'Song', artist: 'A', genres: ['Electronic', 'Ambient'], isDir: false },
            ],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('ambient');

    expect(result).toHaveLength(1);
  });

  it('excludes songs not in music cache', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [
              { id: 't1', title: 'Cached', artist: 'A', genre: 'Rock', isDir: false },
              { id: 't99', title: 'Not Cached', artist: 'B', genre: 'Rock', isDir: false },
            ],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('deduplicates songs across stores', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false, coverArt: 'ca1' }],
          },
        },
      },
    } as any);
    favoritesStore.setState({
      songs: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false, coverArt: 'ca2' }],
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(1);
  });

  it('includes songs from cached playlists', () => {
    seedCache({
        p1: {
          name: 'Playlist',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    playlistDetailStore.setState({
      playlists: {
        p1: {
          playlist: {
            id: 'p1',
            entry: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Pop', isDir: false }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Pop');

    expect(result).toHaveLength(1);
  });

  it('includes starred songs that are cached', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    favoritesStore.setState({
      songs: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Blues', isDir: false }],
    } as any);

    const result = getOfflineSongsByGenre('Blues');

    expect(result).toHaveLength(1);
  });

  it('returns empty array when no songs match genre', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Classical');

    expect(result).toHaveLength(0);
  });

  it('returns empty array when no cached items', () => {
    const result = getOfflineSongsByGenre('Rock');
    expect(result).toHaveLength(0);
  });

  it('only includes songs from cached album items', () => {
    seedCache({
        a1: {
          name: 'Cached Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false }],
          },
        },
        a2: {
          album: {
            id: 'a2',
            song: [{ id: 't2', title: 'Other Song', artist: 'B', genre: 'Rock', isDir: false }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('uses cover art from song when available', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false, coverArt: 'song-cover' }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result[0].coverArt).toBe('song-cover');
  });

  it('falls back to trackCoverArtMap when song has no coverArt', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', genre: 'Rock', isDir: false }],
          },
        },
      },
    } as any);
    // The favorites store has cover art for t1
    favoritesStore.setState({
      songs: [{ id: 't1', coverArt: 'fav-cover' }],
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result[0].coverArt).toBe('fav-cover');
  });

  it('does not match songs without genre or genres field', () => {
    seedCache({
        a1: {
          name: 'Album',
          coverArtId: 'c1',
          tracks: [{ id: 't1', title: 'Song', artist: 'A', duration: 200 }],
        },
    });
    albumDetailStore.setState({
      albums: {
        a1: {
          album: {
            id: 'a1',
            song: [{ id: 't1', title: 'Song', artist: 'A', isDir: false }],
          },
        },
      },
    } as any);

    const result = getOfflineSongsByGenre('Rock');

    expect(result).toHaveLength(0);
  });
});
