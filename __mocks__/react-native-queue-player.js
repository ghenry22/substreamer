/**
 * Jest manual mock for react-native-queue-player.
 *
 * Auto-used for this node_modules package (root `__mocks__/`), so tests never
 * hit the native NitroModules TurboModule. `getTrackPlayer()` returns a shared
 * mock whose `on*` subscriptions record their callbacks; tests fire native
 * events via the exported `__emit(name, ...args)` helper and reset with
 * `__resetPlayerMock()`.
 */

const listeners = {};

function makeSub(name) {
  return (cb) => {
    (listeners[name] = listeners[name] || []).push(cb);
    return () => {
      listeners[name] = (listeners[name] || []).filter((c) => c !== cb);
    };
  };
}

const trackPlayer = {
  configure: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(() => Promise.resolve()),
  setQueue: jest.fn(() => Promise.resolve()),
  addToQueue: jest.fn(() => Promise.resolve()),
  removeFromQueue: jest.fn(() => Promise.resolve()),
  moveInQueue: jest.fn(() => Promise.resolve()),
  getQueue: jest.fn(() => []),
  clearQueue: jest.fn(() => Promise.resolve()),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  retry: jest.fn(() => Promise.resolve()),
  seekTo: jest.fn(() => Promise.resolve()),
  skipToIndex: jest.fn(() => Promise.resolve()),
  skipToNext: jest.fn(() => Promise.resolve()),
  skipToPrevious: jest.fn(() => Promise.resolve()),
  setPlaybackMode: jest.fn(() => Promise.resolve()),
  getPlaybackMode: jest.fn(() => ({ kind: 'gapless' })),
  setPlaybackSpeed: jest.fn(() => Promise.resolve()),
  setPitchCorrectionMode: jest.fn(() => Promise.resolve()),
  setVolume: jest.fn(() => Promise.resolve()),
  setRepeatMode: jest.fn(() => Promise.resolve()),
  setRemoteControls: jest.fn(() => Promise.resolve()),
  getRemoteControls: jest.fn(() => ({
    skipMode: 'track',
    forwardJumpInterval: 15,
    backwardJumpInterval: 15,
  })),
  setSleepTimer: jest.fn(() => Promise.resolve()),
  setSleepTimerToTrackEnd: jest.fn(() => Promise.resolve()),
  clearSleepTimer: jest.fn(() => Promise.resolve()),
  getSleepTimer: jest.fn(() => ({ active: false, endOfTrack: false })),
  shuffleQueue: jest.fn(() => Promise.resolve({ tracks: [], currentIndex: -1 })),
  getState: jest.fn(() => 'none'),
  getCurrentTrackIndex: jest.fn(() => -1),
  getCurrentTrackSource: jest.fn(() => undefined),
  getPlaybackSpeed: jest.fn(() => 1),
  getPitchCorrectionMode: jest.fn(() => 'none'),
  getVolume: jest.fn(() => 1),
  getBufferState: jest.fn(() => 'empty'),
  getIsSeekable: jest.fn(() => true),
  isFullyBuffered: jest.fn(() => false),
  getCanSkipNext: jest.fn(() => false),
  getCanSkipPrevious: jest.fn(() => false),
  getSkipCapability: jest.fn(() => ({ canSkipNext: false, canSkipPrevious: false })),
  isCarConnected: jest.fn(() => true),
  setBrowseSnapshot: jest.fn(),
  donateVoiceVocabulary: jest.fn(),
  setLookaheadCache: jest.fn(() => Promise.resolve()),
  getLookaheadCacheStatus: jest.fn(() => ({
    enabled: true,
    currentSizeMb: 0,
    maxSizeMb: 512,
    tracksFullyCached: 0,
    currentlyCaching: [],
  })),
  clearLookaheadCache: jest.fn(() => Promise.resolve()),
  setReplayGainMode: jest.fn(() => Promise.resolve()),
  getReplayGainMode: jest.fn(() => 'off'),
  getNowPlayingFormat: jest.fn(() => null),
  // event subscriptions (return disposers; record callbacks for __emit)
  onStateChange: makeSub('stateChange'),
  onTrackChange: makeSub('trackChange'),
  onProgress: makeSub('progress'),
  onPlaybackMilestone: makeSub('milestone'),
  onError: makeSub('error'),
  onQueueEnd: makeSub('queueEnd'),
  onGaplessGap: makeSub('gaplessGap'),
  onSkipCapabilityChange: makeSub('skipCapability'),
  onSleepTimerChange: makeSub('sleepTimer'),
  onBufferStateChange: makeSub('bufferState'),
  onFullyBufferedChange: makeSub('fullyBuffered'),
  onNowPlayingFormatChange: makeSub('nowPlayingFormat'),
  onCarConnect: makeSub('carConnect'),
  onCarDisconnect: makeSub('carDisconnect'),
  onBrowseRequest: makeSub('browse'),
  onSearchRequest: makeSub('search'),
  onPlayFromSearchRequest: makeSub('playFromSearch'),
  onPlayFromIdRequest: makeSub('playFromId'),
  onServiceReady: makeSub('serviceReady'),
  onCacheStatusChange: makeSub('cacheStatus'),
};

const castManager = {
  getCurrentAudioRoute: jest.fn(() => ({ kind: 'speaker', name: '' })),
  onAudioRouteChange: jest.fn(() => () => {}),
};

const cast = {
  getSupportedProtocols: jest.fn(() => ['local']),
  isCastAvailable: jest.fn(() => false),
  startDiscovery: jest.fn(() => Promise.resolve()),
  stopDiscovery: jest.fn(() => Promise.resolve()),
  connect: jest.fn(() => Promise.resolve()),
  disconnect: jest.fn(() => Promise.resolve()),
  showSystemPicker: jest.fn(() => Promise.resolve()),
  CastErrorCodes: { CONNECT_FAILED: 'cast_connect_failed', AUTH_REQUIRED: 'cast_auth_required' },
};

// --- Equalizer: stateful mock so UI + service wrappers behave realistically ---
const EQ_BAND_FREQUENCIES_HZ = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_BAND_COUNT = 10;
const EQ_GAIN_MIN_DB = -12;
const EQ_GAIN_MAX_DB = 12;
const EQ_FLAT_PRESET_NAME = 'Flat';
const eqBuiltinPresets = [
  { name: 'Flat', gains: new Array(10).fill(0), builtin: true },
  { name: 'Rock', gains: [5, 4, 3, 1, -1, -1, 2, 3, 4, 4], builtin: true },
  { name: 'Jazz', gains: [4, 3, 1, 2, -2, -2, 0, 1, 3, 4], builtin: true },
];
let eqEnabled = false;
let eqBands = EQ_BAND_FREQUENCIES_HZ.map((hz) => ({ frequencyHz: hz, gainDb: 0 }));
let eqCustomPresets = [];
const eqSetGains = (gains) => {
  eqBands = eqBands.map((b, i) => ({ ...b, frequencyHz: b.frequencyHz, gainDb: gains[i] ?? 0 }));
};
const equalizer = {
  setEnabled: jest.fn((v) => { eqEnabled = v; return Promise.resolve(); }),
  isEnabled: jest.fn(() => eqEnabled),
  getBands: jest.fn(() => eqBands),
  setBandGain: jest.fn((i, g) => { eqBands = eqBands.map((b, idx) => (idx === i ? { ...b, gainDb: g } : b)); return Promise.resolve(); }),
  setAllBandGains: jest.fn((gains) => { eqSetGains(gains); return Promise.resolve(); }),
  applyPreset: jest.fn((name) => {
    const p = [...eqBuiltinPresets, ...eqCustomPresets].find((x) => x.name === name);
    if (p) eqSetGains(p.gains);
    return Promise.resolve();
  }),
  getPresets: jest.fn(() => [...eqBuiltinPresets, ...eqCustomPresets]),
  saveCustomPreset: jest.fn((name) => {
    eqCustomPresets = eqCustomPresets.filter((p) => p.name !== name);
    eqCustomPresets.push({ name, gains: eqBands.map((b) => b.gainDb), builtin: false });
    return Promise.resolve();
  }),
  deleteCustomPreset: jest.fn((name) => { eqCustomPresets = eqCustomPresets.filter((p) => p.name !== name); return Promise.resolve(); }),
  reset: jest.fn(() => { eqSetGains(new Array(10).fill(0)); return Promise.resolve(); }),
  onBandChange: jest.fn(() => () => {}),
  onEnabledChange: jest.fn((cb) => { cb(eqEnabled); return () => {}; }),
};

// --- Automotive (CarPlay / Android Auto) ---
const SectionIcon = {
  Home: 'home',
  Library: 'library',
  Playlists: 'playlists',
  Favourites: 'favourites',
  Albums: 'albums',
  Artists: 'artists',
  Songs: 'songs',
  Genres: 'genres',
  RecentlyPlayed: 'recently-played',
  Radio: 'radio',
  Search: 'search',
  Downloaded: 'downloaded',
  Podcasts: 'podcasts',
};

module.exports = {
  __esModule: true,
  getTrackPlayer: jest.fn(() => trackPlayer),
  getEqualizer: jest.fn(() => equalizer),
  SectionIcon,
  registerPlaybackService: jest.fn(),
  unregisterPlaybackService: jest.fn(),
  EQ_BAND_FREQUENCIES_HZ,
  EQ_BAND_COUNT,
  EQ_GAIN_MIN_DB,
  EQ_GAIN_MAX_DB,
  EQ_FLAT_PRESET_NAME,
  isBuiltinPreset: (presets, name) => presets.some((p) => p.name === name && p.builtin),
  useEqualizer: () => ({
    enabled: equalizer.isEnabled(),
    bands: equalizer.getBands(),
    presets: equalizer.getPresets(),
    setEnabled: equalizer.setEnabled,
    setBandGain: equalizer.setBandGain,
    setAllBandGains: equalizer.setAllBandGains,
    applyPreset: equalizer.applyPreset,
    saveCustomPreset: equalizer.saveCustomPreset,
    deleteCustomPreset: equalizer.deleteCustomPreset,
    reset: equalizer.reset,
  }),
  __equalizer: equalizer,
  getVisualizer: jest.fn(() => ({})),
  getCastManager: jest.fn(() => castManager),
  Cast: cast,
  // hooks
  useProgress: () => ({ position: 0, duration: 0, buffered: 0 }),
  usePlaybackState: () => ({ state: 'none', reason: 'system' }),
  useActiveTrack: () => ({ track: undefined, index: -1, reason: 'queue-replaced' }),
  useCanSkip: () => ({ canSkipNext: false, canSkipPrevious: false }),
  useSleepTimer: () => ({ active: false, endOfTrack: false }),
  useBufferState: () => 'empty',
  useNowPlayingFormat: () => null,
  useCast: () => ({
    route: { castProtocol: 'local', name: '', receiverId: '' },
    receivers: [],
    isDiscovering: false,
    permission: 'granted',
    isAvailable: true,
  }),
  useAudioRoute: () => ({ kind: 'speaker', name: '' }),
  useLookaheadCache: () => ({
    status: trackPlayer.getLookaheadCacheStatus(),
    setConfig: trackPlayer.setLookaheadCache,
    clear: trackPlayer.clearLookaheadCache,
  }),
  // test helpers
  __trackPlayer: trackPlayer,
  __castManager: castManager,
  __emit: (name, ...args) => {
    (listeners[name] || []).forEach((cb) => cb(...args));
  },
  __resetPlayerMock: () => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    for (const key of Object.keys(trackPlayer)) {
      if (typeof trackPlayer[key]?.mockClear === 'function') trackPlayer[key].mockClear();
    }
  },
};
