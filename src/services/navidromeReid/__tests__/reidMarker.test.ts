const mockStore = new Map<string, string>();

jest.mock('../../../store/persistence', () => ({
  kvStorageSync: {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => { mockStore.set(k, v); },
    removeItem: (k: string) => { mockStore.delete(k); },
  },
}));

let mockPing: unknown = { status: 'ok', serverVersion: '0.64.0 (1072e9f7)' };
let mockPingDelayMs = 0;
let mockApiNull = false;
jest.mock('../../subsonicService', () => ({
  getApi: () => (mockApiNull ? null : {
    ping: () => new Promise((resolve, reject) => {
      setTimeout(() => (mockPing instanceof Error ? reject(mockPing) : resolve(mockPing)), mockPingDelayMs);
    }),
  }),
}));

let mockOfflineMode = false;
jest.mock('../../../store/offlineModeStore', () => ({
  offlineModeStore: { getState: () => ({ offlineMode: mockOfflineMode }) },
}));

let mockHasConnection = true;
let mockServerReachable = true;
jest.mock('../../../store/connectivityStore', () => ({
  connectivityStore: {
    getState: () => ({
      hasConnection: mockHasConnection,
      isServerReachable: mockServerReachable,
    }),
  },
}));

let mockServerType: string | null = 'navidrome';
let mockServerVersion: string | null = '0.64.0 (1072e9f7)';
jest.mock('../../../store/serverInfoStore', () => ({
  serverInfoStore: { getState: () => ({ serverType: mockServerType, serverVersion: mockServerVersion }) },
}));

import { probeServerVersion, resetProbeState } from '../reidProbe';
import {
  clearReidMarker,
  resetReidProbeState,
  shouldBlockLibraryWrites,
  isReidComplete,
  isReidRequired,
  hasContinuedAfterFailureThisSession,
  hasServerAnswered,
  isLegacyThisSession,
  reidVerdict,
  resetReidSessionLatches,
  setContinuedAfterFailureThisSession,
  setLegacyThisSession,
  setReidState,
  shouldBlockContent,
  shouldHoldScrobbles,
} from '../reidMarker';

beforeEach(() => {
  mockStore.clear();
  mockServerType = 'navidrome';
  mockServerVersion = '0.64.0 (1072e9f7)';
  mockPing = { status: 'ok', serverVersion: '0.64.0 (1072e9f7)' };
  mockPingDelayMs = 0;
  mockApiNull = false;
  mockOfflineMode = false;
  mockHasConnection = true;
  mockServerReachable = true;
  resetReidProbeState();
  resetProbeState();
  resetReidSessionLatches();
});

describe('reidMarker', () => {
  it('requires the pass on an affected server with no marker', () => {
    expect(isReidRequired()).toBe(true);
    expect(isReidComplete()).toBe(false);
  });

  it('stops requiring it once complete', () => {
    setReidState('complete');
    expect(isReidComplete()).toBe(true);
    expect(isReidRequired()).toBe(false);
  });

  it('still requires it while pending', () => {
    setReidState('pending');
    expect(isReidComplete()).toBe(false);
    expect(isReidRequired()).toBe(true);
  });

  it('never fires on an unaffected server', () => {
    mockServerVersion = '0.63.2';
    expect(isReidRequired()).toBe(false);
    mockServerType = 'gonic';
    mockServerVersion = '0.64.0';
    expect(isReidRequired()).toBe(false);
  });

  it('asks when the version has no number, development builds included', () => {
    mockServerVersion = 'dev';
    expect(reidVerdict()).toBe('ask');
    expect(isReidRequired()).toBe(false);
  });

  it('asks rather than guessing on an ambiguous snapshot', () => {
    mockServerVersion = '0.0.0-SNAPSHOT (deadbee)';
    expect(reidVerdict()).toBe('ask');
    expect(isReidRequired()).toBe(false);
  });

  it('skips everything once complete, even an ambiguous version', () => {
    mockServerVersion = '0.0.0-SNAPSHOT (deadbee)';
    setReidState('complete');
    expect(reidVerdict()).toBe('skip');
  });

  it('treats an unreadable marker as not done', () => {
    mockStore.set('substreamer-navidrome-reid', '{not json');
    expect(isReidComplete()).toBe(false);
    expect(isReidRequired()).toBe(true);
  });

  it('serves headless content for an undetermined version (legacy mode)', () => {
    mockServerVersion = '0.0.0-SNAPSHOT (deadbee)';
    expect(isReidRequired()).toBe(false);
    expect(shouldBlockContent()).toBe(false);
  });

  it('blocks headless content while the pass is outstanding', () => {
    expect(shouldBlockContent()).toBe(true);
  });

  it('holds scrobbles while the pass is outstanding', () => {
    expect(shouldHoldScrobbles()).toBe(true);
  });

  it('holds scrobbles for an undetermined version until legacy mode is chosen', () => {
    // Navidrome answers OK to a scrobble it cannot register, so one sent under the wrong
    // ids is lost; the answer decides which ids are right.
    mockServerVersion = 'dev';
    expect(shouldHoldScrobbles()).toBe(true);
    setLegacyThisSession();
    expect(shouldHoldScrobbles()).toBe(false);
  });

  it('submits scrobbles for an unaffected server', () => {
    mockServerVersion = '0.63.2';
    expect(shouldHoldScrobbles()).toBe(false);
  });

  it('forgets both session answers on reset', () => {
    setLegacyThisSession();
    setContinuedAfterFailureThisSession();
    resetReidSessionLatches();
    expect(isLegacyThisSession()).toBe(false);
    expect(hasContinuedAfterFailureThisSession()).toBe(false);
  });

  it('treats an unknown marker value as not done', () => {
    mockStore.set('substreamer-navidrome-reid', JSON.stringify({ state: 'halfway' }));
    expect(isReidComplete()).toBe(false);
  });

  it('clears', () => {
    setReidState('complete');
    clearReidMarker();
    expect(isReidComplete()).toBe(false);
  });

  it('blocks headless content exactly when the pass is required', () => {
    expect(shouldBlockContent()).toBe(true);
    setReidState('complete');
    expect(shouldBlockContent()).toBe(false);
  });

  it('does not block a user who never needed the pass', () => {
    mockServerType = 'subsonic';
    expect(shouldBlockContent()).toBe(false);
  });

  describe('before serverInfoStore has hydrated', () => {
    // The store persists through the ASYNC kvStorage, so a headless cold wake reads
    // serverType: null from memory while the persisted blob says navidrome.
    beforeEach(() => {
      mockServerType = null;
      mockServerVersion = null;
      mockStore.set(
        'substreamer-server-info',
        JSON.stringify({ state: { serverType: 'navidrome', serverVersion: '0.64.0 (1072e9f7)' } }),
      );
    });

    it('falls back to the persisted blob rather than reading as "not Navidrome"', () => {
      expect(reidVerdict()).toBe('run');
      expect(shouldBlockContent()).toBe(true);
    });

    it('still skips when the persisted server is below 0.64', () => {
      mockStore.set(
        'substreamer-server-info',
        JSON.stringify({ state: { serverType: 'navidrome', serverVersion: '0.63.3 (abc)' } }),
      );
      expect(reidVerdict()).toBe('skip');
    });

    it('skips when nothing is persisted either - no server, nothing to corrupt', () => {
      mockStore.delete('substreamer-server-info');
      expect(reidVerdict()).toBe('skip');
      expect(shouldBlockContent()).toBe(false);
    });

    it('keeps the store answer when the blob is corrupt', () => {
      mockStore.set('substreamer-server-info', '{not json');
      expect(reidVerdict()).toBe('skip');
    });

    it('prefers the live store once it HAS hydrated', () => {
      mockServerType = 'subsonic';
      expect(reidVerdict()).toBe('skip');
    });
  });
});

describe('the live version probe', () => {
  // The bug this exists for: the persisted version is the PRE-upgrade one on exactly the
  // launch the pass is needed.
  it('overrides a stale persisted version with what the server reports', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    expect(reidVerdict()).toBe('skip');          // stale copy says unaffected
    await (probeServerVersion() ?? Promise.resolve());
    expect(reidVerdict()).toBe('run');           // the server says otherwise
  });

  it('does not route through serverInfoStore, which a late hydration would clobber', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    await (probeServerVersion() ?? Promise.resolve());
    // Simulate zustand's persist merge restoring the stale value after hydration.
    mockServerType = 'navidrome';
    mockServerVersion = '0.61.2 (aa84e645)';
    expect(reidVerdict()).toBe('run');
  });

  it('blocks library writes until the probe settles', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    expect(shouldBlockLibraryWrites()).toBe(true);   // unsettled - fail safe
    await (probeServerVersion() ?? Promise.resolve());
    expect(shouldBlockLibraryWrites()).toBe(true);   // settled, and it IS affected
  });

  it('leaves writes open for an undetermined version once the server answers', async () => {
    // Legacy mode is fully functional on the old ids.
    mockServerVersion = 'dev';
    mockPing = { status: 'ok', serverVersion: 'dev' };
    await (probeServerVersion() ?? Promise.resolve());
    expect(reidVerdict()).toBe('ask');
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('releases writes once the probe confirms an unaffected server', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    mockPing = { status: 'ok', serverVersion: '0.61.2 (aa84e645)' };
    await (probeServerVersion() ?? Promise.resolve());
    expect(reidVerdict()).toBe('skip');
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('blocks writes when the server never answered, but stays retryable', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    mockPing = new Error('unreachable');
    await (probeServerVersion() ?? Promise.resolve());

    // Settled, but with no answer the verdict would fall back to the stale persisted
    // version. Blocking is the fail-safe direction; it is bounded because the probe
    // can still be retried.
    expect(shouldBlockLibraryWrites()).toBe(true);
    expect(probeServerVersion()).not.toBeNull();
  });

  // Offline mode is a user choice on a possibly-connected device, and it can be revoked
  // mid-session. Claiming an answer we never asked for let the stale persisted version
  // decide, turned every write guard off, and made the next call skip re-probing.
  it('does NOT settle in offline mode, and keeps writes blocked', async () => {
    mockOfflineMode = true;
    mockServerVersion = '0.61.2 (aa84e645)';

    expect(probeServerVersion()).toBeNull();
    expect(shouldBlockLibraryWrites()).toBe(true);
  });

  it('re-probes for real once offline mode is turned off', async () => {
    mockOfflineMode = true;
    mockServerVersion = '0.61.2 (aa84e645)';
    expect(probeServerVersion()).toBeNull();

    mockOfflineMode = false;
    await (probeServerVersion() ?? Promise.resolve());

    // The server said 0.64, so the stale persisted 0.61 no longer decides.
    expect(reidVerdict()).toBe('run');
    expect(shouldBlockLibraryWrites()).toBe(true);
  });

  it('never blocks writes for a non-Navidrome server', () => {
    mockServerType = 'subsonic';
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('never blocks writes once the pass has completed', () => {
    setReidState('complete');
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('runs at most one request for concurrent callers', async () => {
    mockPingDelayMs = 5;
    await Promise.all([probeServerVersion(), probeServerVersion(), probeServerVersion()].map((p) => p ?? Promise.resolve()));
    expect(reidVerdict()).toBe('run');
  });

  it('does not hold the splash when the server is unreachable, but stays unsettled', () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    mockServerReachable = false;
    // null means "nothing to wait for" — the caller proceeds in the same tick — but we
    // have no answer, so writes stay refused until we can actually ask.
    expect(probeServerVersion()).toBeNull();
    expect(shouldBlockLibraryWrites()).toBe(true);
  });

  // A timeout is different from never asking: the server WAS asked and did not answer,
  // so it must settle or an unreachable server would block writes forever.
  it('releases writes once the server answers and says it is below the floor', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    mockPing = { status: 'ok', serverVersion: '0.61.2 (aa84e645)' };
    await (probeServerVersion() ?? Promise.resolve());

    // A real answer below the floor means no re-key is needed and the sync is safe.
    expect(shouldBlockLibraryWrites()).toBe(false);
  });

  it('returns null synchronously for a non-Navidrome server', () => {
    mockServerType = 'subsonic';
    expect(probeServerVersion()).toBeNull();
  });

  it('returns null synchronously once the pass is complete', () => {
    setReidState('complete');
    expect(probeServerVersion()).toBeNull();
  });
});

describe('a timed-out probe stays retryable', () => {
  // One 4s timeout used to freeze the session: probeDone latched, so the online-resume
  // re-probe returned null, the pass stayed refused and writes stayed blocked until
  // relaunch. The probe's budget is tighter than the connectivity ping's, so a
  // slow-but-alive server hit this.
  it('re-probes after a timeout, and succeeds the second time', async () => {
    mockServerVersion = '0.61.2 (aa84e645)';
    mockPing = new Error('unreachable');
    await (probeServerVersion() ?? Promise.resolve());
    expect(reidVerdict()).toBe('skip');   // fell back to the stale persisted version

    // The server comes back.
    mockPing = { status: 'ok', serverVersion: '0.64.0 (1072e9f7)' };
    const second = probeServerVersion();
    expect(second).not.toBeNull();
    await (second ?? Promise.resolve());

    expect(reidVerdict()).toBe('run');
  });

  it('answers a server that takes 4.5s, which the heartbeat counts as reachable', async () => {
    // One time limit for every ping: a server the heartbeat accepts is never one the
    // probe gives up on.
    jest.useFakeTimers();
    try {
      mockPingDelayMs = 4_500;
      const probe = probeServerVersion();
      await jest.advanceTimersByTimeAsync(4_600);
      await probe;
      expect(hasServerAnswered()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops probing once the server has actually answered', async () => {
    await (probeServerVersion() ?? Promise.resolve());
    expect(probeServerVersion()).toBeNull();
  });

  // A Subsonic-level failure arrives as HTTP 200 with status 'failed'. The server
  // plainly exists, so it counts as an answer — otherwise an auth error would block
  // library writes for the whole session.
  it('counts a well-formed failure envelope as the server existing', async () => {
    mockPing = { status: 'failed' };
    await (probeServerVersion() ?? Promise.resolve());
    expect(probeServerVersion()).toBeNull();
  });
});

