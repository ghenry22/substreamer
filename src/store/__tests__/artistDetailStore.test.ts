jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');
jest.mock('../../services/musicbrainzService');
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
}));
jest.mock('../layoutPreferencesStore', () => ({
  layoutPreferencesStore: {
    getState: jest.fn(() => ({ listLength: 20 })),
  },
}));
jest.mock('../../utils/formatters', () => ({
  sanitizeBiographyText: jest.fn((text: string) => text),
}));

import {
  getArtist,
  getArtistInfo2,
  getTopSongs,
  getVariousArtistsBio,
  VARIOUS_ARTISTS_COVER_ART_ID,
} from '../../services/subsonicService';
import {
  getArtistBiography,
  searchArtistMBID,
} from '../../services/musicbrainzService';
import { mbidOverrideStore } from '../mbidOverrideStore';
import { artistDetailStore } from '../artistDetailStore';

const mockGetArtist = getArtist as jest.MockedFunction<typeof getArtist>;
const mockGetArtistInfo2 = getArtistInfo2 as jest.MockedFunction<typeof getArtistInfo2>;
const mockGetTopSongs = getTopSongs as jest.MockedFunction<typeof getTopSongs>;
const mockSearchMBID = searchArtistMBID as jest.MockedFunction<typeof searchArtistMBID>;
const mockGetBio = getArtistBiography as jest.MockedFunction<typeof getArtistBiography>;

beforeEach(() => {
  jest.clearAllMocks();
  artistDetailStore.getState().clearArtists();
  mbidOverrideStore.setState({ overrides: {} });
  mockGetArtist.mockResolvedValue(null);
  mockGetArtistInfo2.mockResolvedValue(null);
  mockGetTopSongs.mockResolvedValue([]);
});

describe('fetchArtist — Various Artists', () => {
  it('returns static entry with branded coverArt and bio', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'va-1',
      name: 'Various Artists',
      albumCount: 5,
      album: [],
    } as any);

    const entry = await artistDetailStore.getState().fetchArtist('va-1');

    expect(entry).not.toBeNull();
    expect(entry!.artist.coverArt).toBe(VARIOUS_ARTISTS_COVER_ART_ID);
    expect(entry!.biography).toBe(getVariousArtistsBio());
    expect(entry!.topSongs).toEqual([]);
    expect(entry!.artistInfo).toBeNull();
    expect(entry!.resolvedMbid).toBeNull();
  });

  it('does not call getArtistInfo2 or getTopSongs for Various Artists', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'va-1',
      name: 'Various Artists',
      albumCount: 3,
      album: [],
    } as any);

    await artistDetailStore.getState().fetchArtist('va-1');

    expect(mockGetArtistInfo2).not.toHaveBeenCalled();
    expect(mockGetTopSongs).not.toHaveBeenCalled();
  });

  it('handles case-insensitive Various Artists name', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'va-1',
      name: 'various artists',
      albumCount: 1,
      album: [],
    } as any);

    const entry = await artistDetailStore.getState().fetchArtist('va-1');

    expect(entry).not.toBeNull();
    expect(entry!.artist.coverArt).toBe(VARIOUS_ARTISTS_COVER_ART_ID);
    expect(mockGetArtistInfo2).not.toHaveBeenCalled();
  });

  it('stores the entry in the artists map', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'va-1',
      name: 'Various Artists',
      albumCount: 2,
      album: [],
    } as any);

    await artistDetailStore.getState().fetchArtist('va-1');

    const stored = artistDetailStore.getState().artists['va-1'];
    expect(stored).toBeDefined();
    expect(stored.artist.coverArt).toBe(VARIOUS_ARTISTS_COVER_ART_ID);
  });
});

describe('fetchArtist — normal artist', () => {
  it('calls getArtistInfo2 and getTopSongs in parallel', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'ar-1',
      name: 'Radiohead',
      albumCount: 9,
      album: [],
    } as any);
    mockGetArtistInfo2.mockResolvedValue({ biography: 'A band from Oxford.' } as any);
    mockGetTopSongs.mockResolvedValue([{ id: 's1', title: 'Creep' }] as any);

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry).not.toBeNull();
    expect(mockGetArtistInfo2).toHaveBeenCalledWith('ar-1');
    expect(mockGetTopSongs).toHaveBeenCalledWith('Radiohead', 20);
    expect(entry!.topSongs).toHaveLength(1);
    expect(entry!.biography).toBe('A band from Oxford.');
  });

  it('returns null when getArtist fails', async () => {
    mockGetArtist.mockResolvedValue(null);

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry).toBeNull();
    expect(mockGetArtistInfo2).not.toHaveBeenCalled();
    expect(mockGetTopSongs).not.toHaveBeenCalled();
  });

  it('handles missing album array and absent userRating fields', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'ar-1',
      name: 'Radiohead',
      albumCount: 9,
      // album intentionally omitted
    } as any);
    mockGetArtistInfo2.mockResolvedValue({ biography: 'Bio.' } as any);
    mockGetTopSongs.mockResolvedValue([{ id: 's1', title: 'Creep' }] as any);

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry).not.toBeNull();
    expect(entry!.topSongs).toHaveLength(1);
  });

  it('falls back to getTopSongs empty array when getTopSongs throws', async () => {
    mockGetArtist.mockResolvedValue({
      id: 'ar-1',
      name: 'Radiohead',
      albumCount: 9,
      album: [],
    } as any);
    mockGetArtistInfo2.mockResolvedValue({ biography: 'Bio text.' } as any);
    mockGetTopSongs.mockRejectedValue(new Error('fail'));

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry).not.toBeNull();
    expect(entry!.topSongs).toEqual([]);
  });
});

describe('fetchArtist — MusicBrainz biography fallback', () => {
  const setupArtist = () => {
    mockGetArtist.mockResolvedValue({
      id: 'ar-1',
      name: 'Radiohead',
      albumCount: 9,
      album: [],
    } as any);
  };

  it('uses MBID override for bio when Subsonic has no bio', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({ biography: '' } as any);
    mbidOverrideStore.setState({
      overrides: { 'artist:ar-1': { type: 'artist', entityId: 'ar-1', entityName: 'Radiohead', mbid: 'override-mbid' } },
    });
    mockGetBio.mockResolvedValue('MusicBrainz bio from override.');

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry!.biography).toBe('MusicBrainz bio from override.');
    expect(entry!.resolvedMbid).toBe('override-mbid');
    expect(mockGetBio).toHaveBeenCalledWith('override-mbid', expect.any(AbortSignal));
  });

  it('uses server musicBrainzId when no override and no Subsonic bio', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({
      biography: '',
      musicBrainzId: 'server-mbid',
    } as any);
    mbidOverrideStore.setState({ overrides: {} });
    mockGetBio.mockResolvedValue('MusicBrainz bio from server.');

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry!.biography).toBe('MusicBrainz bio from server.');
    expect(entry!.resolvedMbid).toBe('server-mbid');
  });

  it('auto-searches MBID when no override, no server MBID, no Subsonic bio', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({ biography: '' } as any);
    mbidOverrideStore.setState({ overrides: {} });
    mockSearchMBID.mockResolvedValue('auto-mbid');
    mockGetBio.mockResolvedValue('Auto-searched bio.');

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(mockSearchMBID).toHaveBeenCalledWith('Radiohead', expect.any(AbortSignal));
    expect(entry!.biography).toBe('Auto-searched bio.');
    expect(entry!.resolvedMbid).toBe('auto-mbid');
  });

  it('returns null biography when auto-search finds no MBID', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({ biography: '' } as any);
    mbidOverrideStore.setState({ overrides: {} });
    mockSearchMBID.mockResolvedValue(null);

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry!.biography).toBeNull();
    expect(entry!.resolvedMbid).toBeNull();
  });

  it('returns null biography when MusicBrainz bio fetch returns null', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({ biography: '' } as any);
    mbidOverrideStore.setState({ overrides: {} });
    mockSearchMBID.mockResolvedValue('some-mbid');
    mockGetBio.mockResolvedValue(null);

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry!.biography).toBeNull();
    expect(entry!.resolvedMbid).toBe('some-mbid');
  });

  it('catches MusicBrainz errors and still returns entry', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({ biography: '' } as any);
    mbidOverrideStore.setState({ overrides: {} });
    mockSearchMBID.mockRejectedValue(new Error('MusicBrainz down'));

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry).not.toBeNull();
    expect(entry!.biography).toBeNull();
    expect(entry!.resolvedMbid).toBeNull();
  });

  it('resolvedMbid uses override when Subsonic bio is present', async () => {
    setupArtist();
    mockGetArtistInfo2.mockResolvedValue({
      biography: 'Subsonic bio exists.',
      musicBrainzId: 'server-mbid',
    } as any);
    mbidOverrideStore.setState({
      overrides: { 'artist:ar-1': { type: 'artist', entityId: 'ar-1', entityName: 'Radiohead', mbid: 'override-mbid' } },
    });

    const entry = await artistDetailStore.getState().fetchArtist('ar-1');

    expect(entry!.biography).toBe('Subsonic bio exists.');
    expect(entry!.resolvedMbid).toBe('override-mbid');
  });
});

describe('refreshTopSongs', () => {
  const song = (id: string) => ({ id, title: `Song ${id}` } as any);

  it('re-fetches topSongs for all cached artists', async () => {
    artistDetailStore.setState({
      artists: {
        'ar-1': {
          artist: { id: 'ar-1', name: 'Radiohead', albumCount: 9, album: [] } as any,
          artistInfo: null,
          topSongs: [song('old-1')],
          biography: 'Bio',
          resolvedMbid: null,
          retrievedAt: 1000,
        },
        'ar-2': {
          artist: { id: 'ar-2', name: 'Björk', albumCount: 5, album: [] } as any,
          artistInfo: null,
          topSongs: [],
          biography: null,
          resolvedMbid: null,
          retrievedAt: 2000,
        },
      },
    });
    mockGetTopSongs
      .mockResolvedValueOnce([song('new-1'), song('new-2')])
      .mockResolvedValueOnce([song('new-3')]);

    await artistDetailStore.getState().refreshTopSongs();

    const artists = artistDetailStore.getState().artists;
    expect(artists['ar-1'].topSongs).toEqual([song('new-1'), song('new-2')]);
    expect(artists['ar-2'].topSongs).toEqual([song('new-3')]);
  });

  it('uses listLength from layoutPreferencesStore', async () => {
    const { layoutPreferencesStore: mockStore } = require('../layoutPreferencesStore');
    (mockStore.getState as jest.Mock).mockReturnValue({ listLength: 50 });

    artistDetailStore.setState({
      artists: {
        'ar-1': {
          artist: { id: 'ar-1', name: 'Radiohead', albumCount: 9, album: [] } as any,
          artistInfo: null,
          topSongs: [],
          biography: null,
          resolvedMbid: null,
          retrievedAt: 1000,
        },
      },
    });
    mockGetTopSongs.mockResolvedValue([]);

    await artistDetailStore.getState().refreshTopSongs();

    expect(mockGetTopSongs).toHaveBeenCalledWith('Radiohead', 50);
  });

  it('skips Various Artists entries', async () => {
    artistDetailStore.setState({
      artists: {
        'va-1': {
          artist: { id: 'va-1', name: 'Various Artists', albumCount: 5, album: [] } as any,
          artistInfo: null,
          topSongs: [],
          biography: 'VA bio',
          resolvedMbid: null,
          retrievedAt: 1000,
        },
        'ar-1': {
          artist: { id: 'ar-1', name: 'Radiohead', albumCount: 9, album: [] } as any,
          artistInfo: null,
          topSongs: [],
          biography: null,
          resolvedMbid: null,
          retrievedAt: 2000,
        },
      },
    });
    mockGetTopSongs.mockResolvedValue([song('new-1')]);

    await artistDetailStore.getState().refreshTopSongs();

    expect(mockGetTopSongs).toHaveBeenCalledTimes(1);
    expect(mockGetTopSongs).toHaveBeenCalledWith('Radiohead', expect.any(Number));
    expect(artistDetailStore.getState().artists['va-1'].topSongs).toEqual([]);
  });

  it('keeps existing topSongs on API failure', async () => {
    const existingSongs = [song('keep-1'), song('keep-2')];
    artistDetailStore.setState({
      artists: {
        'ar-1': {
          artist: { id: 'ar-1', name: 'Radiohead', albumCount: 9, album: [] } as any,
          artistInfo: null,
          topSongs: existingSongs,
          biography: null,
          resolvedMbid: null,
          retrievedAt: 1000,
        },
      },
    });
    mockGetTopSongs.mockRejectedValue(new Error('network error'));

    await artistDetailStore.getState().refreshTopSongs();

    expect(artistDetailStore.getState().artists['ar-1'].topSongs).toEqual(existingSongs);
  });

  it('preserves non-topSongs fields (biography, artistInfo, resolvedMbid)', async () => {
    artistDetailStore.setState({
      artists: {
        'ar-1': {
          artist: { id: 'ar-1', name: 'Radiohead', albumCount: 9, album: [] } as any,
          artistInfo: { biography: 'Info bio' } as any,
          topSongs: [song('old')],
          biography: 'Original bio',
          resolvedMbid: 'some-mbid',
          retrievedAt: 1000,
        },
      },
    });
    mockGetTopSongs.mockResolvedValue([song('new')]);

    await artistDetailStore.getState().refreshTopSongs();

    const entry = artistDetailStore.getState().artists['ar-1'];
    expect(entry.topSongs).toEqual([song('new')]);
    expect(entry.biography).toBe('Original bio');
    expect(entry.artistInfo).toEqual({ biography: 'Info bio' });
    expect(entry.resolvedMbid).toBe('some-mbid');
    expect(entry.retrievedAt).toBe(1000);
  });

  it('handles empty artists cache gracefully', async () => {
    artistDetailStore.setState({ artists: {} });

    await artistDetailStore.getState().refreshTopSongs();

    expect(mockGetTopSongs).not.toHaveBeenCalled();
    expect(artistDetailStore.getState().artists).toEqual({});
  });
});

describe('fetchArtist — timeout', () => {
  it('returns null when the fetch exceeds the 15s budget', async () => {
    jest.useFakeTimers();
    try {
      mockGetArtist.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const fetchPromise = artistDetailStore.getState().fetchArtist('ar-1');
      jest.advanceTimersByTime(15_000);
      const result = await fetchPromise;

      expect(result).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
