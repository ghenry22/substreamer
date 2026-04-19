jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService');
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn().mockResolvedValue(undefined),
  cacheEntityCoverArt: jest.fn(),
}));

import { getPlaylist } from '../../services/subsonicService';
import { playlistDetailStore } from '../playlistDetailStore';

const mockGetPlaylist = getPlaylist as jest.MockedFunction<typeof getPlaylist>;

function makeEntry(songCount: number, duration: number, entries: Array<{ id: string; duration?: number }>) {
  return {
    playlist: {
      id: 'pl-1',
      name: 'Playlist',
      songCount,
      duration,
      changed: new Date(),
      created: new Date(),
      entry: entries.map((e) => ({ id: e.id, title: 'Song', isDir: false as const, duration: e.duration ?? 180 })),
    },
    retrievedAt: Date.now(),
  };
}

beforeEach(() => {
  playlistDetailStore.getState().clearPlaylists();
  mockGetPlaylist.mockReset();
});

describe('fetchPlaylist', () => {
  it('fetches and stores playlist data', async () => {
    const mockData = { id: 'pl-1', name: 'Test', songCount: 2, duration: 360, changed: new Date(), created: new Date(), entry: [{ id: 's1', title: 'Song 1', isDir: false as const }, { id: 's2', title: 'Song 2', isDir: false as const }] };
    mockGetPlaylist.mockResolvedValue(mockData);
    const result = await playlistDetailStore.getState().fetchPlaylist('pl-1');
    expect(result).toEqual(mockData);
    const stored = playlistDetailStore.getState().playlists['pl-1'];
    expect(stored).toBeDefined();
    expect(stored!.playlist).toEqual(mockData);
    expect(stored!.retrievedAt).toBeGreaterThan(0);
  });

  it('returns null and does not store when API returns null', async () => {
    mockGetPlaylist.mockResolvedValue(null);
    const result = await playlistDetailStore.getState().fetchPlaylist('pl-1');
    expect(result).toBeNull();
    expect(playlistDetailStore.getState().playlists['pl-1']).toBeUndefined();
  });

  it('overwrites existing entry on re-fetch', async () => {
    const old = makeEntry(1, 100, [{ id: 's1' }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': old } });
    const newData = { id: 'pl-1', name: 'Updated', songCount: 2, duration: 200, changed: new Date(), created: new Date(), entry: [{ id: 's1', title: 'Song 1', isDir: false as const }, { id: 's2', title: 'Song 2', isDir: false as const }] };
    mockGetPlaylist.mockResolvedValue(newData);
    await playlistDetailStore.getState().fetchPlaylist('pl-1');
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.name).toBe('Updated');
  });
});

describe('reorderTracks', () => {
  it('moves track within playlist', () => {
    const entry = makeEntry(3, 540, [
      { id: 's1' },
      { id: 's2' },
      { id: 's3' },
    ]);
    playlistDetailStore.setState({
      playlists: { 'pl-1': entry },
    });

    playlistDetailStore.getState().reorderTracks('pl-1', 0, 2);

    const updated = playlistDetailStore.getState().playlists['pl-1'];
    expect(updated!.playlist.entry!.map((e) => e.id)).toEqual(['s2', 's3', 's1']);
    expect(updated!.playlist.songCount).toBe(3);
  });

  it('does nothing when playlist not found', () => {
    playlistDetailStore.setState({ playlists: {} });
    playlistDetailStore.getState().reorderTracks('missing', 0, 1);
    expect(playlistDetailStore.getState().playlists['missing']).toBeUndefined();
  });
});

describe('reorderTracks edge cases', () => {
  it('is a no-op when fromIndex equals toIndex', () => {
    const entry = makeEntry(2, 360, [{ id: 's1' }, { id: 's2' }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().reorderTracks('pl-1', 0, 0);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.entry!.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('is a no-op for out-of-bounds fromIndex', () => {
    const entry = makeEntry(2, 360, [{ id: 's1' }, { id: 's2' }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().reorderTracks('pl-1', -1, 1);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.entry!.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('is a no-op for out-of-bounds toIndex', () => {
    const entry = makeEntry(2, 360, [{ id: 's1' }, { id: 's2' }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().reorderTracks('pl-1', 0, 99);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.entry!.map((e) => e.id)).toEqual(['s1', 's2']);
  });
});

describe('removeTrack', () => {
  it('removes track and updates songCount and duration', () => {
    const entry = makeEntry(3, 540, [
      { id: 's1', duration: 180 },
      { id: 's2', duration: 180 },
      { id: 's3', duration: 180 },
    ]);
    playlistDetailStore.setState({
      playlists: { 'pl-1': entry },
    });

    playlistDetailStore.getState().removeTrack('pl-1', 1);

    const updated = playlistDetailStore.getState().playlists['pl-1'];
    expect(updated!.playlist.entry!.map((e) => e.id)).toEqual(['s1', 's3']);
    expect(updated!.playlist.songCount).toBe(2);
    expect(updated!.playlist.duration).toBe(360);
  });

  it('does nothing when playlist not found', () => {
    playlistDetailStore.setState({ playlists: {} });
    playlistDetailStore.getState().removeTrack('missing', 0);
    expect(playlistDetailStore.getState().playlists['missing']).toBeUndefined();
  });

  it('is a no-op for out-of-bounds trackIndex', () => {
    const entry = makeEntry(1, 180, [{ id: 's1', duration: 180 }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().removeTrack('pl-1', 5);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.songCount).toBe(1);
  });

  it('is a no-op for negative trackIndex', () => {
    const entry = makeEntry(1, 180, [{ id: 's1', duration: 180 }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().removeTrack('pl-1', -1);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.songCount).toBe(1);
  });

  it('clamps duration to 0 when track duration exceeds total', () => {
    const entry = makeEntry(1, 50, [{ id: 's1', duration: 180 }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().removeTrack('pl-1', 0);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.duration).toBe(0);
  });

  it('handles track with undefined duration', () => {
    const entry = {
      playlist: {
        id: 'pl-1',
        name: 'Playlist',
        songCount: 2,
        duration: 180,
        changed: new Date(),
        created: new Date(),
        entry: [
          { id: 's1', title: 'Song', isDir: false as const, duration: 180 },
          { id: 's2', title: 'Song2', isDir: false as const },
        ],
      },
      retrievedAt: Date.now(),
    };
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().removeTrack('pl-1', 1);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.duration).toBe(180);
    expect(playlistDetailStore.getState().playlists['pl-1']!.playlist.songCount).toBe(1);
  });
});

describe('removePlaylist', () => {
  it('removes a playlist from cache', () => {
    const entry = makeEntry(1, 180, [{ id: 's1' }]);
    playlistDetailStore.setState({ playlists: { 'pl-1': entry } });
    playlistDetailStore.getState().removePlaylist('pl-1');
    expect(playlistDetailStore.getState().playlists['pl-1']).toBeUndefined();
  });

  it('is a no-op for nonexistent playlist', () => {
    playlistDetailStore.setState({ playlists: {} });
    playlistDetailStore.getState().removePlaylist('nonexistent');
    expect(Object.keys(playlistDetailStore.getState().playlists)).toHaveLength(0);
  });
});
