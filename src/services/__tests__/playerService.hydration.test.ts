/**
 * Tests for cold-start queue resume hydration on RNQP.
 *
 * The former RNTP mute→reset→verify→skip→seek→pause→unmute ceremony collapsed
 * to a single atomic `setQueue(tracks, startIndex)` (+ optional `seekTo`), so
 * these cover: loading at the right index, seeking to the resume position,
 * bailing when nothing is playable, and the public-API hydration guard.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    getFirstSync: () => undefined,
    getAllSync: () => [],
    runSync: () => {},
    execSync: () => {},
    withTransactionSync: (fn: () => void) => fn(),
  }),
}));

jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'android' },
}));

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

// Stateful player-store mirror — restorePersistedQueue() calls
// setCurrentTrack(child, index), and hydrateRestoredQueue() reads
// currentTrackIndex back to decide the start index.
const playerStoreState: {
  currentTrack: unknown;
  currentTrackIndex: number | null;
  queue: unknown[];
  position: number;
  duration: number;
  bufferedPosition: number;
  error: string | null;
  retrying: boolean;
  playbackState: string;
} = {
  currentTrack: null,
  currentTrackIndex: 0,
  queue: [],
  position: 0,
  duration: 100,
  bufferedPosition: 0,
  error: null,
  retrying: false,
  playbackState: 'idle',
};

const mockSetCurrentTrack = jest.fn((track: unknown, index?: number | null) => {
  playerStoreState.currentTrack = track;
  if (index !== undefined) playerStoreState.currentTrackIndex = index;
});
const mockSetQueue = jest.fn((q: unknown[]) => { playerStoreState.queue = q; });
const mockSetProgress = jest.fn();
const mockSetPlaybackState = jest.fn();
const mockSetError = jest.fn();
const mockSetRetrying = jest.fn();
const mockSetQueueLoading = jest.fn();
const mockSetQueueFormats = jest.fn();
const mockClearQueueFormats = jest.fn();
const mockAddQueueFormat = jest.fn();

const buildPlayerState = () => ({
  ...playerStoreState,
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

jest.mock('../../store/playerStore', () => ({
  playerStore: { getState: jest.fn(() => buildPlayerState()), setState: jest.fn() },
}));

const mockToastFail = jest.fn();
jest.mock('../../store/playbackToastStore', () => ({
  playbackToastStore: {
    getState: jest.fn(() => ({ show: jest.fn(), succeed: jest.fn(), fail: mockToastFail })),
  },
}));

jest.mock('../../store/serverInfoStore', () => ({
  serverInfoStore: { getState: jest.fn(() => ({ extensions: [] })) },
}));

jest.mock('../scrobbleService', () => ({ addCompletedScrobble: jest.fn(), sendNowPlaying: jest.fn() }));
jest.mock('../imageCacheService', () => ({ resolveCachedImageUri: jest.fn().mockResolvedValue(null) }));
jest.mock('../sslTrustService', () => ({ syncProxyUpstreams: jest.fn(() => Promise.resolve()) }));

jest.mock('../musicCacheService', () => ({
  getLocalTrackUri: jest.fn().mockReturnValue(null),
  waitForTrackMapsReady: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/musicCacheStore', () => ({
  musicCacheStore: { getState: jest.fn(() => ({ cachedSongs: {} })) },
}));

const mockOfflineMode = { offlineMode: false };
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: jest.fn(() => mockOfflineMode) },
}));

const subsonicMocks = {
  streamUrl: 'https://example.com/stream.mp3' as string | null,
  coverArtUrl: 'https://example.com/art.jpg' as string | null,
};
jest.mock('../subsonicService', () => ({
  getStreamUrl: jest.fn(() => subsonicMocks.streamUrl),
  getCoverArtUrl: jest.fn(() => subsonicMocks.coverArtUrl),
  ensureCoverArtAuth: jest.fn(() => Promise.resolve()),
  isRadioChild: (child: { id?: string; radioStreamUrl?: unknown }) =>
    typeof child?.id === 'string' &&
    child.id.startsWith('internet-radio:') &&
    typeof child.radioStreamUrl === 'string',
}));

const mockGetPersistedQueue = jest.fn().mockReturnValue(null);
const mockGetPersistedPosition = jest.fn().mockReturnValue(null);
jest.mock('../queuePersistenceService', () => ({
  persistQueue: jest.fn(),
  persistPositionIfDue: jest.fn(),
  flushPosition: jest.fn(),
  clearPersistedQueue: jest.fn(),
  getPersistedQueue: () => mockGetPersistedQueue(),
  getPersistedPosition: () => mockGetPersistedPosition(),
  resetPersistTimer: jest.fn(),
  PERSIST_INTERVAL_MS: 10_000,
}));

import type { Child } from '../subsonicService';
import {
  initPlayer,
  restorePersistedQueueAfterBoot,
  clearQueue,
  togglePlayPause,
  playTrack,
} from '../playerService';

const rnqp = require('react-native-queue-player');
const mockTP = rnqp.__trackPlayer as Record<string, jest.Mock>;

const makeChild = (id: string): Child => ({
  id,
  title: `Song ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  coverArt: `cover-${id}`,
  duration: 200,
} as Child);

/** Flush pending microtasks so the (timer-free) hydration completes. */
async function drainHydration(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeAll(async () => {
  jest.spyOn(console, 'warn').mockImplementation();
  await initPlayer();
});

afterAll(() => jest.restoreAllMocks());

beforeEach(async () => {
  await clearQueue();
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation();

  subsonicMocks.streamUrl = 'https://example.com/stream.mp3';
  subsonicMocks.coverArtUrl = 'https://example.com/art.jpg';
  mockGetPersistedQueue.mockReturnValue(null);
  mockGetPersistedPosition.mockReturnValue(null);
  mockOfflineMode.offlineMode = false;

  playerStoreState.currentTrack = null;
  playerStoreState.currentTrackIndex = 0;
  playerStoreState.queue = [];
  playerStoreState.position = 0;
});

describe('cold-start hydration', () => {
  it('loads the restored queue via setQueue at the persisted index and seeks to the resume position', async () => {
    const queue = [makeChild('a'), makeChild('b'), makeChild('c')];
    mockGetPersistedQueue.mockReturnValue({ queue, currentTrackIndex: 1 });
    mockGetPersistedPosition.mockReturnValue({ trackId: 'b', position: 45 });

    restorePersistedQueueAfterBoot();
    await drainHydration();

    expect(mockTP.setQueue).toHaveBeenCalledTimes(1);
    const [tracks, startIndex] = mockTP.setQueue.mock.calls[0];
    expect(tracks).toHaveLength(3);
    expect(startIndex).toBe(1);
    expect(mockTP.seekTo).toHaveBeenCalledWith(45);
    // No auto-play on restore — setQueue positions but doesn't play.
    expect(mockTP.play).not.toHaveBeenCalled();
  });

  it('starts at index 0 and does not seek when the persisted position is for another track', async () => {
    const queue = [makeChild('a'), makeChild('b')];
    mockGetPersistedQueue.mockReturnValue({ queue, currentTrackIndex: 0 });
    mockGetPersistedPosition.mockReturnValue({ trackId: 'something-else', position: 100 });

    restorePersistedQueueAfterBoot();
    await drainHydration();

    expect(mockTP.setQueue.mock.calls[0][1]).toBe(0);
    expect(mockTP.seekTo).not.toHaveBeenCalled();
  });

  it('bails + toasts + clears when every restored track is unplayable', async () => {
    subsonicMocks.streamUrl = null; // no stream URL + no local → nothing playable
    const queue = [makeChild('a'), makeChild('b')];
    mockGetPersistedQueue.mockReturnValue({ queue, currentTrackIndex: 0 });

    restorePersistedQueueAfterBoot();
    await drainHydration();

    expect(mockToastFail).toHaveBeenCalled();
    expect(mockTP.setQueue).not.toHaveBeenCalled();
    expect(mockTP.clearQueue).toHaveBeenCalled();
    expect(mockSetQueue).toHaveBeenCalledWith([]);
  });

  it('does nothing when there is no persisted queue', async () => {
    restorePersistedQueueAfterBoot();
    await drainHydration();
    expect(mockTP.setQueue).not.toHaveBeenCalled();
  });
});

describe('hydration guard', () => {
  it('awaits the in-flight hydration before togglePlayPause fires play()', async () => {
    const queue = [makeChild('a')];
    mockGetPersistedQueue.mockReturnValue({ queue, currentTrackIndex: 0 });

    // Stall the hydration's setQueue so the queue restore is mid-flight.
    let resolveSetQueue: () => void = () => {};
    mockTP.setQueue.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveSetQueue = r; }),
    );

    restorePersistedQueueAfterBoot();
    await drainHydration(); // reach the stalled setQueue

    const togglePromise = togglePlayPause();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // play() must NOT have fired while hydration's setQueue is stalled.
    expect(mockTP.play).not.toHaveBeenCalled();

    resolveSetQueue();
    await togglePromise;
    expect(mockTP.play).toHaveBeenCalled();
  });

  it('awaits hydration before playTrack replaces the queue', async () => {
    const queue = [makeChild('a')];
    mockGetPersistedQueue.mockReturnValue({ queue, currentTrackIndex: 0 });

    let resolveSetQueue: () => void = () => {};
    mockTP.setQueue.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveSetQueue = r; }),
    );

    restorePersistedQueueAfterBoot();
    await drainHydration();

    const newQueue = [makeChild('new-1'), makeChild('new-2')];
    const playPromise = playTrack(newQueue[0], newQueue);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // playTrack's setQueue must not have fired while hydration's setQueue stalls.
    expect(mockTP.setQueue).toHaveBeenCalledTimes(1);

    resolveSetQueue();
    await playPromise;
    expect(mockTP.setQueue).toHaveBeenCalledTimes(2);
    expect(mockTP.play).toHaveBeenCalled();
  });
});
