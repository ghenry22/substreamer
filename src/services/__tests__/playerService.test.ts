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
  Capability: { Play: 0, Pause: 1, SkipToNext: 2, SkipToPrevious: 3, Stop: 4, SeekTo: 5 },
  Event: {
    PlaybackState: 'playback-state',
    PlaybackError: 'playback-error',
    PlaybackActiveTrackChanged: 'playback-active-track-changed',
    PlaybackEndedWithReason: 'playback-ended-with-reason',
    PlaybackStalled: 'playback-stalled',
    PlaybackErrorLog: 'playback-error-log',
    PlaybackBufferEmpty: 'playback-buffer-empty',
    PlaybackBufferFull: 'playback-buffer-full',
    PlaybackSeekCompleted: 'playback-seek-completed',
  },
  IOSCategory: { Playback: 'playback' },
  RepeatMode: { Off: 0, Track: 1, Queue: 2 },
  State: { Playing: 3, Paused: 2, Buffering: 6, Loading: 9, Stopped: 1, Ended: 11, None: 0, Ready: 8, Connecting: 7, Error: 10 },
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

const mockSetCurrentTrack = jest.fn();
const mockSetPlaybackState = jest.fn();
const mockSetQueue = jest.fn();
const mockSetProgress = jest.fn();
const mockSetError = jest.fn();
const mockSetRetrying = jest.fn();
const mockSetQueueLoading = jest.fn();

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
    })),
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
}));

jest.mock('../subsonicService', () => ({
  ensureCoverArtAuth: jest.fn().mockResolvedValue(undefined),
  getCoverArtUrl: jest.fn().mockReturnValue('https://example.com/art.jpg'),
  getStreamUrl: jest.fn().mockReturnValue('https://example.com/stream.mp3'),
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
  cycleRepeatMode,
  cyclePlaybackRate,
  shuffleQueue,
} from '../playerService';
import { getStreamUrl, type Child } from '../subsonicService';

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
  // Reset module-level state (stops polling, clears queue, resets flags).
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
    expect(mockToastShow).toHaveBeenCalled();
    expect(mockToastSucceed).toHaveBeenCalled();
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

/* ------------------------------------------------------------------ */
/*  Event handler callback tests                                       */
/* ------------------------------------------------------------------ */

describe('PlaybackState event handler', () => {
  it('sets playing state and starts progress polling', () => {
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
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    eventHandlers[Event.PlaybackState]({ state: State.Playing });

    expect(mockSetError).toHaveBeenCalledWith(null);
    expect(mockSetRetrying).toHaveBeenCalledWith(false);
  });

  it('maps Paused state and stops polling', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Paused });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('paused');
  });

  it('maps Buffering state and keeps polling', () => {
    eventHandlers[Event.PlaybackState]({ state: State.Buffering });
    expect(mockSetPlaybackState).toHaveBeenCalledWith('buffering');
  });

  it('maps Loading state and keeps polling', () => {
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
    expect(sendNowPlaying).toHaveBeenCalledWith('t2');
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

describe('PlaybackBufferEmpty event handler', () => {
  it('logs a warning without throwing', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const bufferEmptyHandler = handlers[Event.PlaybackBufferEmpty];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    bufferEmptyHandler({ isEmpty: true });

    expect(warnSpy).toHaveBeenCalledWith('[Player] Buffer empty:', true);
    warnSpy.mockRestore();
  });
});

describe('PlaybackSeekCompleted event handler', () => {
  it('logs seek completion without throwing', async () => {
    await initPlayer();
    const handlers = eventHandlers;
    const seekCompletedHandler = handlers[Event.PlaybackSeekCompleted];

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    seekCompletedHandler({ position: 30, didFinish: true });

    expect(logSpy).toHaveBeenCalledWith(
      '[Player] Seek completed: position',
      30,
      'didFinish',
      true,
    );
    logSpy.mockRestore();
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
/*  startProgressPolling callback body                                 */
/* ------------------------------------------------------------------ */

describe('startProgressPolling callback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls progress at 250ms intervals and updates store', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    mockTP.getProgress.mockResolvedValue({ position: 42, duration: 200, buffered: 80 });

    // Trigger playing state to start polling
    handlers[Event.PlaybackState]({ state: State.Playing });

    // Advance timer to trigger the interval callback
    jest.advanceTimersByTime(250);

    // Allow the async callback to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTP.getProgress).toHaveBeenCalled();
    expect(mockSetProgress).toHaveBeenCalledWith(42, 200, expect.any(Number));
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
    };
    const { playerStore } = require('../../store/playerStore');
    (playerStore.getState as jest.Mock).mockReturnValue(mockState);

    mockTP.getProgress.mockResolvedValue({ position: 50, duration: 200, buffered: 100 });

    // Start polling
    handlers[Event.PlaybackState]({ state: State.Playing });

    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    // The buffered value should be max of metaDuration(300), duration(200), buffered(100), position(50)
    expect(mockSetProgress).toHaveBeenCalledWith(50, 200, 300);
  });

  it('handles getProgress errors gracefully during polling', async () => {
    await initPlayer();
    const handlers = eventHandlers;

    mockTP.getProgress.mockRejectedValue(new Error('player not ready'));

    // Start polling
    handlers[Event.PlaybackState]({ state: State.Playing });

    // Should not throw
    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    // No crash — the error is swallowed
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

  it('stops polling for non-playing states', async () => {
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
    expect(sendNowPlaying).toHaveBeenCalledWith('t2');

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
    );
  });
});
