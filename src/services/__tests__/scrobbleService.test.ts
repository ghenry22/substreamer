jest.mock('../subsonicService');
jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));
jest.mock('../../store/albumListsStore', () => ({
  albumListsStore: {
    getState: jest.fn(() => ({
      refreshRecentlyPlayed: jest.fn(),
    })),
  },
}));

import { completedScrobbleStore } from '../../store/completedScrobbleStore';
import { pendingScrobbleStore } from '../../store/pendingScrobbleStore';
import { scrobbleExclusionStore } from '../../store/scrobbleExclusionStore';
import { getApi } from '../subsonicService';
import {
  addCompletedScrobble,
  sendNowPlaying,
} from '../scrobbleService';

const mockGetApi = getApi as jest.Mock;

beforeEach(() => {
  pendingScrobbleStore.setState({ pendingScrobbles: [] });
  completedScrobbleStore.setState({ completedScrobbles: [], stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} } });
  scrobbleExclusionStore.setState({ excludedAlbums: {}, excludedArtists: {}, excludedPlaylists: {} });
  mockGetApi.mockReturnValue(null);
});

describe('addCompletedScrobble', () => {
  it('adds valid song to pending queue', () => {
    addCompletedScrobble({
      id: 's1',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
    } as any);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
    expect(pendingScrobbleStore.getState().pendingScrobbles[0].song.id).toBe('s1');
  });

  it('does nothing when song has no id', () => {
    addCompletedScrobble({ title: 'Song', artist: 'A' } as any);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('does nothing when song has no title', () => {
    addCompletedScrobble({ id: 's1', artist: 'A' } as any);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('does nothing when song is null', () => {
    addCompletedScrobble(null as any);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('does nothing when song is undefined', () => {
    addCompletedScrobble(undefined as any);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
  });

  it('stores the time as a number', () => {
    addCompletedScrobble({ id: 's1', title: 'X', artist: 'A' } as any);
    const pending = pendingScrobbleStore.getState().pendingScrobbles[0];
    expect(typeof pending.time).toBe('number');
    expect(pending.time).toBeGreaterThan(0);
  });
});

describe('sendNowPlaying', () => {
  it('does nothing when api is null', async () => {
    mockGetApi.mockReturnValue(null);
    await expect(sendNowPlaying({ id: 'track-1', title: 'T', isDir: false } as any)).resolves.toBeUndefined();
  });

  it('calls api.scrobble with submission=false', async () => {
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });
    await sendNowPlaying({ id: 'track-1', title: 'T', isDir: false } as any);
    expect(mockScrobble).toHaveBeenCalledWith({ id: 'track-1', submission: false });
  });

  it('swallows errors silently', async () => {
    const mockScrobble = jest.fn().mockRejectedValue(new Error('network'));
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });
    await expect(sendNowPlaying({ id: 'track-1', title: 'T', isDir: false } as any)).resolves.toBeUndefined();
  });
});

describe('processScrobbles (via addCompletedScrobble)', () => {
  it('submits pending scrobble to API and moves to completed', async () => {
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });

    addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A', duration: 100 } as any);

    // processScrobbles is async and fire-and-forget; wait for it
    await new Promise((r) => setTimeout(r, 50));

    expect(mockScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', submission: true }),
    );
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
  });

  it('retries once on first failure, succeeds on retry', async () => {
    const mockScrobble = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });

    addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A' } as any);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockScrobble).toHaveBeenCalledTimes(2);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(1);
  });

  it('stops processing on double failure, keeps scrobble pending', async () => {
    const mockScrobble = jest.fn().mockRejectedValue(new Error('fail'));
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });

    addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A' } as any);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockScrobble).toHaveBeenCalledTimes(2);
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
    expect(completedScrobbleStore.getState().completedScrobbles).toHaveLength(0);
  });

  it('skips scrobbles already in completed store', async () => {
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    mockGetApi.mockReturnValue({ scrobble: mockScrobble });

    // Add a scrobble to pending manually with a known ID
    pendingScrobbleStore.setState({
      pendingScrobbles: [{
        id: 'dup-1',
        song: { id: 's1', title: 'Song', artist: 'A' } as any,
        time: Date.now(),
      }],
    });
    // Also put the same ID in completed
    completedScrobbleStore.getState().addCompleted({
      id: 'dup-1',
      song: { id: 's1', title: 'Song', artist: 'A' } as any,
      time: Date.now(),
    });

    // Trigger processing by adding another scrobble
    addCompletedScrobble({ id: 's2', title: 'Song2', artist: 'B' } as any);
    await new Promise((r) => setTimeout(r, 50));

    // The duplicate should have been removed without calling scrobble for it
    const pending = pendingScrobbleStore.getState().pendingScrobbles;
    expect(pending.find((p) => p.id === 'dup-1')).toBeUndefined();
  });

  it('does nothing when api is null', async () => {
    mockGetApi.mockReturnValue(null);
    addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A' } as any);
    await new Promise((r) => setTimeout(r, 50));
    // Scrobble stays in pending since API is unavailable
    expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
  });
});

describe('initScrobbleService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('processes pending scrobbles immediately and sets up a timer', async () => {
    const intervalSpy = jest.spyOn(global, 'setInterval');

    jest.resetModules();
    const { pendingScrobbleStore: ps } = require('../../store/pendingScrobbleStore');
    const { completedScrobbleStore: cs } = require('../../store/completedScrobbleStore');
    const { getApi: ga } = require('../subsonicService');

    ps.setState({
      pendingScrobbles: [{
        id: 'init-1',
        song: { id: 's1', title: 'Song', artist: 'A' },
        time: Date.now(),
      }],
    });
    cs.setState({ completedScrobbles: [], stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} } });

    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    (ga as jest.Mock).mockReturnValue({ scrobble: mockScrobble });

    const { initScrobbleService: init } = require('../scrobbleService');
    init();

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    // Flush the async processScrobbles call
    await jest.advanceTimersByTimeAsync(0);

    expect(mockScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', submission: true }),
    );

    intervalSpy.mockRestore();
  });

  it('is idempotent — second call does not set up another timer', () => {
    jest.resetModules();
    const { initScrobbleService: init } = require('../scrobbleService');
    const intervalSpy = jest.spyOn(global, 'setInterval');

    init(); // first call
    intervalSpy.mockClear();

    init(); // second call — should be no-op
    expect(intervalSpy).not.toHaveBeenCalled();

    intervalSpy.mockRestore();
  });

  it('periodic timer triggers processScrobbles', async () => {
    jest.resetModules();

    const { pendingScrobbleStore: ps } = require('../../store/pendingScrobbleStore');
    const { completedScrobbleStore: cs } = require('../../store/completedScrobbleStore');
    const { getApi: ga } = require('../subsonicService');

    ps.setState({ pendingScrobbles: [] });
    cs.setState({ completedScrobbles: [], stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} } });
    (ga as jest.Mock).mockReturnValue(null);

    const { initScrobbleService: init } = require('../scrobbleService');
    init();

    // Add a pending scrobble and enable API after init
    ps.setState({
      pendingScrobbles: [{
        id: 'timer-1',
        song: { id: 's2', title: 'Song2', artist: 'B' },
        time: Date.now(),
      }],
    });
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    (ga as jest.Mock).mockReturnValue({ scrobble: mockScrobble });

    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's2', submission: true }),
    );
  });

  it('flushes pending queue when offline mode is disabled', async () => {
    jest.resetModules();

    const { pendingScrobbleStore: ps } = require('../../store/pendingScrobbleStore');
    const { completedScrobbleStore: cs } = require('../../store/completedScrobbleStore');
    const { getApi: ga } = require('../subsonicService');
    const { offlineModeStore: oms } = require('../../store/offlineModeStore');
    const { initScrobbleService: init } = require('../scrobbleService');

    ps.setState({ pendingScrobbles: [] });
    cs.setState({ completedScrobbles: [], stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} } });
    (ga as jest.Mock).mockReturnValue(null);

    init();
    await jest.advanceTimersByTimeAsync(0);

    // Set up a pending scrobble and enable API
    ps.setState({
      pendingScrobbles: [{
        id: 'offline-1',
        song: { id: 's3', title: 'Song3', artist: 'C' },
        time: Date.now(),
      }],
    });
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    (ga as jest.Mock).mockReturnValue({ scrobble: mockScrobble });

    // Simulate going offline then back online
    oms.setState({ offlineMode: true });
    oms.setState({ offlineMode: false });

    await jest.advanceTimersByTimeAsync(0);

    expect(mockScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's3', submission: true }),
    );
  });

  it('re-triggers processing when AppState returns to active (U17)', async () => {
    jest.resetModules();

    const { pendingScrobbleStore: ps } = require('../../store/pendingScrobbleStore');
    const { completedScrobbleStore: cs } = require('../../store/completedScrobbleStore');
    const { getApi: ga } = require('../subsonicService');
    const { AppState } = require('react-native');

    // Capture the AppState change handler that scrobbleService registers.
    let appStateHandler: ((next: string) => void) | undefined;
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((...args: unknown[]) => {
        const event = args[0] as string;
        const handler = args[1] as (next: string) => void;
        if (event === 'change') appStateHandler = handler;
        return { remove: jest.fn() } as any;
      });

    ps.setState({ pendingScrobbles: [] });
    cs.setState({ completedScrobbles: [], stats: { totalPlays: 0, totalListeningSeconds: 0, uniqueArtists: {} } });
    (ga as jest.Mock).mockReturnValue(null);

    const { initScrobbleService: init } = require('../scrobbleService');
    init();
    await jest.advanceTimersByTimeAsync(0);

    expect(appStateHandler).toBeDefined();

    // Queue a scrobble after init (simulating one that arrived while
    // backgrounded), then enable the API.
    ps.setState({
      pendingScrobbles: [{
        id: 'fg-1',
        song: { id: 's4', title: 'Song4', artist: 'D' },
        time: Date.now(),
      }],
    });
    const mockScrobble = jest.fn().mockResolvedValue(undefined);
    (ga as jest.Mock).mockReturnValue({ scrobble: mockScrobble });

    // Simulate the app returning to the foreground.
    appStateHandler!('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(mockScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's4', submission: true }),
    );

    // Background transitions are no-ops.
    mockScrobble.mockClear();
    appStateHandler!('background');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockScrobble).not.toHaveBeenCalled();

    addEventListenerSpy.mockRestore();
  });
});

describe('scrobble exclusions', () => {
  describe('sendNowPlaying', () => {
    it('skips API call when albumId is excluded', async () => {
      scrobbleExclusionStore.getState().addExclusion('album', 'al1', 'Excluded Album');
      const mockScrobble = jest.fn().mockResolvedValue(undefined);
      mockGetApi.mockReturnValue({ scrobble: mockScrobble });
      await sendNowPlaying({ id: 's1', title: 'T', albumId: 'al1', isDir: false } as any);
      expect(mockScrobble).not.toHaveBeenCalled();
    });

    it('skips API call when artistId is excluded', async () => {
      scrobbleExclusionStore.getState().addExclusion('artist', 'ar1', 'Excluded Artist');
      const mockScrobble = jest.fn().mockResolvedValue(undefined);
      mockGetApi.mockReturnValue({ scrobble: mockScrobble });
      await sendNowPlaying({ id: 's1', title: 'T', artistId: 'ar1', isDir: false } as any);
      expect(mockScrobble).not.toHaveBeenCalled();
    });

    it('skips API call when playlistId is excluded', async () => {
      scrobbleExclusionStore.getState().addExclusion('playlist', 'pl1', 'Sleep Playlist');
      const mockScrobble = jest.fn().mockResolvedValue(undefined);
      mockGetApi.mockReturnValue({ scrobble: mockScrobble });
      await sendNowPlaying({ id: 's1', title: 'T', isDir: false } as any, 'pl1');
      expect(mockScrobble).not.toHaveBeenCalled();
    });

    it('proceeds normally when no exclusions match', async () => {
      scrobbleExclusionStore.getState().addExclusion('album', 'al-other', 'Other Album');
      const mockScrobble = jest.fn().mockResolvedValue(undefined);
      mockGetApi.mockReturnValue({ scrobble: mockScrobble });
      await sendNowPlaying({ id: 's1', title: 'T', albumId: 'al1', isDir: false } as any);
      expect(mockScrobble).toHaveBeenCalledWith({ id: 's1', submission: false });
    });

    it('does not check playlist exclusion when playlistId not provided', async () => {
      scrobbleExclusionStore.getState().addExclusion('playlist', 'pl1', 'Sleep Playlist');
      const mockScrobble = jest.fn().mockResolvedValue(undefined);
      mockGetApi.mockReturnValue({ scrobble: mockScrobble });
      await sendNowPlaying({ id: 's1', title: 'T', isDir: false } as any);
      expect(mockScrobble).toHaveBeenCalled();
    });
  });

  describe('addCompletedScrobble', () => {
    it('does not add to pending store when excluded by album', () => {
      scrobbleExclusionStore.getState().addExclusion('album', 'al1', 'Excluded Album');
      addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A', albumId: 'al1' } as any);
      expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
    });

    it('does not add to pending store when excluded by artist', () => {
      scrobbleExclusionStore.getState().addExclusion('artist', 'ar1', 'Excluded Artist');
      addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A', artistId: 'ar1' } as any);
      expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
    });

    it('does not add to pending store when excluded by playlist', () => {
      scrobbleExclusionStore.getState().addExclusion('playlist', 'pl1', 'Sleep');
      addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A' } as any, 'pl1');
      expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(0);
    });

    it('adds normally when no exclusions match', () => {
      scrobbleExclusionStore.getState().addExclusion('album', 'al-other', 'Other');
      addCompletedScrobble({ id: 's1', title: 'Song', artist: 'A', albumId: 'al1' } as any);
      expect(pendingScrobbleStore.getState().pendingScrobbles).toHaveLength(1);
    });
  });
});
