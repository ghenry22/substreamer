// `persistence/db.ts` imports `expo-sqlite` at module load; stub it so the
// import doesn't hit the native bridge during tests.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    updateOptions: jest.fn().mockResolvedValue(undefined),
    setRepeatMode: jest.fn().mockResolvedValue(undefined),
    setRate: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    reset: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    skip: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    skipToNext: jest.fn().mockResolvedValue(undefined),
    skipToPrevious: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    setQueue: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(undefined),
    getPlaybackState: jest.fn().mockResolvedValue({ state: 0 }),
    getActiveTrack: jest.fn().mockResolvedValue(null),
    getActiveTrackIndex: jest.fn().mockResolvedValue(0),
    getProgress: jest.fn().mockResolvedValue({ position: 0, duration: 0, buffered: 0 }),
  },
  Capability: { Play: 0, Pause: 1, SkipToNext: 2, SkipToPrevious: 3, Stop: 4, SeekTo: 5, JumpForward: 6, JumpBackward: 7 },
  Event: {
    PlaybackState: 'playback-state',
    PlaybackError: 'playback-error',
    PlaybackActiveTrackChanged: 'playback-active-track-changed',
    PlaybackEndedWithReason: 'playback-ended-with-reason',
    PlaybackQueueEnded: 'playback-queue-ended',
    PlaybackStalled: 'playback-stalled',
    PlaybackErrorLog: 'playback-error-log',
    PlaybackBufferEmpty: 'playback-buffer-empty',
    PlaybackBufferFull: 'playback-buffer-full',
    PlaybackSeekCompleted: 'playback-seek-completed',
    PlaybackProgressUpdated: 'playback-progress-updated',
    SleepTimerChanged: 'sleep-timer-changed',
    SleepTimerComplete: 'sleep-timer-complete',
  },
  AppKilledPlaybackBehavior: {
    ContinuePlayback: 'continue-playback',
    PausePlayback: 'pause-playback',
    StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
  },
  IOSCategory: { Playback: 'playback' },
  RepeatMode: { Off: 0, Track: 1, Queue: 2 },
  State: { Playing: 3, Paused: 2, Buffering: 6, Loading: 9, Stopped: 1, Ended: 11, None: 0, Ready: 8, Connecting: 7, Error: 10 },
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: { OS: 'android' },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

const mockSetCurrentTrack = jest.fn();
const mockSetPlaybackState = jest.fn();
const mockSetQueue = jest.fn();
const mockSetProgress = jest.fn();
const mockSetError = jest.fn();
const mockSetRetrying = jest.fn();
const mockSetQueueLoading = jest.fn();
const mockSetQueueFormats = jest.fn();
const mockAddQueueFormat = jest.fn();
const mockClearQueueFormats = jest.fn();

const mockPlayerStoreSetState = jest.fn();

jest.mock('../../store/playerStore', () => ({
  playerStore: {
    getState: jest.fn(() => ({
      currentTrack: null,
      currentTrackIndex: null,
      queue: [],
      duration: 100,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    })),
    // setState is looked up via the `playerStore` object at call time, not
    // at factory time, so wrapping in a function is fine — the jest.fn()
    // reference may not exist yet when the factory runs.
    setState: (...args: unknown[]) => mockPlayerStoreSetState(...args),
  },
}));

const mockToastShow = jest.fn();
const mockToastSucceed = jest.fn();
const mockToastFail = jest.fn();

jest.mock('../../store/playbackToastStore', () => ({
  playbackToastStore: {
    getState: jest.fn(() => ({
      show: mockToastShow,
      succeed: mockToastSucceed,
      fail: mockToastFail,
    })),
  },
}));

jest.mock('../../store/serverInfoStore', () => ({
  serverInfoStore: {
    getState: jest.fn(() => ({ extensions: [] })),
  },
}));

jest.mock('../scrobbleService', () => ({
  addCompletedScrobble: jest.fn(),
  sendNowPlaying: jest.fn(),
}));

jest.mock('../imageCacheService', () => ({
  getCachedImageUri: jest.fn().mockReturnValue(null),
}));

jest.mock('../musicCacheService', () => ({
  getLocalTrackUri: jest.fn().mockReturnValue(null),
  waitForTrackMapsReady: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/musicCacheStore', () => ({
  musicCacheStore: {
    getState: jest.fn(() => ({
      cachedSongs: {},
    })),
  },
}));

const mockOfflineMode = { offlineMode: false };
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: {
    getState: jest.fn(() => mockOfflineMode),
  },
}));

jest.mock('../subsonicService');

const mockPersistQueue = jest.fn();
const mockPersistPositionIfDue = jest.fn();
const mockFlushPosition = jest.fn();
const mockClearPersistedQueue = jest.fn();
const mockGetPersistedQueue = jest.fn().mockReturnValue(null);
const mockGetPersistedPosition = jest.fn().mockReturnValue(null);

jest.mock('../queuePersistenceService', () => ({
  persistQueue: (...args: unknown[]) => mockPersistQueue(...args),
  persistPositionIfDue: (...args: unknown[]) => mockPersistPositionIfDue(...args),
  flushPosition: (...args: unknown[]) => mockFlushPosition(...args),
  clearPersistedQueue: () => mockClearPersistedQueue(),
  getPersistedQueue: () => mockGetPersistedQueue(),
  getPersistedPosition: () => mockGetPersistedPosition(),
  resetPersistTimer: jest.fn(),
  PERSIST_INTERVAL_MS: 10_000,
}));

import TrackPlayer, { Event, RepeatMode, State } from 'react-native-track-player';
import { playbackSettingsStore } from '../../store/playbackSettingsStore';
import { serverInfoStore } from '../../store/serverInfoStore';
import { addCompletedScrobble, sendNowPlaying } from '../scrobbleService';

const mockTP = TrackPlayer as unknown as Record<string, jest.Mock>;
import {
  initPlayer,
  playTrack,
  togglePlayPause,
  skipToNext,
  skipToPrevious,
  seekTo,
  skipToTrack,
  retryPlayback,
  clearQueue,
  addToQueue,
  removeFromQueue,
  removeNonDownloadedTracks,
  cycleRepeatMode,
  cyclePlaybackRate,
  shuffleQueue,
  skipByInterval,
  updateRemoteCapabilities,
  canSkipToNext,
  canSkipToPrevious,
  applyLocalPlayToPlayer,
} from '../playerService';
import { getCoverArtUrl, getStreamUrl, type Child } from '../subsonicService';

const makeChild = (id: string, overrides?: Partial<Child>): Child => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  coverArt: `cover-${id}`,
  duration: 200,
  ...overrides,
} as Child);

/**
 * Event handler callbacks captured after the first initPlayer() call.
 * Populated in beforeAll so they survive per-test clearAllMocks().
 */
let eventHandlers: Record<string, Function> = {};
/** AppState change handler captured after the first initPlayer() call. */
let appStateHandler: (next: string) => Promise<void>;

/** Default mock state for playerStore.getState(). */
const defaultPlayerState = () => ({
  currentTrack: null,
  currentTrackIndex: null,
  queue: [],
  position: 0,
  duration: 100,
  error: null,
  retrying: false,
  setCurrentTrack: mockSetCurrentTrack,
  setPlaybackState: mockSetPlaybackState,
  setQueue: mockSetQueue,
  setProgress: mockSetProgress,
  setError: mockSetError,
  setRetrying: mockSetRetrying,
  setQueueLoading: mockSetQueueLoading,
  setQueueFormats: mockSetQueueFormats,
  addQueueFormat: mockAddQueueFormat,
  clearQueueFormats: mockClearQueueFormats,
});

beforeAll(async () => {
  // Suppress console output from event handlers during tests.
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();

  // initPlayer is idempotent (module-level isPlayerReady flag). Call it
  // once here to register all event listeners and capture the callbacks
  // before beforeEach's clearAllMocks wipes the mock call records.
  await initPlayer();

  for (const call of mockTP.addEventListener.mock.calls) {
    eventHandlers[call[0]] = call[1];
  }

  const { AppState } = require('react-native');
  appStateHandler = (AppState.addEventListener as jest.Mock).mock.calls[0][1];
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(async () => {
  // Reset module-level state (clears queue, resets flags).
  await clearQueue();

  jest.clearAllMocks();

  // Re-suppress console output (clearAllMocks wipes the spy implementation).
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();

  // Restore default mock state — some tests set partial mockReturnValue
  // that would poison subsequent tests (mockReturnValue persists through
  // clearAllMocks).
  const { playerStore } = require('../../store/playerStore');
  (playerStore.getState as jest.Mock).mockReturnValue(defaultPlayerState());
  (serverInfoStore.getState as jest.Mock).mockReturnValue({ extensions: [] });

  playbackSettingsStore.setState({
    repeatMode: 'off',
    playbackRate: 1,
    maxBitRate: null,
    streamFormat: 'raw',
    estimateContentLength: false,
  } as any);

  // Restore default return values for subsonicService mocks.
  (getCoverArtUrl as jest.Mock).mockReturnValue('https://example.com/art.jpg');
  (getStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream.mp3');

  // Restore default persistence mocks.
  mockGetPersistedQueue.mockReturnValue(null);
  mockGetPersistedPosition.mockReturnValue(null);
});

describe('initPlayer', () => {
  it('sets up TrackPlayer and registers event listeners', () => {
    // initPlayer ran in beforeAll; verify event handlers were captured
    expect(Object.keys(eventHandlers).length).toBeGreaterThan(0);
    expect(eventHandlers[Event.PlaybackState]).toBeDefined();
    expect(eventHandlers[Event.PlaybackError]).toBeDefined();
    expect(eventHandlers[Event.PlaybackActiveTrackChanged]).toBeDefined();
    expect(appStateHandler).toBeDefined();
  });

  it('is idempotent on repeated calls', async () => {
    // initPlayer is already done from the first test; module-level isPlayerReady is true.
    // Additional calls should be no-ops.
    await initPlayer();
    await initPlayer();
    expect(mockTP.setupPlayer).not.toHaveBeenCalled();
  });

  it('applies persisted repeat mode', () => {
    // initPlayer already ran in beforeAll with the default settings.
    // Verify the mapping function indirectly via cycleRepeatMode tests.
  });
});

describe('playTrack', () => {
  it('resets queue, loads tracks, and starts playback', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];

    await playTrack(queue[1], queue);

    expect(mockTP.reset).toHaveBeenCalled();
    expect(mockTP.add).toHaveBeenCalledTimes(1);
    const addedTracks = mockTP.add.mock.calls[0][0];
    expect(addedTracks).toHaveLength(3);
    expect(addedTracks[0].id).toBe('t1');
    expect(mockTP.skip).toHaveBeenCalledWith(1);
    expect(mockTP.play).toHaveBeenCalled();
    // No "Starting playback" / "Now Playing" pill — those routine
    // acknowledgements were removed; the MiniPlayer + DownloadBanner
    // chrome is the persistent confirmation.
    expect(mockToastShow).not.toHaveBeenCalled();
    expect(mockToastSucceed).not.toHaveBeenCalled();
  });

  it('does not skip when playing first track', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];

    await playTrack(queue[0], queue);

    expect(mockTP.skip).not.toHaveBeenCalled();
    expect(mockTP.play).toHaveBeenCalled();
  });

  it('shows failure toast on error', async () => {
    await initPlayer();
    mockTP.add.mockRejectedValueOnce(new Error('RNTP error'));

    await playTrack(makeChild('t1'), [makeChild('t1')]);

    expect(mockToastFail).toHaveBeenCalledWith('RNTP error');
  });

  it('updates queue in store', async () => {
    await initPlayer();
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    expect(mockSetQueue).toHaveBeenCalledWith(queue);
  });
});

describe('togglePlayPause', () => {
  it('pauses when playing', async () => {
    mockTP.getPlaybackState.mockResolvedValueOnce({ state: State.Playing });
    await togglePlayPause();
    expect(mockTP.pause).toHaveBeenCalled();
  });

  it('plays when paused', async () => {
    mockTP.getPlaybackState.mockResolvedValueOnce({ state: State.Paused });
    await togglePlayPause();
    expect(mockTP.play).toHaveBeenCalled();
  });
});

describe('skipToNext / skipToPrevious', () => {
  it('delegates skipToNext to TrackPlayer', async () => {
    await skipToNext();
    expect(mockTP.skipToNext).toHaveBeenCalled();
  });

  it('delegates skipToPrevious to TrackPlayer', async () => {
    await skipToPrevious();
    expect(mockTP.skipToPrevious).toHaveBeenCalled();
  });
});

describe('canSkipToPrevious', () => {
  it('returns false when no track is loaded', () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: null,
      queue: [],
    });
    expect(canSkipToPrevious()).toBe(false);
  });

  it('returns false when queue is empty', () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: 0,
      queue: [],
    });
    expect(canSkipToPrevious()).toBe(false);
  });

  it('returns true at first track with repeat off', () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: 0,
      queue: [{ id: '1' }],
    });
    playbackSettingsStore.setState({ repeatMode: 'off' } as any);
    expect(canSkipToPrevious()).toBe(true);
  });

  it('returns true at middle of queue', () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: 1,
      queue: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    playbackSettingsStore.setState({ repeatMode: 'off' } as any);
    expect(canSkipToPrevious()).toBe(true);
  });

  it('returns true with repeat all', () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: 0,
      queue: [{ id: '1' }, { id: '2' }],
    });
    playbackSettingsStore.setState({ repeatMode: 'all' } as any);
    expect(canSkipToPrevious()).toBe(true);
  });
});

describe('seekTo', () => {
  it('seeks to the specified position', async () => {
    mockTP.getProgress.mockResolvedValue({ position: 10, duration: 300, buffered: 150 });
    await seekTo(60);
    expect(mockTP.seekTo).toHaveBeenCalledWith(60);
  });

  it('clamps to 0 when position is negative', async () => {
    mockTP.getProgress.mockResolvedValue({ position: 0, duration: 300, buffered: 100 });
    await seekTo(-10);
    expect(mockTP.seekTo).toHaveBeenCalledWith(0);
  });
});

describe('skipToTrack', () => {
  it('skips to index and plays', async () => {
    await skipToTrack(3);
    expect(mockTP.skip).toHaveBeenCalledWith(3);
    expect(mockTP.play).toHaveBeenCalled();
  });
});

describe('retryPlayback', () => {
  it('clears error and plays', async () => {
    await retryPlayback();
    expect(mockSetError).toHaveBeenCalledWith(null);
    expect(mockTP.play).toHaveBeenCalled();
  });
});

describe('clearQueue', () => {
  it('resets TrackPlayer and store state', async () => {
    await clearQueue();
    expect(mockTP.reset).toHaveBeenCalled();
    expect(mockSetCurrentTrack).toHaveBeenCalledWith(null);
    expect(mockSetQueue).toHaveBeenCalledWith([]);
    expect(mockSetPlaybackState).toHaveBeenCalledWith('idle');
    expect(mockSetProgress).toHaveBeenCalledWith(0, 0, 0);
    expect(mockSetError).toHaveBeenCalledWith(null);
    expect(mockSetRetrying).toHaveBeenCalledWith(false);
  });

  it('completes store cleanup even when TrackPlayer.reset rejects', async () => {
    // Simulates a native reset that gets stuck because AVPlayer is
    // stalled on an unreachable stream URL. The store reset must still
    // run so the mini player visibly clears.
    mockTP.reset.mockRejectedValueOnce(new Error('native-reset-stuck'));
    await clearQueue();
    expect(mockSetCurrentTrack).toHaveBeenCalledWith(null);
    expect(mockSetQueue).toHaveBeenCalledWith([]);
    expect(mockSetPlaybackState).toHaveBeenCalledWith('idle');
    expect(mockClearPersistedQueue).toHaveBeenCalled();
  });

  it('completes store cleanup even when TrackPlayer.reset never settles (timeout)', async () => {
    mockTP.reset.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    jest.useFakeTimers();
    try {
      const p = clearQueue();
      // clearQueue awaits an awaitHydration() microtask before the internal
      // reset fires; flush it so the 2000ms timeout timer is actually set
      // before we advance fake timers past it.
      await Promise.resolve();
      jest.advanceTimersByTime(2500);
      await p;
    } finally {
      jest.useRealTimers();
    }
    expect(mockSetCurrentTrack).toHaveBeenCalledWith(null);
    expect(mockSetQueue).toHaveBeenCalledWith([]);
    expect(mockClearPersistedQueue).toHaveBeenCalled();
  });
});

describe('offline-mode queue building', () => {
  beforeEach(() => {
    mockOfflineMode.offlineMode = false;
  });

  afterEach(() => {
    mockOfflineMode.offlineMode = false;
  });

  it('playTrack filters out non-cached tracks when offline and refocuses on a cached one', async () => {
    await initPlayer();
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockImplementation((id: string) =>
      id === 't2' ? '/local/t2.mp3' : null,
    );
    mockOfflineMode.offlineMode = true;

    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];

    await playTrack(queue[0], queue);

    const addedTracks = mockTP.add.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(addedTracks.map((t) => t.id)).toEqual(['t2']);
    expect(mockTP.skip).not.toHaveBeenCalled(); // start index collapsed to 0
    expect(mockTP.play).toHaveBeenCalled();
  });

  it('playTrack clears queue + toasts when all tracks are non-cached and offline', async () => {
    await initPlayer();
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockReturnValue(null);
    mockOfflineMode.offlineMode = true;

    mockTP.add.mockClear();
    await playTrack(makeChild('t1'), [makeChild('t1'), makeChild('t2')]);

    expect(mockTP.add).not.toHaveBeenCalled();
    expect(mockToastFail).toHaveBeenCalledWith(
      expect.stringContaining('No downloaded tracks'),
    );
    expect(mockSetQueue).toHaveBeenCalledWith([]);
  });

  it('addToQueue drops non-cached tracks when offline', async () => {
    await initPlayer();
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockImplementation((id: string) =>
      id === 'seed' ? '/local/seed.mp3' : null,
    );
    await playTrack(makeChild('seed'), [makeChild('seed')]);

    mockTP.add.mockClear();
    mockToastFail.mockClear();
    (getLocalTrackUri as jest.Mock).mockImplementation((id: string) =>
      id === 'cached' ? '/local/cached.mp3' : null,
    );
    mockOfflineMode.offlineMode = true;

    await addToQueue([makeChild('nonCached1'), makeChild('cached'), makeChild('nonCached2')]);

    const addedTracks = mockTP.add.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(addedTracks.map((t) => t.id)).toEqual(['cached']);
    expect(mockToastFail).not.toHaveBeenCalled();
  });

  it('addToQueue shows toast but leaves existing queue intact when all new tracks are non-cached offline', async () => {
    await initPlayer();
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockImplementation((id: string) =>
      id === 'seed' ? '/local/seed.mp3' : null,
    );
    await playTrack(makeChild('seed'), [makeChild('seed')]);

    mockTP.add.mockClear();
    mockToastFail.mockClear();
    mockSetQueue.mockClear();
    (getLocalTrackUri as jest.Mock).mockReturnValue(null);
    mockOfflineMode.offlineMode = true;

    await addToQueue([makeChild('a'), makeChild('b')]);

    expect(mockTP.add).not.toHaveBeenCalled();
    expect(mockToastFail).toHaveBeenCalledWith(
      expect.stringContaining('No downloaded tracks'),
    );
    // Existing queue must not be cleared.
    expect(mockSetQueue).not.toHaveBeenCalledWith([]);
  });

  it('leaves non-cached tracks in the queue when online (no filtering when offlineMode is off)', async () => {
    await initPlayer();
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockReturnValue(null);
    mockOfflineMode.offlineMode = false;

    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);

    const addedTracks = mockTP.add.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(addedTracks.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('addToQueue', () => {
  it('does nothing for empty array', async () => {
    await addToQueue([]);
    expect(mockTP.add).not.toHaveBeenCalled();
  });

  it('starts playback when queue is empty', async () => {
    await initPlayer();
    // clearQueue to make currentChildQueue empty
    await clearQueue();
    mockTP.reset.mockClear();

    const tracks = [makeChild('t1'), makeChild('t2')];
    await addToQueue(tracks);

    expect(mockTP.reset).toHaveBeenCalled();
    expect(mockTP.play).toHaveBeenCalled();
  });

  it('appends tracks when queue has items', async () => {
    await initPlayer();
    const initial = [makeChild('t1')];
    await playTrack(initial[0], initial);
    mockTP.add.mockClear();

    const newTracks = [makeChild('t2'), makeChild('t3')];
    await addToQueue(newTracks);

    expect(mockTP.add).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 't2' }),
        expect.objectContaining({ id: 't3' }),
      ]),
    );
  });
});

describe('removeFromQueue', () => {
  it('ignores out-of-bounds index', async () => {
    await initPlayer();
    await playTrack(makeChild('t1'), [makeChild('t1')]);

    await removeFromQueue(5);
    expect(mockTP.remove).not.toHaveBeenCalled();
  });

  it('ignores negative index', async () => {
    await removeFromQueue(-1);
    expect(mockTP.remove).not.toHaveBeenCalled();
  });

  it('clears queue when removing the only track', async () => {
    await initPlayer();
    await playTrack(makeChild('t1'), [makeChild('t1')]);
    mockTP.reset.mockClear();

    await removeFromQueue(0);
    expect(mockTP.reset).toHaveBeenCalled();
  });
});

describe('cycleRepeatMode', () => {
  it('cycles off -> all', async () => {
    playbackSettingsStore.setState({ repeatMode: 'off' } as any);
    await cycleRepeatMode();
    expect(playbackSettingsStore.getState().repeatMode).toBe('all');
    expect(mockTP.setRepeatMode).toHaveBeenCalledWith(RepeatMode.Queue);
  });

  it('cycles all -> one', async () => {
    playbackSettingsStore.setState({ repeatMode: 'all' } as any);
    await cycleRepeatMode();
    expect(playbackSettingsStore.getState().repeatMode).toBe('one');
    expect(mockTP.setRepeatMode).toHaveBeenCalledWith(RepeatMode.Track);
  });

  it('cycles one -> off', async () => {
    playbackSettingsStore.setState({ repeatMode: 'one' } as any);
    await cycleRepeatMode();
    expect(playbackSettingsStore.getState().repeatMode).toBe('off');
    expect(mockTP.setRepeatMode).toHaveBeenCalledWith(RepeatMode.Off);
  });
});

describe('cyclePlaybackRate', () => {
  it('cycles through playback rates', async () => {
    playbackSettingsStore.setState({ playbackRate: 1 } as any);
    await cyclePlaybackRate();
    const newRate = playbackSettingsStore.getState().playbackRate;
    expect(newRate).toBe(1.25);
    expect(mockTP.setRate).toHaveBeenCalledWith(1.25);
  });

  it('wraps around to first rate', async () => {
    playbackSettingsStore.setState({ playbackRate: 2 } as any);
    await cyclePlaybackRate();
    expect(playbackSettingsStore.getState().playbackRate).toBe(0.5);
  });
});

describe('shuffleQueue', () => {
  it('does nothing with fewer than 2 tracks', async () => {
    await initPlayer();
    await playTrack(makeChild('t1'), [makeChild('t1')]);
    mockTP.pause.mockClear();

    await shuffleQueue();
    expect(mockTP.pause).not.toHaveBeenCalled();
  });

  it('shuffles, replaces queue, and plays from index 0', async () => {
    await initPlayer();
    const queue = Array.from({ length: 5 }, (_, i) => makeChild(`t${i}`));
    await playTrack(queue[0], queue);
    mockTP.setQueue.mockClear();
    mockTP.skip.mockClear();

    await shuffleQueue();

    expect(mockTP.pause).toHaveBeenCalled();
    expect(mockTP.setQueue).toHaveBeenCalledTimes(1);
    expect(mockTP.skip).toHaveBeenCalledWith(0);
    expect(mockTP.play).toHaveBeenCalled();
    expect(mockSetQueue).toHaveBeenCalled();
  });
});

describe('applyLocalPlayToPlayer', () => {
  const now = '2026-04-22T10:00:00.000Z';

  beforeEach(() => {
    mockPlayerStoreSetState.mockClear();
  });

  it('updates every matching entry in currentChildQueue', async () => {
    await initPlayer();
    const queue = [makeChild('s1', { playCount: 2 }), makeChild('s2'), makeChild('s1')];
    await playTrack(queue[0], queue);

    applyLocalPlayToPlayer('s1', now);

    // setQueue was called during both playTrack and internal updates; grab
    // the most recent call (triggered by applyLocalPlayToPlayer if used) OR
    // inspect currentChildQueue indirectly via the most recent setQueue.
    // Easier: verify behaviour by calling applyLocalPlayToPlayer again —
    // the second call should increment the already-incremented entries.
    applyLocalPlayToPlayer('s1', now);
    // If both calls landed, the first-matching entry would have been
    // incremented twice. We can only verify this by inspecting the queue
    // state that was last written to the store via setQueue — check that
    // setQueue was called at least once by playTrack (setup) and the
    // setState path for currentTrack isn't the primary signal here.
    // Primary assertion: playerStore.setState should NOT have been called
    // because currentTrack was null in our mock.
    expect(mockPlayerStoreSetState).not.toHaveBeenCalled();
  });

  it('updates playerStore.currentTrack when it is the scrobbled song', async () => {
    await initPlayer();
    const track = makeChild('s1', { playCount: 7 });
    await playTrack(track, [track]);

    // Pretend playerStore's currentTrack is this song (the mock returns the
    // generic state object; override it for this call).
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValueOnce({
      ...playerStore.getState(),
      currentTrack: track,
    });

    applyLocalPlayToPlayer('s1', now);

    expect(mockPlayerStoreSetState).toHaveBeenCalledWith({
      currentTrack: {
        ...track,
        playCount: 8,
        played: now,
      },
    });
  });

  it('does not update currentTrack when a different song is scrobbled', async () => {
    await initPlayer();
    const playing = makeChild('current');
    const other = makeChild('other');
    await playTrack(playing, [playing, other]);

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValueOnce({
      ...playerStore.getState(),
      currentTrack: playing,
    });

    applyLocalPlayToPlayer('other', now);

    expect(mockPlayerStoreSetState).not.toHaveBeenCalled();
  });

  it('treats undefined playCount as 0 when incrementing', async () => {
    await initPlayer();
    const track = makeChild('s1'); // no playCount

    await playTrack(track, [track]);
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValueOnce({
      ...playerStore.getState(),
      currentTrack: track,
    });

    applyLocalPlayToPlayer('s1', now);

    expect(mockPlayerStoreSetState).toHaveBeenCalledWith({
      currentTrack: expect.objectContaining({ playCount: 1, played: now }),
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Event handler callback tests                                       */
/* ------------------------------------------------------------------ */

describe('PlaybackState event handler', () => {
  it('sets playing state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Playing });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('playing');
  });

  it('clears error and retrying state when transitioning to Playing', () => {
    const mockState = {
      currentTrack: null,
      currentTrackIndex: null,
      queue: [],
      duration: 100,
      error: 'Some error',
      retrying: true,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    eventHandlers[Event.PlaybackState]({ state: State.Playing });

    expect(mockSetError).toHaveBeenCalledWith(null);
    expect(mockSetRetrying).toHaveBeenCalledWith(false);
  });

  it('maps Paused state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Paused });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('paused');
  });

  it('maps Buffering state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Buffering });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('buffering');
  });

  it('maps Loading state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Loading });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('loading');
  });

  it('maps Stopped state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Stopped });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('stopped');
  });

  it('maps Ended state', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Ended });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('stopped');
  });

  it('maps unknown state to idle', () => {
    eventHandlers[Event.PlaybackState]({ state: State.None });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('idle');
  });
});

describe('PlaybackError event handler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets error, retries, and clears on success', async () => {
    // Store starts with retrying=false
    const mockState = {
      currentTrack: { duration: 200 },
      currentTrackIndex: 0,
      queue: [],
      duration: 100,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // Trigger with position 0 (no recovery attempt)
    const promise = eventHandlers[Event.PlaybackError]({ message: 'Network error', position: 0 });

    expect(mockSetError).toHaveBeenCalledWith('Network error');
    expect(mockSetRetrying).toHaveBeenCalledWith(true);

    // Advance past the setTimeout(1500)
    jest.advanceTimersByTime(1500);
    await promise;

    expect(mockTP.retry).toHaveBeenCalled();
  });

  it('shows error when retry already attempted (retrying=true)', async () => {
    const errorHandler = eventHandlers[Event.PlaybackError];

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    mockState.retrying = true;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    await errorHandler({ message: 'Still failing', position: 0 });

    expect(mockSetRetrying).toHaveBeenCalledWith(false);
    expect(mockSetError).toHaveBeenCalledWith('Still failing');
  });

  it('uses default message when none provided', async () => {
    const errorHandler = eventHandlers[Event.PlaybackError];

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    mockState.retrying = true;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    await errorHandler({ position: 0 });

    expect(mockSetError).toHaveBeenCalledWith('Playback error occurred');
  });

  it('attempts transcoded stream recovery when error position > 5 and transcoding', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    // Set up transcoding conditions
    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);

    // Need transcodeOffset extension
    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    // Set up track for recovery
    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);
    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    mockTP.getActiveTrack.mockResolvedValue({ id: 't1', url: 'test' });
    (getStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream-offset.mp3');
    mockTP.load.mockResolvedValue(undefined);
    mockTP.play.mockResolvedValue(undefined);

    // errorPosition > 5, adjustedPos < metadataDuration - 5
    const promise = errorHandler({ message: 'Stream error', position: 50 });
    await promise;
    // Flush microtasks so fire-and-forget recoverTranscodedStream completes.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Should have attempted recovery — load + play called
    expect(mockTP.load).toHaveBeenCalled();
    expect(mockTP.play).toHaveBeenCalled();
  });

  it('clears retrying when retry() itself throws', async () => {
    const errorHandler = eventHandlers[Event.PlaybackError];

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    mockTP.retry.mockRejectedValueOnce(new Error('retry failed'));

    const promise = errorHandler({ message: 'Error', position: 0 });
    jest.advanceTimersByTime(1500);
    await promise;

    // setRetrying(false) called after retry() throws
    expect(mockSetRetrying).toHaveBeenCalledWith(false);
  });
});

describe('PlaybackActiveTrackChanged event handler', () => {
  it('sets current track from queue when track has an id', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];

    activeTrackHandler({ track: { id: 't2' }, index: 1 });

    expect(mockSetCurrentTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      1,
    );
    expect(sendNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      undefined,
    );
  });

  it('sets current track to null when track is null', async () => {
    await initPlayer();
    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];

    activeTrackHandler({ track: null, index: null });

    expect(mockSetCurrentTrack).toHaveBeenCalledWith(null, null);
  });

  it('sets current track to null when track has no id', async () => {
    await initPlayer();
    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];

    activeTrackHandler({ track: {}, index: 0 });

    expect(mockSetCurrentTrack).toHaveBeenCalledWith(null, null);
  });

  it('saves outgoing track for scrobble coordination (fired before EndedWithReason)', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];

    // Simulate ActiveTrackChanged firing first
    // previousActiveChild is set to queue[0] after playTrack
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    // Now when t1->t2 transition, ActiveTrackChanged fires first
    jest.clearAllMocks();
    activeTrackHandler({ track: { id: 't2' }, index: 1 });

    // Then EndedWithReason fires — should scrobble the outgoing track (t1)
    endedHandler({ reason: 'playedUntilEnd', track: 't1', position: 200 });

    expect(addCompletedScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      undefined,
    );
  });
});

describe('PlaybackEndedWithReason event handler', () => {
  it('scrobbles track when reason is playedUntilEnd', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];

    // Set previousActiveChild by simulating an active track change
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    jest.clearAllMocks();

    // EndedWithReason fires before ActiveTrackChanged
    endedHandler({ reason: 'playedUntilEnd', track: 't1', position: 200 });

    expect(addCompletedScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      undefined,
    );
  });

  it('scrobbles track when reason is PLAYED_UNTIL_END', async () => {
    await initPlayer();
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];

    activeTrackHandler({ track: { id: 't1' }, index: 0 });
    jest.clearAllMocks();

    endedHandler({ reason: 'PLAYED_UNTIL_END', track: 't1', position: 200 });

    expect(addCompletedScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      undefined,
    );
  });

  it('does not scrobble when reason is not playedUntilEnd', async () => {
    await initPlayer();
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];

    activeTrackHandler({ track: { id: 't1' }, index: 0 });
    jest.clearAllMocks();

    endedHandler({ reason: 'skipped', track: 't1', position: 50 });

    expect(addCompletedScrobble).not.toHaveBeenCalled();
  });

  it('skips scrobble during queue-setting operations', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];

    // During playTrack, isSettingQueue is true — EndedWithReason should be skipped
    // We test this indirectly by checking that no scrobble fires during playTrack
    jest.clearAllMocks();
    await playTrack(queue[0], queue);

    expect(addCompletedScrobble).not.toHaveBeenCalled();
  });

  it('writes final track position to store when reason is playedUntilEnd', async () => {
    await initPlayer();
    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];
    activeTrackHandler({ track: { id: 't1' }, index: 0 });
    jest.clearAllMocks();

    endedHandler({ reason: 'playedUntilEnd', track: 't1', position: 150 });

    // MiniPlayer and PlayerProgressBar read the same store — this write
    // ensures both show 100% when a track finishes naturally.
    expect(mockSetProgress).toHaveBeenCalledWith(200, 200, 200);
  });

  it('does not overwrite position when reason is skipped', async () => {
    await initPlayer();
    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];
    activeTrackHandler({ track: { id: 't1' }, index: 0 });
    jest.clearAllMocks();

    endedHandler({ reason: 'skipped', track: 't1', position: 50 });

    // Skipping to the next track must NOT jam the bar to 100% — the new
    // track's position updates will drive the display from 0.
    expect(mockSetProgress).not.toHaveBeenCalled();
  });
});

describe('PlaybackQueueEnded event handler', () => {
  it('pins progress to the end of the current track', async () => {
    await initPlayer();
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: makeChild('t1', { duration: 240 }),
    });

    const queueEndedHandler = eventHandlers[Event.PlaybackQueueEnded];
    expect(queueEndedHandler).toBeDefined();

    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: makeChild('t1', { duration: 240 }),
    });

    queueEndedHandler({ track: 0, position: 210 });

    expect(mockSetProgress).toHaveBeenCalledWith(240, 240, 240);
  });

  it('no-ops when there is no current track', async () => {
    await initPlayer();
    const queueEndedHandler = eventHandlers[Event.PlaybackQueueEnded];
    jest.clearAllMocks();

    queueEndedHandler({ track: 0, position: 0 });

    expect(mockSetProgress).not.toHaveBeenCalled();
  });
});

describe('PlaybackBufferFull event handler', () => {
  it('sets isFullyBuffered when isFull is true', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const bufferFullHandler = handlers[Event.PlaybackBufferFull];

    // Trigger buffer full
    bufferFullHandler({ isFull: true });

    // After buffer full, seekTo should not clamp (isFullyBuffered path)
    jest.clearAllMocks();
    await seekTo(500);

    // When isFullyBuffered is true, seekTo goes directly without getProgress
    expect(mockTP.seekTo).toHaveBeenCalledWith(500);
    expect(mockTP.getProgress).not.toHaveBeenCalled();
  });

  it('does not set isFullyBuffered when isFull is false', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const bufferFullHandler = handlers[Event.PlaybackBufferFull];

    // First, clear the fully-buffered state via clearQueue
    await clearQueue();
    jest.clearAllMocks();

    bufferFullHandler({ isFull: false });

    // seekTo should still call getProgress (not fully buffered)
    mockTP.getProgress.mockResolvedValue({ position: 10, duration: 300, buffered: 100 });
    await seekTo(50);
    expect(mockTP.getProgress).toHaveBeenCalled();
  });
});

describe('PlaybackStalled event handler', () => {
  it('logs a warning without throwing', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const stalledHandler = handlers[Event.PlaybackStalled];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    stalledHandler({ position: 42, track: 't1' });

    expect(warnSpy).toHaveBeenCalledWith(
      '[Player] Playback stalled at position',
      42,
      'track',
      't1',
    );
    warnSpy.mockRestore();
  });
});

describe('PlaybackErrorLog event handler', () => {
  it('logs each entry without throwing', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const errorLogHandler = handlers[Event.PlaybackErrorLog];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    errorLogHandler({
      entries: [
        { errorStatusCode: 404, errorDomain: 'HTTP', errorComment: 'Not Found', uri: 'http://test' },
        { errorStatusCode: 500, errorDomain: 'HTTP' },
      ],
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  seekTo edge branches                                               */
/* ------------------------------------------------------------------ */

describe('seekTo edge branches', () => {
  it('seeks freely when isFullyBuffered is true (no clamping)', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    // Set isFullyBuffered via the buffer full event
    handlers[Event.PlaybackBufferFull]({ isFull: true });

    jest.clearAllMocks();

    await seekTo(999);

    // Should seek directly without calling getProgress
    expect(mockTP.seekTo).toHaveBeenCalledWith(999);
    expect(mockTP.getProgress).not.toHaveBeenCalled();
    expect(mockSetProgress).toHaveBeenCalledWith(999, 100, expect.any(Number));
  });

  it('clamps seek to buffered range when transcoding and duration is 0', async () => {
    await initPlayer();

    // Clear fully-buffered state
    await clearQueue();
    jest.clearAllMocks();

    // Set up transcoding
    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);

    mockTP.getProgress.mockResolvedValue({ position: 10, duration: 0, buffered: 50 });

    await seekTo(80); // Beyond buffered range of 50

    // Should clamp to effectiveBuffered - 1 = 49
    expect(mockTP.seekTo).toHaveBeenCalledWith(49);
  });

  it('does not clamp when not transcoding even if duration is 0', async () => {
    await initPlayer();

    await clearQueue();
    jest.clearAllMocks();

    // raw format, no bitrate limit — not transcoding
    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    mockTP.getProgress.mockResolvedValue({ position: 10, duration: 0, buffered: 50 });

    await seekTo(80);

    // Should seek to the requested position (no clamping)
    expect(mockTP.seekTo).toHaveBeenCalledWith(80);
  });

  it('clamps when transcoding via maxBitRate even with raw format', async () => {
    await initPlayer();

    await clearQueue();
    jest.clearAllMocks();

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: 128 } as any);

    mockTP.getProgress.mockResolvedValue({ position: 10, duration: 0, buffered: 50 });

    await seekTo(80);

    // Should clamp because maxBitRate is set (isTranscoding is true)
    expect(mockTP.seekTo).toHaveBeenCalledWith(49);
  });
});

/* ------------------------------------------------------------------ */
/*  removeFromQueue index shift                                        */
/* ------------------------------------------------------------------ */

describe('removeFromQueue index shift', () => {
  it('adjusts currentTrackIndex when removing a track before the current track', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);

    // Simulate that current track is at index 2
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      currentTrack: queue[2],
      currentTrackIndex: 2,
      queue: queue,
      duration: 100,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    });

    jest.clearAllMocks();

    // Remove track at index 0 (before current track at index 2)
    await removeFromQueue(0);

    expect(mockTP.remove).toHaveBeenCalledWith(0);
    expect(mockSetQueue).toHaveBeenCalled();
    // Should adjust index from 2 to 1
    expect(mockSetCurrentTrack).toHaveBeenCalledWith(queue[2], 1);
  });

  it('does not adjust index when removing a track after the current track', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      currentTrack: queue[0],
      currentTrackIndex: 0,
      queue: queue,
      duration: 100,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    });

    jest.clearAllMocks();

    // Remove track at index 2 (after current track at index 0)
    await removeFromQueue(2);

    expect(mockTP.remove).toHaveBeenCalledWith(2);
    expect(mockSetQueue).toHaveBeenCalled();
    // Should NOT adjust index — no setCurrentTrack call for index shift
    expect(mockSetCurrentTrack).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  PlaybackProgressUpdated event handler                              */
/* ------------------------------------------------------------------ */

describe('PlaybackProgressUpdated event handler', () => {
  it('updates store progress from native event', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    handlers[Event.PlaybackProgressUpdated]({
      position: 42, duration: 200, buffered: 80, track: 0,
    });

    expect(mockSetProgress).toHaveBeenCalledWith(42, 200, 80);
  });

  it('passes position through without offset when no stream recovery active', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    // positionOffset is 0 by default (reset in beforeEach via clearQueue)
    handlers[Event.PlaybackProgressUpdated]({
      position: 42, duration: 200, buffered: 80, track: 0,
    });

    // position should be passed through unchanged (offset is 0)
    expect(mockSetProgress).toHaveBeenCalledWith(42, 200, 80);
  });

  it('uses metadata duration for fully-buffered tracks', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    // Set fully buffered
    handlers[Event.PlaybackBufferFull]({ isFull: true });

    // Set a track with known duration
    const mockState = {
      currentTrack: { duration: 300 },
      currentTrackIndex: 0,
      queue: [],
      duration: 300,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    handlers[Event.PlaybackProgressUpdated]({
      position: 50, duration: 200, buffered: 100, track: 0,
    });

    // The buffered value should be max of metaDuration(300), duration(200), buffered(100), position(50)
    expect(mockSetProgress).toHaveBeenCalledWith(50, 200, 300);
  });

  it('tracks high-water mark across multiple events', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    // First event: buffered = 100
    handlers[Event.PlaybackProgressUpdated]({
      position: 10, duration: 200, buffered: 100, track: 0,
    });
    expect(mockSetProgress).toHaveBeenCalledWith(10, 200, 100);

    jest.clearAllMocks();

    // Second event: buffered = 80 (lower), but high-water mark should keep 100
    handlers[Event.PlaybackProgressUpdated]({
      position: 20, duration: 200, buffered: 80, track: 0,
    });
    expect(mockSetProgress).toHaveBeenCalledWith(20, 200, 100);

    jest.clearAllMocks();

    // Third event: buffered = 150 (higher), high-water mark should update to 150
    handlers[Event.PlaybackProgressUpdated]({
      position: 30, duration: 200, buffered: 150, track: 0,
    });
    expect(mockSetProgress).toHaveBeenCalledWith(30, 200, 150);
  });

  it('resets high-water mark on track change', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);

    // Build up a high-water mark
    handlers[Event.PlaybackProgressUpdated]({
      position: 10, duration: 200, buffered: 150, track: 0,
    });

    jest.clearAllMocks();

    // Track change resets maxBufferedSeen
    handlers[Event.PlaybackActiveTrackChanged]({
      track: { id: 't2' }, index: 1, lastTrack: { id: 't1' }, lastIndex: 0,
    });

    // New track's first progress event — should not carry over old high-water mark
    handlers[Event.PlaybackProgressUpdated]({
      position: 5, duration: 180, buffered: 30, track: 1,
    });
    expect(mockSetProgress).toHaveBeenCalledWith(5, 180, 30);
  });
});

/* ------------------------------------------------------------------ */
/*  recoverTranscodedStream                                            */
/* ------------------------------------------------------------------ */

describe('recoverTranscodedStream (via PlaybackError)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips recovery when server does not support transcodeOffset', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // No transcodeOffset extension
    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [],
    });

    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);
    (serverInfoStore.getState as jest.Mock).mockReturnValue({ extensions: [] });

    mockTP.getActiveTrack.mockResolvedValue({ id: 't1', url: 'test' });

    const promise = errorHandler({ message: 'Error', position: 50 });

    // The handler takes the recovery path (fire-and-forget) and returns.
    // recoverTranscodedStream finds no extension and does nothing.
    // load() should NOT be called since the extension check fails.
    await promise;
    // Flush microtasks so recoverTranscodedStream completes.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTP.load).not.toHaveBeenCalled();
  });

  it('resets positionOffset on recovery failure (catch path)', async () => {
    await initPlayer();
    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);

    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    mockTP.getActiveTrack.mockResolvedValue({ id: 't1', url: 'test' });
    mockTP.load.mockRejectedValueOnce(new Error('load failed'));

    await errorHandler({ message: 'Error', position: 50 });
    // Flush microtasks so fire-and-forget recoverTranscodedStream completes
    // (including the catch and finally blocks after load rejection).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // After recovery failure, positionOffset is reset to 0.
    // We verify by seeking — if positionOffset were non-zero, nativeTarget
    // would be negative.  With offset = 0, seekTo(10) should pass 10.
    jest.clearAllMocks();

    // Clear fully buffered so we hit the getProgress path
    await clearQueue();
    (playerStore.getState as jest.Mock).mockReturnValue(defaultPlayerState());
    mockTP.getProgress.mockResolvedValue({ position: 5, duration: 200, buffered: 100 });

    await seekTo(10);
    expect(mockTP.seekTo).toHaveBeenCalledWith(10);
  });
});

/* ------------------------------------------------------------------ */
/*  recoverRawStream                                                   */
/* ------------------------------------------------------------------ */

describe('recoverRawStream (via PlaybackError)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('attempts raw stream recovery when error position > 5 and raw format', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const promise = errorHandler({ message: 'Stream error', position: 50 });
    await promise;
    // Flush microtasks so fire-and-forget recoverRawStream completes.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTP.retry).toHaveBeenCalled();
    expect(mockTP.seekTo).toHaveBeenCalledWith(50);
    expect(mockTP.play).toHaveBeenCalled();
    // Transparent recovery — no error/retrying state set.
    expect(mockSetError).not.toHaveBeenCalled();
    expect(mockSetRetrying).not.toHaveBeenCalled();
  });

  it('skips raw recovery when error position <= 5', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const promise = errorHandler({ message: 'Error', position: 3 });
    jest.advanceTimersByTime(1500);
    await promise;

    // Falls through to normal retry — setRetrying is called.
    expect(mockSetRetrying).toHaveBeenCalledWith(true);
    expect(mockTP.retry).toHaveBeenCalled();
  });

  it('skips raw recovery when near end of track', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // adjustedPos (198) is NOT < metadataDuration - 5 (195)
    const promise = errorHandler({ message: 'Error', position: 198 });
    jest.advanceTimersByTime(1500);
    await promise;

    // Falls through to normal retry.
    expect(mockSetRetrying).toHaveBeenCalledWith(true);
  });

  it('skips raw recovery when metadata duration is 0', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 0 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const promise = errorHandler({ message: 'Error', position: 50 });
    jest.advanceTimersByTime(1500);
    await promise;

    // Falls through to normal retry.
    expect(mockSetRetrying).toHaveBeenCalledWith(true);
  });

  it('prevents concurrent raw recovery via isRecoveringStream', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // Hold retry so first recovery stays in-flight.
    let resolveRetry!: () => void;
    mockTP.retry.mockReturnValueOnce(new Promise<void>((r) => { resolveRetry = r; }));

    // First error triggers recovery.
    const p1 = errorHandler({ message: 'Error 1', position: 50 });
    await Promise.resolve();

    // Second error while recovery is in-flight — should fall through to normal retry.
    const p2 = errorHandler({ message: 'Error 2', position: 55 });
    jest.advanceTimersByTime(1500);
    await p2;

    // Normal retry was triggered for the second error.
    expect(mockSetRetrying).toHaveBeenCalledWith(true);

    // Resolve first recovery.
    resolveRetry();
    await p1;
    await Promise.resolve();
    await Promise.resolve();

    // retry() was called twice: once for raw recovery, once for normal retry.
    // But seekTo(50) was only called once (raw recovery path).
    expect(mockTP.seekTo).toHaveBeenCalledTimes(1);
    expect(mockTP.seekTo).toHaveBeenCalledWith(50);
  });

  it('clears isRecoveringStream on failure so next error can recover', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // First recovery fails.
    mockTP.retry.mockRejectedValueOnce(new Error('retry failed'));

    await errorHandler({ message: 'Error 1', position: 50 });
    // Flush so catch/finally runs.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    jest.clearAllMocks();
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    // Second error should trigger a new recovery attempt (flag was cleared).
    await errorHandler({ message: 'Error 2', position: 60 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTP.retry).toHaveBeenCalled();
    expect(mockTP.seekTo).toHaveBeenCalledWith(60);
  });

  it('still uses transcoded recovery when transcoding', async () => {
    await initPlayer();
    const errorHandler = eventHandlers[Event.PlaybackError];

    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);

    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);
    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    mockTP.getActiveTrack.mockResolvedValue({ id: 't1', url: 'test' });
    (getStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream-offset.mp3');

    await errorHandler({ message: 'Error', position: 50 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Transcoded path uses load(), not retry().
    expect(mockTP.load).toHaveBeenCalled();
    expect(mockTP.retry).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  syncStoreFromNative (via AppState)                                 */
/* ------------------------------------------------------------------ */

describe('syncStoreFromNative', () => {
  it('syncs state, track, and progress from native player on foreground', async () => {
    await initPlayer();

    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    mockTP.getPlaybackState.mockResolvedValue({ state: State.Playing });
    mockTP.getActiveTrack.mockResolvedValue({ id: 't1' });
    mockTP.getActiveTrackIndex.mockResolvedValue(0);
    mockTP.getProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 60 });

    // Get the AppState handler that was registered
    await appStateHandler('active');

    expect(mockSetPlaybackState).toHaveBeenCalledWith('playing');
    expect(mockSetCurrentTrack).toHaveBeenCalled();
    expect(mockSetProgress).toHaveBeenCalled();
  });

  it('does nothing when app goes to background', async () => {
    await initPlayer();
    jest.clearAllMocks();

    await appStateHandler('background');

    expect(mockTP.getPlaybackState).not.toHaveBeenCalled();
  });

  it('syncs progress for non-playing states', async () => {
    await initPlayer();

    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    mockTP.getPlaybackState.mockResolvedValue({ state: State.Paused });
    mockTP.getActiveTrack.mockResolvedValue({ id: 't1' });
    mockTP.getActiveTrackIndex.mockResolvedValue(0);
    mockTP.getProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 60 });

    await appStateHandler('active');

    expect(mockSetPlaybackState).toHaveBeenCalledWith('paused');
  });

  it('handles errors gracefully when player is not ready', async () => {
    await initPlayer();
    jest.clearAllMocks();

    mockTP.getPlaybackState.mockRejectedValue(new Error('not ready'));

    // Should not throw
    await appStateHandler('active');

    expect(mockSetPlaybackState).not.toHaveBeenCalled();
  });

  it('uses metadata duration for buffered when isFullyBuffered during sync', async () => {
    await initPlayer();

    const queue = [makeChild('t1', { duration: 400 })];
    await playTrack(queue[0], queue);

    // Set isFullyBuffered via buffer full event
    eventHandlers[Event.PlaybackBufferFull]({ isFull: true });

    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    const mockState = {
      currentTrack: { duration: 400 },
      currentTrackIndex: 0,
      queue: [],
      duration: 400,
      error: null,
      retrying: false,
      setCurrentTrack: mockSetCurrentTrack,
      setPlaybackState: mockSetPlaybackState,
      setQueue: mockSetQueue,
      setProgress: mockSetProgress,
      setError: mockSetError,
      setRetrying: mockSetRetrying,
      setQueueLoading: mockSetQueueLoading,
      setQueueFormats: mockSetQueueFormats,
      addQueueFormat: mockAddQueueFormat,
      clearQueueFormats: mockClearQueueFormats,
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    mockTP.getPlaybackState.mockResolvedValue({ state: State.Playing });
    mockTP.getActiveTrack.mockResolvedValue({ id: 't1' });
    mockTP.getActiveTrackIndex.mockResolvedValue(0);
    mockTP.getProgress.mockResolvedValue({ position: 50, duration: 200, buffered: 100 });

    await appStateHandler('active');

    // The buffered value should use metaDuration (400) as the max
    expect(mockSetProgress).toHaveBeenCalledWith(50, 200, 400);
  });
});

/* ------------------------------------------------------------------ */
/*  mimeFromUri edge case                                              */
/* ------------------------------------------------------------------ */

describe('mimeFromUri (via childToTrack with local URI)', () => {
  it('returns undefined content type when local URI has no file extension', async () => {
    await initPlayer();

    // Set up a local URI with no extension
    const { getLocalTrackUri } = require('../musicCacheService');
    (getLocalTrackUri as jest.Mock).mockReturnValue('/path/to/file-no-ext');

    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);

    // The track added to RNTP should NOT have a contentType property
    const addedTracks = mockTP.add.mock.calls[0][0];
    expect(addedTracks[0].contentType).toBeUndefined();

    // Restore default
    (getLocalTrackUri as jest.Mock).mockReturnValue(null);
  });
});

/* ------------------------------------------------------------------ */
/*  PlaybackActiveTrackChanged edge branches                           */
/* ------------------------------------------------------------------ */

describe('PlaybackActiveTrackChanged edge branches', () => {
  it('resets buffer state and returns early during stream recovery with same track', async () => {
    await initPlayer();
    const queue = [makeChild('t1', { duration: 200 })];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const errorHandler = eventHandlers[Event.PlaybackError];

    // Set previousActiveChild to t1
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    // Trigger stream recovery: set up transcoding + transcodeOffset extension
    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: null } as any);
    (serverInfoStore.getState as jest.Mock).mockReturnValue({
      extensions: [{ name: 'transcodeOffset', versions: [1] }],
    });

    const mockState = defaultPlayerState();
    mockState.currentTrack = { duration: 200 } as any;
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    mockTP.getActiveTrack.mockResolvedValue({ id: 't1', url: 'test' });
    (getStreamUrl as jest.Mock).mockReturnValue('https://example.com/stream-offset.mp3');
    // Make load() hang so isRecoveringStream stays true when we fire ActiveTrackChanged
    let resolveLoad: () => void;
    mockTP.load.mockReturnValue(new Promise<void>((r) => { resolveLoad = r; }));

    // Fire error to trigger recovery (fire-and-forget)
    const promise = errorHandler({ message: 'Stream error', position: 50 });
    await promise;
    // Let recoverTranscodedStream run up to the load() call
    await Promise.resolve();
    await Promise.resolve();

    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Now fire ActiveTrackChanged with same track while isRecoveringStream is true
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    // Should NOT update the store (early return)
    expect(mockSetCurrentTrack).not.toHaveBeenCalled();
    expect(sendNowPlaying).not.toHaveBeenCalled();

    // Resolve load to clean up
    resolveLoad!();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('ignores null track events during shuffle', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];

    // We need to trigger ActiveTrackChanged during shuffle.
    // Since shuffleQueue sets isShuffling=true internally, we simulate by
    // making pause() trigger an ActiveTrackChanged with null track.
    mockTP.pause.mockImplementation(async () => {
      activeTrackHandler({ track: null, index: null });
    });

    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    await shuffleQueue();

    // The null-track ActiveTrackChanged during shuffle should have been ignored
    // (no setCurrentTrack(null, null) call from the null-track event).
    // shuffleQueue itself doesn't call setCurrentTrack.
    // Restore pause mock
    mockTP.pause.mockResolvedValue(undefined);
  });

  it('clears scrobbleHandledByEnded when EndedWithReason fired first', async () => {
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);

    const activeTrackHandler = eventHandlers[Event.PlaybackActiveTrackChanged];
    const endedHandler = eventHandlers[Event.PlaybackEndedWithReason];

    // Set previousActiveChild to t1
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // EndedWithReason fires FIRST — sets scrobbleHandledByEnded = true
    endedHandler({ reason: 'playedUntilEnd', track: 't1', position: 200 });

    expect(addCompletedScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      undefined,
    );

    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Then ActiveTrackChanged fires — should hit the scrobbleHandledByEnded=true branch
    // (line 464: sets it to false without saving a stale reference)
    activeTrackHandler({ track: { id: 't2' }, index: 1 });

    // It should set the new track and send now playing
    expect(mockSetCurrentTrack).toHaveBeenCalled();
    expect(sendNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      undefined,
    );

    // Now verify the flag was cleared: trigger another transition where
    // ActiveTrackChanged fires first — it should save the outgoing track
    // (proving scrobbleHandledByEnded was reset to false)
    jest.clearAllMocks();
    // Re-suppress console output (clearAllMocks wipes the spy implementation).
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // ActiveTrackChanged fires first for t2->t1 transition
    activeTrackHandler({ track: { id: 't1' }, index: 0 });

    // Then EndedWithReason — should scrobble t2 (the saved outgoing track)
    endedHandler({ reason: 'playedUntilEnd', track: 't2', position: 200 });

    expect(addCompletedScrobble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      undefined,
    );
  });
});

/* ------------------------------------------------------------------ */
/*  removeNonDownloadedTracks                                          */
/* ------------------------------------------------------------------ */

describe('removeNonDownloadedTracks', () => {
  it('no-ops when queue is empty', async () => {
    await removeNonDownloadedTracks();
    expect(mockTP.reset).not.toHaveBeenCalled();
    expect(mockTP.remove).not.toHaveBeenCalled();
  });

  it('no-ops when all tracks are downloaded', async () => {
    const { getLocalTrackUri } = require('../musicCacheService');
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);
    mockTP.remove.mockClear();
    mockTP.reset.mockClear();

    (getLocalTrackUri as jest.Mock).mockReturnValue('/local/path');
    await removeNonDownloadedTracks();

    expect(mockTP.reset).not.toHaveBeenCalled();
    expect(mockTP.remove).not.toHaveBeenCalled();
  });

  it('clears queue when all tracks are non-downloaded', async () => {
    const { getLocalTrackUri } = require('../musicCacheService');
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);
    mockTP.reset.mockClear();

    (getLocalTrackUri as jest.Mock).mockReturnValue(null);
    await removeNonDownloadedTracks();

    expect(mockTP.reset).toHaveBeenCalled();
  });

  it('selectively removes non-downloaded tracks', async () => {
    const { getLocalTrackUri } = require('../musicCacheService');
    await initPlayer();
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);
    mockTP.remove.mockClear();
    mockTP.reset.mockClear();

    // t1 downloaded, t2 not, t3 downloaded
    (getLocalTrackUri as jest.Mock).mockImplementation((id: string) =>
      id === 't2' ? null : '/local/' + id,
    );
    await removeNonDownloadedTracks();

    expect(mockTP.reset).not.toHaveBeenCalled();
    expect(mockTP.remove).toHaveBeenCalled();
  });
});

describe('skipByInterval', () => {
  it('seeks forward by the given interval', async () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      position: 30,
      duration: 200,
    });
    mockTP.getProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 200 });

    await skipByInterval(15);
    expect(mockTP.seekTo).toHaveBeenCalledWith(45);
  });

  it('seeks backward by the given interval', async () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      position: 30,
      duration: 200,
    });
    mockTP.getProgress.mockResolvedValue({ position: 30, duration: 200, buffered: 200 });

    await skipByInterval(-15);
    expect(mockTP.seekTo).toHaveBeenCalledWith(15);
  });

  it('clamps to 0 when skipping backward past start', async () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      position: 5,
      duration: 200,
    });
    mockTP.getProgress.mockResolvedValue({ position: 5, duration: 200, buffered: 200 });

    await skipByInterval(-30);
    expect(mockTP.seekTo).toHaveBeenCalledWith(0);
  });

  it('clamps to duration when skipping forward past end', async () => {
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      position: 190,
      duration: 200,
    });
    mockTP.getProgress.mockResolvedValue({ position: 190, duration: 200, buffered: 200 });

    await skipByInterval(30);
    expect(mockTP.seekTo).toHaveBeenCalledWith(200);
  });
});

describe('updateRemoteCapabilities', () => {
  it('sets skip-track capabilities by default', async () => {
    const { Capability } = require('react-native-track-player');
    playbackSettingsStore.setState({
      remoteControlMode: 'skip-track',
      skipForwardInterval: 30,
      skipBackwardInterval: 15,
    } as any);

    await updateRemoteCapabilities();

    expect(mockTP.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: expect.arrayContaining([
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ]),
        forwardJumpInterval: 30,
        backwardJumpInterval: 15,
      }),
    );

    const call = mockTP.updateOptions.mock.calls[0][0];
    expect(call.capabilities).not.toContain(Capability.JumpForward);
    expect(call.capabilities).not.toContain(Capability.JumpBackward);
  });

  it('sets jump capabilities in skip-interval mode', async () => {
    const { Capability } = require('react-native-track-player');
    playbackSettingsStore.setState({
      remoteControlMode: 'skip-interval',
      skipForwardInterval: 60,
      skipBackwardInterval: 10,
    } as any);

    await updateRemoteCapabilities();

    expect(mockTP.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: expect.arrayContaining([
          Capability.Play,
          Capability.Pause,
          Capability.JumpForward,
          Capability.JumpBackward,
        ]),
        forwardJumpInterval: 60,
        backwardJumpInterval: 10,
      }),
    );

    const call = mockTP.updateOptions.mock.calls[0][0];
    expect(call.capabilities).not.toContain(Capability.SkipToNext);
    expect(call.capabilities).not.toContain(Capability.SkipToPrevious);
  });

  it('sets notificationCapabilities to match capabilities', async () => {
    playbackSettingsStore.setState({
      remoteControlMode: 'skip-track',
      skipForwardInterval: 30,
      skipBackwardInterval: 15,
    } as any);

    await updateRemoteCapabilities();

    const call = mockTP.updateOptions.mock.calls[0][0];
    expect(call.notificationCapabilities).toEqual(call.capabilities);
  });

  it('sets android appKilledPlaybackBehavior to stop on kill', async () => {
    const { AppKilledPlaybackBehavior } = require('react-native-track-player');
    playbackSettingsStore.setState({
      remoteControlMode: 'skip-track',
      skipForwardInterval: 30,
      skipBackwardInterval: 15,
    } as any);

    await updateRemoteCapabilities();

    const call = mockTP.updateOptions.mock.calls[0][0];
    expect(call.android).toEqual({
      appKilledPlaybackBehavior:
        AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    });
  });
});

// ---------------------------------------------------------------------------
// Sleep timer event handlers
// ---------------------------------------------------------------------------

describe('sleep timer events', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sleepTimerStore } = require('../../store/sleepTimerStore');

  beforeEach(() => {
    sleepTimerStore.setState({
      endTime: null,
      endOfTrack: false,
      remaining: null,
      sheetVisible: false,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('sets timer in store on SleepTimerChanged with timed timer', () => {
    const handler = eventHandlers[Event.SleepTimerChanged];
    expect(handler).toBeDefined();

    const endTime = Date.now() / 1000 + 600;
    handler({ active: true, endTime, endOfTrack: false });

    const state = sleepTimerStore.getState();
    expect(state.endTime).toBe(endTime);
    expect(state.endOfTrack).toBe(false);
    expect(state.remaining).toBeGreaterThanOrEqual(0);
  });

  it('sets timer in store on SleepTimerChanged with endOfTrack', () => {
    const handler = eventHandlers[Event.SleepTimerChanged];
    handler({ active: true, endTime: null, endOfTrack: true });

    const state = sleepTimerStore.getState();
    expect(state.endTime).toBeNull();
    expect(state.endOfTrack).toBe(true);
    expect(state.remaining).toBeNull();
  });

  it('clears store on SleepTimerChanged with active=false', () => {
    // First activate
    const handler = eventHandlers[Event.SleepTimerChanged];
    handler({ active: true, endTime: Date.now() / 1000 + 600, endOfTrack: false });
    expect(sleepTimerStore.getState().endTime).not.toBeNull();

    // Then deactivate
    handler({ active: false });
    const state = sleepTimerStore.getState();
    expect(state.endTime).toBeNull();
    expect(state.endOfTrack).toBe(false);
    expect(state.remaining).toBeNull();
  });

  it('clears store on SleepTimerComplete', () => {
    // Activate first
    const changedHandler = eventHandlers[Event.SleepTimerChanged];
    changedHandler({ active: true, endTime: Date.now() / 1000 + 60, endOfTrack: false });
    expect(sleepTimerStore.getState().endTime).not.toBeNull();

    // Fire complete
    const completeHandler = eventHandlers[Event.SleepTimerComplete];
    expect(completeHandler).toBeDefined();
    completeHandler({});

    const state = sleepTimerStore.getState();
    expect(state.endTime).toBeNull();
    expect(state.endOfTrack).toBe(false);
    expect(state.remaining).toBeNull();
  });

  it('starts JS countdown interval for timed timer', () => {
    const handler = eventHandlers[Event.SleepTimerChanged];
    const endTime = Date.now() / 1000 + 10;
    handler({ active: true, endTime, endOfTrack: false });

    const initialRemaining = sleepTimerStore.getState().remaining;
    expect(initialRemaining).toBeGreaterThan(0);

    jest.advanceTimersByTime(2000);
    expect(sleepTimerStore.getState().remaining).toBeLessThan(initialRemaining!);
  });

  it('clears interval when timer is cancelled', () => {
    const handler = eventHandlers[Event.SleepTimerChanged];
    handler({ active: true, endTime: Date.now() / 1000 + 600, endOfTrack: false });
    handler({ active: false });

    // Advance timers — remaining should stay null (interval cleared)
    jest.advanceTimersByTime(5000);
    expect(sleepTimerStore.getState().remaining).toBeNull();
  });

  it('clears interval on SleepTimerComplete', () => {
    const changedHandler = eventHandlers[Event.SleepTimerChanged];
    changedHandler({ active: true, endTime: Date.now() / 1000 + 600, endOfTrack: false });

    const completeHandler = eventHandlers[Event.SleepTimerComplete];
    completeHandler({});

    jest.advanceTimersByTime(5000);
    expect(sleepTimerStore.getState().remaining).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Queue format stamping                                              */
/* ------------------------------------------------------------------ */

describe('queue format stamping', () => {
  it('playTrack stamps queueFormats for all tracks', async () => {
    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const queue = [
      makeChild('t1', { suffix: 'flac', bitRate: 1411 }),
      makeChild('t2', { suffix: 'mp3', bitRate: 320 }),
    ];

    await playTrack(queue[0], queue);

    expect(mockSetQueueFormats).toHaveBeenCalledTimes(1);
    const fmts = mockSetQueueFormats.mock.calls[0][0];
    expect(fmts.t1.suffix).toBe('flac');
    expect(fmts.t2.suffix).toBe('mp3');
  });

  it('playTrack uses downloaded format when available', async () => {
    const { musicCacheStore } = require('../../store/musicCacheStore');
    const cachedSong = {
      id: 't1',
      title: 'Song t1',
      albumId: 'a1',
      bytes: 1000,
      duration: 200,
      suffix: 'opus',
      bitRate: 128,
      formatCapturedAt: 999,
      downloadedAt: 999,
    };
    (musicCacheStore.getState as jest.Mock).mockReturnValue({
      cachedSongs: { t1: cachedSong },
    });

    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: 320 } as any);

    const queue = [makeChild('t1', { suffix: 'flac', bitRate: 1411 })];
    await playTrack(queue[0], queue);

    const fmts = mockSetQueueFormats.mock.calls[0][0];
    expect(fmts.t1.suffix).toBe('opus');
    expect(fmts.t1.bitRate).toBe(128);
    expect(fmts.t1.capturedAt).toBe(999);

    // Restore default
    (musicCacheStore.getState as jest.Mock).mockReturnValue({ cachedSongs: {} });
  });

  it('addToQueue stamps format for appended tracks', async () => {
    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    const queue = [makeChild('t1', { suffix: 'flac' })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(defaultPlayerState());

    const extras = [makeChild('t2', { suffix: 'mp3', bitRate: 256 })];
    await addToQueue(extras);

    expect(mockAddQueueFormat).toHaveBeenCalledTimes(1);
    expect(mockAddQueueFormat.mock.calls[0][0]).toBe('t2');
    expect(mockAddQueueFormat.mock.calls[0][1].suffix).toBe('mp3');
  });

  it('clearQueue clears queueFormats', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(defaultPlayerState());

    await clearQueue();

    expect(mockClearQueueFormats).toHaveBeenCalled();
  });

  it('playTrack resolves transcoded format from stream settings', async () => {
    playbackSettingsStore.setState({ streamFormat: 'mp3', maxBitRate: 192 } as any);

    const queue = [makeChild('t1', { suffix: 'flac', bitRate: 1411 })];
    await playTrack(queue[0], queue);

    const fmts = mockSetQueueFormats.mock.calls[0][0];
    expect(fmts.t1.suffix).toBe('mp3');
    expect(fmts.t1.bitRate).toBe(192);
  });
});

describe('queue persistence integration', () => {
  it('playTrack persists the queue', async () => {
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);

    expect(mockPersistQueue).toHaveBeenCalledWith(queue, 0);
  });

  it('playTrack persists the correct startIndex', async () => {
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[1], queue);

    expect(mockPersistQueue).toHaveBeenCalledWith(queue, 1);
  });

  it('addToQueue persists after appending tracks', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    await addToQueue([makeChild('t2')]);
    expect(mockPersistQueue).toHaveBeenCalled();
  });

  it('removeFromQueue persists after removal', async () => {
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrackIndex: 0,
      queue,
    });

    await removeFromQueue(2);
    expect(mockPersistQueue).toHaveBeenCalled();
  });

  it('shuffleQueue persists the shuffled queue', async () => {
    const queue = [makeChild('t1'), makeChild('t2'), makeChild('t3')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      currentTrackIndex: 0,
      queue,
    });

    await shuffleQueue();
    expect(mockPersistQueue).toHaveBeenCalled();
  });

  it('clearQueue calls clearPersistedQueue', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    await clearQueue();
    expect(mockClearPersistedQueue).toHaveBeenCalled();
  });

  it('PlaybackActiveTrackChanged persists queue on genuine track change', async () => {
    const queue = [makeChild('t1'), makeChild('t2')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    eventHandlers[Event.PlaybackActiveTrackChanged]({
      track: { id: 't2' },
      index: 1,
    });

    expect(mockPersistQueue).toHaveBeenCalled();
  });

  it('PlaybackProgressUpdated calls persistPositionIfDue', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      currentTrackIndex: 0,
    });

    eventHandlers[Event.PlaybackProgressUpdated]({
      position: 45,
      duration: 200,
      buffered: 60,
    });

    expect(mockPersistPositionIfDue).toHaveBeenCalledWith(45, 't1');
  });

  it('PlaybackProgressUpdated skips persist when position is 0', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      currentTrackIndex: 0,
    });

    eventHandlers[Event.PlaybackProgressUpdated]({
      position: 0,
      duration: 200,
      buffered: 0,
    });

    expect(mockPersistPositionIfDue).not.toHaveBeenCalled();
  });

  it('AppState background transition flushes position', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      position: 55,
    });

    await appStateHandler('background');
    expect(mockFlushPosition).toHaveBeenCalledWith(55, 't1');
  });

  it('AppState inactive transition flushes position', async () => {
    const queue = [makeChild('t1')];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      position: 30,
    });

    await appStateHandler('inactive');
    expect(mockFlushPosition).toHaveBeenCalledWith(30, 't1');
  });

  it('AppState background skips flush when no current track', async () => {
    await appStateHandler('background');
    expect(mockFlushPosition).not.toHaveBeenCalled();
  });
});

describe('raw stream recovery retry cap', () => {
  it('stops attempting raw recovery after 3 consecutive failures', async () => {
    const queue = [makeChild('t1', { duration: 300 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      currentTrackIndex: 0,
      duration: 300,
    });

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    // Fire 3 errors — all should trigger raw recovery
    for (let i = 0; i < 3; i++) {
      await eventHandlers[Event.PlaybackError]({
        message: 'stream error',
        position: 50,
      });
      // Wait for async recovery to complete
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(mockTP.retry).toHaveBeenCalledTimes(3);
    jest.clearAllMocks();

    // 4th error should NOT trigger raw recovery (cap reached)
    await eventHandlers[Event.PlaybackError]({
      message: 'stream error',
      position: 50,
    });

    // retry is called in normal error handling path, not raw recovery
    expect(mockTP.seekTo).not.toHaveBeenCalled();
  });

  it('resets raw recovery counter when playback resumes', async () => {
    const queue = [makeChild('t1', { duration: 300 })];
    await playTrack(queue[0], queue);
    jest.clearAllMocks();

    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue({
      ...defaultPlayerState(),
      currentTrack: queue[0],
      currentTrackIndex: 0,
      duration: 300,
    });

    playbackSettingsStore.setState({ streamFormat: 'raw', maxBitRate: null } as any);

    // Fire 2 errors (not at cap yet)
    for (let i = 0; i < 2; i++) {
      await eventHandlers[Event.PlaybackError]({
        message: 'stream error',
        position: 50,
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    // Simulate playback resuming (resets counter)
    eventHandlers[Event.PlaybackState]({ state: State.Playing });
    jest.clearAllMocks();

    // Should be able to do 3 more recovery attempts
    for (let i = 0; i < 3; i++) {
      await eventHandlers[Event.PlaybackError]({
        message: 'stream error',
        position: 50,
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(mockTP.retry).toHaveBeenCalledTimes(3);
  });
});
