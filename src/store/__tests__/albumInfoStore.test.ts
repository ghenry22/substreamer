jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');
jest.mock('../../services/musicbrainzService');

import { getAlbumInfo2 } from '../../services/subsonicService';
import { getAlbumDescription } from '../../services/musicbrainzService';
import { albumInfoStore } from '../albumInfoStore';
import { mbidOverrideStore } from '../mbidOverrideStore';

import type { AlbumInfo } from '../../services/subsonicService';

const mockGetAlbumInfo2 = getAlbumInfo2 as jest.MockedFunction<typeof getAlbumInfo2>;
const mockGetAlbumDescription = getAlbumDescription as jest.MockedFunction<typeof getAlbumDescription>;

beforeEach(() => {
  jest.clearAllMocks();
  albumInfoStore.getState().clearAlbumInfo();
  mbidOverrideStore.setState({ overrides: {} });
});

const sampleAlbumInfo: AlbumInfo = {
  notes: '<p>A great album.</p>',
  lastFmUrl: 'https://www.last.fm/music/Artist/Album',
  musicBrainzId: 'mb-123',
  largeImageUrl: 'https://example.com/large.jpg',
  mediumImageUrl: 'https://example.com/medium.jpg',
  smallImageUrl: 'https://example.com/small.jpg',
};

const sampleAlbumInfoNoNotes: AlbumInfo = {
  lastFmUrl: 'https://www.last.fm/music/Artist/Album',
  musicBrainzId: 'mb-123',
};

describe('albumInfoStore', () => {
  describe('fetchAlbumInfo — Subsonic data', () => {
    it('fetches and caches album info with server notes', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfo);

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(mockGetAlbumInfo2).toHaveBeenCalledWith('a1');
      expect(result?.albumInfo).toBe(sampleAlbumInfo);
      expect(result?.enrichedNotes).toBeNull();
      expect(result?.enrichedNotesUrl).toBeNull();
      expect(result?.retrievedAt).toBeGreaterThan(0);
      // Should not attempt enrichment when server has notes
      expect(mockGetAlbumDescription).not.toHaveBeenCalled();
    });

    it('caches entry even when API returns null', async () => {
      mockGetAlbumInfo2.mockResolvedValue(null);
      mockGetAlbumDescription.mockResolvedValue(null);

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1');

      expect(result).toBeDefined();
      expect(albumInfoStore.getState().entries['a1']).toBeDefined();
    });

    it('preserves existing entries when fetching a different album', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfo);

      await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album 1');
      await albumInfoStore.getState().fetchAlbumInfo('a2', 'Artist', 'Album 2');

      expect(albumInfoStore.getState().entries['a1']).toBeDefined();
      expect(albumInfoStore.getState().entries['a2']).toBeDefined();
    });

    it('sets loading state during fetch and clears on success', async () => {
      let resolvePromise: (value: AlbumInfo | null) => void;
      mockGetAlbumInfo2.mockReturnValue(
        new Promise((resolve) => { resolvePromise = resolve; })
      );

      const fetchPromise = albumInfoStore.getState().fetchAlbumInfo('a1');
      expect(albumInfoStore.getState().loading['a1']).toBe(true);

      resolvePromise!(sampleAlbumInfo);
      await fetchPromise;
      expect(albumInfoStore.getState().loading['a1']).toBeUndefined();
    });

    it('records an error and clears loading when the server call rejects', async () => {
      mockGetAlbumInfo2.mockRejectedValue(new Error('Network error'));

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1');

      expect(result).toBeNull();
      expect(albumInfoStore.getState().loading['a1']).toBeUndefined();
      expect(albumInfoStore.getState().errors['a1']).toBe('error');
    });

    it('records a timeout error and clears loading when the fetch exceeds the budget', async () => {
      jest.useFakeTimers();
      try {
        mockGetAlbumInfo2.mockImplementation(
          () => new Promise<AlbumInfo | null>(() => { /* never resolves */ }),
        );

        const fetchPromise = albumInfoStore.getState().fetchAlbumInfo('a1');
        jest.advanceTimersByTime(15_000);
        const result = await fetchPromise;

        expect(result).toBeNull();
        expect(albumInfoStore.getState().loading['a1']).toBeUndefined();
        expect(albumInfoStore.getState().errors['a1']).toBe('timeout');
      } finally {
        jest.useRealTimers();
      }
    });

    it('clears a prior error entry when a subsequent fetch succeeds', async () => {
      mockGetAlbumInfo2.mockRejectedValueOnce(new Error('boom'));
      await albumInfoStore.getState().fetchAlbumInfo('a1');
      expect(albumInfoStore.getState().errors['a1']).toBe('error');

      mockGetAlbumInfo2.mockResolvedValueOnce(sampleAlbumInfo);
      await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');
      expect(albumInfoStore.getState().errors['a1']).toBeUndefined();
    });
  });

  describe('fetchAlbumInfo — Wikipedia enrichment', () => {
    it('enriches with Wikipedia when server returns no notes', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);
      mockGetAlbumDescription.mockResolvedValue({
        description: 'A Wikipedia article about the album.',
        url: 'https://en.wikipedia.org/wiki/Album',
      });

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(mockGetAlbumDescription).toHaveBeenCalledWith(
        'Artist', 'Album', 'mb-123', false, expect.any(AbortSignal),
      );
      expect(result?.enrichedNotes).toBe('A Wikipedia article about the album.');
      expect(result?.enrichedNotesUrl).toBe('https://en.wikipedia.org/wiki/Album');
    });

    it('enriches when server notes are empty HTML', async () => {
      mockGetAlbumInfo2.mockResolvedValue({ notes: '<p>  </p>' });
      mockGetAlbumDescription.mockResolvedValue({
        description: 'Wikipedia description.',
        url: 'https://en.wikipedia.org/wiki/Test',
      });

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(mockGetAlbumDescription).toHaveBeenCalled();
      expect(result?.enrichedNotes).toBe('Wikipedia description.');
    });

    it('does not enrich when no artist/album names provided', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1');

      expect(mockGetAlbumDescription).not.toHaveBeenCalled();
      expect(result?.enrichedNotes).toBeNull();
    });

    it('caches entry with null enrichment when Wikipedia returns nothing', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);
      mockGetAlbumDescription.mockResolvedValue(null);

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(result?.enrichedNotes).toBeNull();
      expect(result?.enrichedNotesUrl).toBeNull();
      expect(albumInfoStore.getState().entries['a1']).toBeDefined();
    });

    it('caches entry even when enrichment throws', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);
      mockGetAlbumDescription.mockRejectedValue(new Error('MusicBrainz down'));

      const result = await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(result?.enrichedNotes).toBeNull();
      expect(albumInfoStore.getState().entries['a1']).toBeDefined();
    });

    it('uses album MBID override instead of server MBID', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);
      mbidOverrideStore.setState({
        overrides: {
          'album:a1': { type: 'album', entityId: 'a1', entityName: 'Album', mbid: 'override-mbid' },
        },
      });
      mockGetAlbumDescription.mockResolvedValue({
        description: 'Description from override MBID.',
        url: 'https://en.wikipedia.org/wiki/Album',
      });

      await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(mockGetAlbumDescription).toHaveBeenCalledWith(
        'Artist', 'Album', 'override-mbid', true, expect.any(AbortSignal),
      );
    });

    it('falls back to server MBID when no album override exists', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfoNoNotes);
      mockGetAlbumDescription.mockResolvedValue(null);

      await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      expect(mockGetAlbumDescription).toHaveBeenCalledWith(
        'Artist', 'Album', 'mb-123', false, expect.any(AbortSignal),
      );
    });
  });

  describe('clearAlbumInfo', () => {
    it('removes all cached entries and loading flags', async () => {
      mockGetAlbumInfo2.mockResolvedValue(sampleAlbumInfo);
      await albumInfoStore.getState().fetchAlbumInfo('a1', 'Artist', 'Album');

      albumInfoStore.getState().clearAlbumInfo();

      expect(albumInfoStore.getState().entries).toEqual({});
      expect(albumInfoStore.getState().loading).toEqual({});
    });
  });
});
