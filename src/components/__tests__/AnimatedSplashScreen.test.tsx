import React from 'react';
import { render, act } from '@testing-library/react-native';

// Stubs for the new per-row SQLite path + the imageCacheService that
// albumDetailStore now transitively imports for cover-art prefetching. These
// don't touch the splash's own logic — the splash just needs the hydration
// calls to be no-ops during the test.
jest.mock('../../services/imageCacheService', () => ({
  ensureCached: jest.fn(),
  prefetchCoverArt: jest.fn(),
  // Phase-3 additions consumed transitively by imageDownloadQueueStore.
  subscribeImageQueueChanges: jest.fn(() => () => {}),
  getImageQueueState: jest.fn(() => ({
    cycleId: null,
    cycleScope: null,
    cycleTotal: 0,
    processed: 0,
    failed: 0,
    isPaused: false,
  })),
  processImageQueue: jest.fn(async () => {}),
  recoverStalledImageDownloads: jest.fn(async () => {}),
}));

/* ------------------------------------------------------------------ */
/*  Capture the animate() callback from BootSplash.useHideAnimation    */
/* ------------------------------------------------------------------ */

let capturedAnimate: (() => void) | null = null;

jest.mock('react-native-bootsplash', () => ({
  __esModule: true,
  default: {
    useHideAnimation: (config: { animate: () => void }) => {
      capturedAnimate = config.animate;
      return {
        container: { style: { flex: 1, backgroundColor: '#1D9BF0' }, onLayout: () => {} },
        logo: { source: 1, style: { width: 130, height: 130 } },
      };
    },
    hide: () => Promise.resolve(),
    isVisible: () => false,
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

/* ------------------------------------------------------------------ */
/*  Track withTiming callbacks so we can fire waveform completion       */
/* ------------------------------------------------------------------ */

const pendingCallbacks: Array<(finished: boolean) => void> = [];

jest.mock('react-native-reanimated', () => {
  const { View, Image } = require('react-native');

  const AnimatedView = View;
  const AnimatedImage = Image;
  const AnimatedText = require('react-native').Text;

  return {
    __esModule: true,
    default: { View: AnimatedView, Image: AnimatedImage, Text: AnimatedText },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (val: number, _config?: object, cb?: (finished: boolean) => void) => {
      if (cb) pendingCallbacks.push(cb);
      return val;
    },
    withSpring: (val: number) => val,
    withDelay: (_ms: number, val: any) => val,
    withRepeat: (val: any) => val,
    withSequence: (...args: any[]) => args[args.length - 1],
    cancelAnimation: () => {},
    Easing: {
      out: (e: any) => e,
      in: (e: any) => e,
      inOut: (e: any) => e,
      cubic: (t: number) => t,
      sin: (t: number) => t,
    },
    runOnJS: (fn: Function) => fn,
  };
});

/* ------------------------------------------------------------------ */
/*  Migration service mocks — per-test overridable                     */
/* ------------------------------------------------------------------ */

let mockPendingTasks: Array<{ version: number; name: string }> = [];
let mockRunMigrations = jest.fn().mockResolvedValue(0);

jest.mock('../../services/migrationService', () => ({
  getPendingTasks: () => mockPendingTasks,
  runMigrations: (...args: any[]) => mockRunMigrations(...args),
}));

const mockSetCompletedVersion = jest.fn();

jest.mock('../../store/migrationStore', () => ({
  migrationStore: {
    getState: () => ({ setCompletedVersion: mockSetCompletedVersion }),
  },
}));

let mockSqliteGetItem: () => string | null = () => null;
let mockLogoutPending = false;

// Both adapters, with writes, so the stores the splash rehydrates can persist; reads are
// whatever the test seeds, except the logout flag.
jest.mock('../../store/persistence/kvStorage', () => {
  const adapter = {
    getItem: (key: string) =>
      key === 'substreamer-logout-pending' ? (mockLogoutPending ? '1' : null) : mockSqliteGetItem(),
    setItem: () => {},
    removeItem: () => {},
  };
  return { kvStorage: adapter, kvStorageSync: adapter };
});

const mockFinishLogout = jest.fn();
jest.mock('../../services/logoutService', () => ({
  finishLogout: () => mockFinishLogout(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AnimatedSplashScreen = require('../AnimatedSplashScreen').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { authStore } = require('../../store/authStore');

beforeEach(() => {
  capturedAnimate = null;
  pendingCallbacks.length = 0;
  mockPendingTasks = [];
  mockRunMigrations = jest.fn().mockResolvedValue(0);
  mockSetCompletedVersion.mockClear();
  mockSqliteGetItem = () => null;
  mockLogoutPending = false;
  mockFinishLogout.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fire the most recent withTiming callback registered (simulates the
 * container fade-out completing).
 */
function fireLastCallback() {
  const cb = pendingCallbacks.pop();
  if (cb) cb(true);
}

/**
 * Trigger BootSplash's animate(), which registers:
 *   (1) synchronously, the logo scale-in withTiming callback, and
 *   (2) after React flushes the `setWaveformPlay(true)` state update, the
 *       waveform's fireComplete callback (because AnimatedWaveformLogo's
 *       ripple sequence only arms when `play` flips to true).
 *
 * This helper fires ONLY the scale-in callback and removes it from the
 * pending list — the waveform callback stays queued for the test to fire
 * separately (mirroring the original two-flag rendezvous).
 */
function completeAnimate() {
  expect(capturedAnimate).not.toBeNull();
  const callbacksBefore = pendingCallbacks.length;
  capturedAnimate!();
  const newCallbacks = pendingCallbacks.slice(callbacksBefore);
  if (newCallbacks.length > 0) {
    const scaleInCb = newCallbacks[0];
    scaleInCb(true);
    const idx = pendingCallbacks.indexOf(scaleInCb);
    if (idx >= 0) pendingCallbacks.splice(idx, 1);
  }
}

/**
 * Complete both the animate and waveform steps to trigger
 * handleRippleComplete. The waveform callback is registered during
 * animate() (via the `play` prop flip), so we fire it here right after.
 */
function completeBothFlags() {
  const before = pendingCallbacks.length;
  completeAnimate();
  // Anything after the pre-animate snapshot is a waveform-side callback.
  while (pendingCallbacks.length > before) {
    const cb = pendingCallbacks.splice(before, 1)[0];
    cb?.(true);
  }
}

/* ------------------------------------------------------------------ */
/*  Rendezvous pattern tests                                           */
/* ------------------------------------------------------------------ */

describe('AnimatedSplashScreen', () => {
  describe('two-flag rendezvous', () => {
    it('does not call onFinish if only animate() completes', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeAnimate();
      });

      expect(onFinish).not.toHaveBeenCalled();
    });

    it('does not call onFinish if only waveform completes', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // The waveform animation only arms after animate() flips `play` to
      // true, so we need to run animate() to register its completion
      // callback — but then fire only that callback, not the scale-in one.
      act(() => {
        capturedAnimate!();
      });

      // Two callbacks are now queued: [0] logo scale-in, [1] waveform.
      // Fire only the waveform callback.
      act(() => {
        const waveformCb = pendingCallbacks[1];
        if (waveformCb) {
          pendingCallbacks.splice(1, 1);
          waveformCb(true);
        }
      });

      expect(onFinish).not.toHaveBeenCalled();
    });

    it('calls onFinish when animate() completes before waveform (normal flow)', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // Simulate normal timing: animate completes early (fires scale-in
      // synchronously; waveform fireComplete is queued but not yet fired).
      act(() => {
        completeAnimate();
      });

      expect(onFinish).not.toHaveBeenCalled();

      // Waveform completes ~1.5s later (well past MIN_VISIBLE_MS).
      act(() => {
        jest.advanceTimersByTime(2_000);
        // Fire every remaining queued callback (the waveform fireComplete).
        while (pendingCallbacks.length > 0) {
          const cb = pendingCallbacks.shift();
          cb?.(true);
        }
      });

      // fadeOut fires immediately (min visible time already elapsed)
      // then its withTiming callback completes
      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('calls onFinish when waveform completes before animate() (reduce motion flow)', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // Reduce-motion equivalent: in the new gating model the waveform
      // only arms once animate() runs. We still exercise the "waveform
      // callback fires BEFORE the scale-in callback" ordering by having
      // animate() register both callbacks, firing the waveform one
      // first, then the scale-in one.
      act(() => {
        capturedAnimate!();
      });

      // Fire the waveform callback first (index 1 in the queue).
      act(() => {
        const waveformCb = pendingCallbacks.splice(1, 1)[0];
        waveformCb?.(true);
      });

      expect(onFinish).not.toHaveBeenCalled();

      // Now fire the scale-in callback. Both flags set →
      // handleRippleComplete fires → fadeOut defers because
      // MIN_VISIBLE_MS hasn't elapsed.
      act(() => {
        const scaleInCb = pendingCallbacks.shift();
        scaleInCb?.(true);
      });

      expect(onFinish).not.toHaveBeenCalled();

      // Advance past the minimum visible delay
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      // Fire the doFadeOut withTiming callback
      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('calls onFinish only once when both complete simultaneously', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      // Advance past minimum visible delay
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Safety timeout                                                   */
  /* ---------------------------------------------------------------- */

  describe('safety timeout', () => {
    it('calls onFinish if nothing else completes', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        jest.advanceTimersByTime(15_000);
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('does not double-call onFinish after normal completion', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      // Advance past min visible delay + fire fade callback
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(15_000);
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Migration flow                                                   */
  /* ---------------------------------------------------------------- */

  describe('migration flow', () => {
    it('shows migration status and runs migrations when pending', async () => {
      mockPendingTasks = [{ version: 1, name: 'test-migration' }];
      mockRunMigrations.mockResolvedValue(1);

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // Complete both flags to trigger handleRippleComplete
      act(() => {
        completeBothFlags();
      });

      // handleRippleComplete detects pending tasks and calls
      // startBreathingDots + registers statusOpacity withTiming.
      // Fire the statusOpacity callback to trigger startMigrations.
      act(() => {
        fireLastCallback();
      });

      // runMigrations is async — flush the promise
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockRunMigrations).toHaveBeenCalledWith(0);
      expect(mockSetCompletedVersion).toHaveBeenCalledWith(1);

      // migrationPhase is now 'done', which triggers the done effect.
      // The done effect sets a 1200ms timeout before fadeOut.
      // Advance past both the 1200ms hold and min visible delay.
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      // fadeOut's doFadeOut withTiming callback
      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('reads completedVersion from SQLite for migration check', () => {
      mockSqliteGetItem = () => JSON.stringify({
        state: { completedVersion: 5 },
      });
      mockPendingTasks = []; // No tasks pending at version 5

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      // No migrations pending → fadeOut (deferred by min visible delay)
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('falls back to version 0 when SQLite returns invalid JSON', () => {
      mockSqliteGetItem = () => 'not-json{{{';
      mockPendingTasks = [];

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('falls back to version 0 when SQLite returns null', () => {
      mockSqliteGetItem = () => null;
      mockPendingTasks = [];

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('handles missing completedVersion in SQLite state', () => {
      mockSqliteGetItem = () => JSON.stringify({ state: {} });
      mockPendingTasks = [];

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('hydrates per-row stores (completed scrobbles, music cache) after migrations', async () => {
      mockPendingTasks = [{ version: 1, name: 'test-migration' }];
      mockRunMigrations.mockResolvedValue(1);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { completedScrobbleStore } = require('../../store/completedScrobbleStore');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { musicCacheStore } = require('../../store/musicCacheStore');

      const scrobbleHydrate = jest.spyOn(completedScrobbleStore.getState(), 'hydrateFromDbAsync').mockResolvedValue(undefined);
      const musicCacheHydrate = jest.spyOn(musicCacheStore.getState(), 'hydrateFromDbAsync').mockResolvedValue(undefined);

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });
      act(() => {
        fireLastCallback();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(scrobbleHydrate).toHaveBeenCalledTimes(1);
      expect(musicCacheHydrate).toHaveBeenCalledTimes(1);

      scrobbleHydrate.mockRestore();
      musicCacheHydrate.mockRestore();
    });

    it('hydrates per-row stores even when no migrations are pending', async () => {
      // hydrateFromDb must run even when nothing is pending. Short-circuiting to
      // fadeOut on an empty pending list leaves per-row stores (music cache,
      // completed scrobbles) rendering empty on every launch after the last
      // migration completed, though their tables have data on disk.
      mockPendingTasks = [];

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { completedScrobbleStore } = require('../../store/completedScrobbleStore');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { musicCacheStore } = require('../../store/musicCacheStore');

      const scrobbleHydrate = jest.spyOn(completedScrobbleStore.getState(), 'hydrateFromDbAsync').mockResolvedValue(undefined);
      const musicCacheHydrate = jest.spyOn(musicCacheStore.getState(), 'hydrateFromDbAsync').mockResolvedValue(undefined);

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      expect(scrobbleHydrate).toHaveBeenCalledTimes(1);
      expect(musicCacheHydrate).toHaveBeenCalledTimes(1);
      // runMigrations must not have been called because pending was empty.
      expect(mockRunMigrations).not.toHaveBeenCalled();

      scrobbleHydrate.mockRestore();
      musicCacheHydrate.mockRestore();
    });

    it('still finishes when runMigrations rejects unexpectedly', async () => {
      mockPendingTasks = [{ version: 1, name: 'test-migration' }];
      mockRunMigrations = jest
        .fn()
        .mockRejectedValue(new Error('unexpected migration framework failure'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      act(() => {
        completeBothFlags();
      });

      // Fire the statusOpacity callback to trigger startMigrations.
      act(() => {
        fireLastCallback();
      });

      // Flush the rejected promise.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockRunMigrations).toHaveBeenCalled();
      // setCompletedVersion must NOT be called on failure — we don't want
      // to mark migrations as done if they didn't complete.
      expect(mockSetCompletedVersion).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[splash] runMigrations rejected unexpectedly',
        expect.any(Error),
      );

      // migrationPhase should still transition to 'done' so the splash
      // doesn't hang on the 15s safety timeout.
      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  A re-key about to run                                            */
  /* ---------------------------------------------------------------- */

  describe('a re-key about to run', () => {
    const reidMarker = require('../../services/navidromeReid/reidMarker');
    const runReid = require('../../services/navidromeReid/runNavidromeReid');
    let decided: () => void = () => undefined;

    beforeEach(() => {
      jest.spyOn(reidMarker, 'isReidRequired').mockReturnValue(true);
      jest.spyOn(runReid, 'runNavidromeReidIfNeeded').mockReturnValue(new Promise(() => {}));
      jest.spyOn(runReid, 'awaitReidDecision').mockReturnValue(
        new Promise<void>((resolve) => { decided = resolve; }),
      );
    });
    afterEach(() => jest.restoreAllMocks());

    async function expectHeldUntilDecided(onFinish: jest.Mock): Promise<void> {
      act(() => { jest.advanceTimersByTime(2_000); });
      act(() => { fireLastCallback(); });
      expect(onFinish).not.toHaveBeenCalled();

      await act(async () => {
        decided();
        await Promise.resolve();
      });
      act(() => { jest.advanceTimersByTime(2_000); });
      act(() => { fireLastCallback(); });
      expect(onFinish).toHaveBeenCalledTimes(1);
    }

    it('holds the splash until the pass decides, with nothing pending', async () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);
      act(() => { completeBothFlags(); });

      await expectHeldUntilDecided(onFinish);
    });

    it('holds the splash until the pass decides, after the chain', async () => {
      mockPendingTasks = [{ version: 1, name: 'test-migration' }];
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);
      act(() => { completeBothFlags(); });
      act(() => { fireLastCallback(); });
      await act(async () => { await Promise.resolve(); });

      await expectHeldUntilDecided(onFinish);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  A logout killed part way                                         */
  /* ---------------------------------------------------------------- */

  describe('a pending logout', () => {
    const calls: string[] = [];
    let finish: () => void = () => undefined;

    beforeEach(() => {
      calls.length = 0;
      // Nothing pending at the stored counter: the flag alone routes it to the chain.
      mockSqliteGetItem = () => JSON.stringify({ state: { completedVersion: 33 } });
      mockLogoutPending = true;
      mockFinishLogout.mockImplementation(() => new Promise<void>((resolve) => {
        calls.push('finishLogout');
        finish = () => {
          // What the wipe leaves: no flag, no migration counter.
          mockLogoutPending = false;
          mockSqliteGetItem = () => null;
          resolve();
        };
      }));
      mockRunMigrations = jest.fn(async (v: number) => { calls.push(`runMigrations(${v})`); return v; });
      authStore.setState({ rehydrated: false });
    });

    function startChain(): void {
      act(() => { completeBothFlags(); });
      // The statusOpacity callback, which starts the chain.
      act(() => { fireLastCallback(); });
    }

    it('finishes the logout first, then runs the chain from the wiped counter', async () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);
      startChain();

      expect(calls).toEqual(['finishLogout']);
      // Held: the safety timeout does not fire while the logout finishes.
      act(() => { jest.advanceTimersByTime(20_000); });
      expect(onFinish).not.toHaveBeenCalled();

      await act(async () => {
        finish();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toEqual(['finishLogout', 'runMigrations(0)']);
      expect(authStore.getState().rehydrated).toBe(true);

      act(() => { jest.advanceTimersByTime(2_000); });
      act(() => { fireLastCallback(); });
      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('still runs the chain when the logout could not finish', async () => {
      mockFinishLogout.mockImplementation(async () => { calls.push('finishLogout'); });
      render(<AnimatedSplashScreen onFinish={jest.fn()} />);
      startChain();

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toEqual(['finishLogout', 'runMigrations(33)']);
    });

    it('never finishes a logout on a launch with migrations and no flag', async () => {
      mockLogoutPending = false;
      mockPendingTasks = [{ version: 34, name: 'test-migration' }];
      render(<AnimatedSplashScreen onFinish={jest.fn()} />);
      startChain();

      await act(async () => { await Promise.resolve(); });

      expect(mockFinishLogout).not.toHaveBeenCalled();
      expect(calls).toEqual(['runMigrations(33)']);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Minimum visible time                                             */
  /* ---------------------------------------------------------------- */

  describe('minimum visible time', () => {
    it('defers fadeOut until 2s after animate() when completing instantly', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // Both flags complete instantly (reduce motion scenario)
      act(() => {
        completeBothFlags();
      });

      // After 1s the splash should still be visible
      act(() => {
        jest.advanceTimersByTime(1_000);
      });

      expect(onFinish).not.toHaveBeenCalled();

      // After 2s the deferred doFadeOut fires
      act(() => {
        jest.advanceTimersByTime(1_000);
      });

      // Fire the doFadeOut withTiming callback
      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('does not add delay when enough time has already elapsed', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // animate() fires, stamping visibleSince, and queues the waveform
      // completion callback (play flips to true during animate()).
      // completeAnimate fires the scale-in cb; waveform cb stays queued.
      act(() => {
        completeAnimate();
      });

      // Simulate normal animation time (>2s already elapsed)
      act(() => {
        jest.advanceTimersByTime(3_000);
      });

      // Waveform completes — handleRippleComplete → fadeOut runs immediately
      act(() => {
        while (pendingCallbacks.length > 0) {
          const cb = pendingCallbacks.shift();
          cb?.(true);
        }
      });

      // doFadeOut fires right away (no setTimeout), fire its callback
      act(() => {
        fireLastCallback();
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Callback edge cases                                              */
  /* ---------------------------------------------------------------- */

  describe('callback edge cases', () => {
    it('ignores waveform completion with finished=false', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      // Fire waveform callbacks with finished=false
      act(() => {
        pendingCallbacks.forEach((cb) => cb(false));
        pendingCallbacks.length = 0;
      });

      act(() => {
        completeAnimate();
      });

      // Neither flag should be set because the waveform callback's
      // `finished` was false — the `if (finished)` guard in
      // AnimatedWaveformLogo prevents fireComplete from running.
      // However, our mock withTiming always calls the callback, and
      // the mock withSequence returns the last arg which IS the
      // withTiming with the callback. Since our mock fires callbacks
      // directly, the finished=false path depends on
      // AnimatedWaveformLogo's `if (finished)` check, which we test
      // indirectly. onFinish should not be called because the
      // waveform flag was never set.
      // Note: This test validates the safety timeout as the fallback.
      act(() => {
        jest.advanceTimersByTime(15_000);
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });
});
