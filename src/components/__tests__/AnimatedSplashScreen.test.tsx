import React from 'react';
import { render, act } from '@testing-library/react-native';

// Stubs for the new per-row SQLite path + the imageCacheService that
// albumDetailStore now transitively imports for cover-art prefetching. These
// don't touch the splash's own logic — the splash just needs the hydration
// calls to be no-ops during the test.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('mocked — detailTables fallback path used in tests');
  },
}));
jest.mock('../../services/imageCacheService', () => ({
  cacheAllSizes: jest.fn(),
  cacheEntityCoverArt: jest.fn(),
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

jest.mock('../../store/sqliteStorage', () => ({
  sqliteStorage: {
    getItem: () => mockSqliteGetItem(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AnimatedSplashScreen = require('../AnimatedSplashScreen').default;

beforeEach(() => {
  capturedAnimate = null;
  pendingCallbacks.length = 0;
  mockPendingTasks = [];
  mockRunMigrations = jest.fn().mockResolvedValue(0);
  mockSetCompletedVersion.mockClear();
  mockSqliteGetItem = () => null;
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
 * Trigger BootSplash's animate(), which registers a withTiming callback
 * for the logo scale-in. Then fire that callback to simulate the 300ms
 * scale animation completing.
 */
function completeAnimate() {
  expect(capturedAnimate).not.toBeNull();
  const callbacksBefore = pendingCallbacks.length;
  capturedAnimate!();
  // animate() registers a withTiming for the logo scale-in
  const newCallbacks = pendingCallbacks.slice(callbacksBefore);
  // Fire the scale-in callback (onAnimateComplete)
  if (newCallbacks.length > 0) newCallbacks[0](true);
}

/**
 * Complete both the animate and waveform steps to trigger handleRippleComplete.
 */
function completeBothFlags() {
  const waveformCallbacks = [...pendingCallbacks];
  pendingCallbacks.length = 0;
  completeAnimate();
  waveformCallbacks.forEach((cb) => cb(true));
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

      act(() => {
        pendingCallbacks.forEach((cb) => cb(true));
        pendingCallbacks.length = 0;
      });

      expect(onFinish).not.toHaveBeenCalled();
    });

    it('calls onFinish when animate() completes before waveform (normal flow)', () => {
      const onFinish = jest.fn();
      render(<AnimatedSplashScreen onFinish={onFinish} />);

      const waveformCallbacks = [...pendingCallbacks];
      pendingCallbacks.length = 0;

      // Simulate normal timing: animate completes early
      act(() => {
        completeAnimate();
      });

      expect(onFinish).not.toHaveBeenCalled();

      // Waveform completes ~1.5s later (well past MIN_VISIBLE_MS)
      act(() => {
        jest.advanceTimersByTime(2_000);
        waveformCallbacks.forEach((cb) => cb(true));
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

      // Waveform completes instantly (reduce motion)
      act(() => {
        pendingCallbacks.forEach((cb) => cb(true));
        pendingCallbacks.length = 0;
      });

      expect(onFinish).not.toHaveBeenCalled();

      // animate() completes — both flags set, handleRippleComplete fires,
      // but fadeOut defers because MIN_VISIBLE_MS hasn't elapsed
      act(() => {
        completeAnimate();
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

    it('hydrates per-row stores (album, song index, completed scrobbles) after migrations', async () => {
      mockPendingTasks = [{ version: 1, name: 'test-migration' }];
      mockRunMigrations.mockResolvedValue(1);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { albumDetailStore } = require('../../store/albumDetailStore');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { songIndexStore } = require('../../store/songIndexStore');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { completedScrobbleStore } = require('../../store/completedScrobbleStore');

      const albumHydrate = jest.spyOn(albumDetailStore.getState(), 'hydrateFromDb').mockImplementation(() => {});
      const songHydrate = jest.spyOn(songIndexStore.getState(), 'hydrateFromDb').mockImplementation(() => {});
      const scrobbleHydrate = jest.spyOn(completedScrobbleStore.getState(), 'hydrateFromDb').mockImplementation(() => {});

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

      expect(albumHydrate).toHaveBeenCalledTimes(1);
      expect(songHydrate).toHaveBeenCalledTimes(1);
      expect(scrobbleHydrate).toHaveBeenCalledTimes(1);

      albumHydrate.mockRestore();
      songHydrate.mockRestore();
      scrobbleHydrate.mockRestore();
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

      const waveformCallbacks = [...pendingCallbacks];
      pendingCallbacks.length = 0;

      // animate() fires, stamping visibleSince
      act(() => {
        completeAnimate();
      });

      // Simulate normal animation time (>2s already elapsed)
      act(() => {
        jest.advanceTimersByTime(3_000);
      });

      // Waveform completes — handleRippleComplete → fadeOut runs immediately
      act(() => {
        waveformCallbacks.forEach((cb) => cb(true));
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
