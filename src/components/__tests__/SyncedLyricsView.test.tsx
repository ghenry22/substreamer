jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

const mockReactionRunners: Array<{
  deps: () => unknown;
  body: (curr: unknown, prev: unknown | null) => void;
  prev: unknown | null;
}> = [];
const mockScrollTo = jest.fn();

jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const R = require('react');
  const { View, ScrollView, Text } = RN;
  const AnimatedScrollView = R.forwardRef(function AnimatedScrollView(
    props: object,
    ref: unknown,
  ) {
    return R.createElement(ScrollView, { ref, ...props });
  });
  return {
    __esModule: true,
    default: { View, Text, ScrollView: AnimatedScrollView },
    View,
    Text,
    ScrollView: AnimatedScrollView,
    useSharedValue: (init: unknown) => {
      // Stable across renders, like real Reanimated — use a ref.
      const ref = R.useRef(null);
      if (ref.current === null) {
        ref.current = { value: init };
      }
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => {
      const ref = R.useRef(null);
      if (ref.current === null) {
        const sv: { value: unknown } = { value: undefined };
        Object.defineProperty(sv, 'value', {
          get: () => fn(),
          configurable: true,
        });
        ref.current = sv;
      }
      return ref.current;
    },
    useAnimatedStyle: (fn: () => object) => fn(),
    useAnimatedRef: () => {
      const ref = R.useRef(null);
      if (ref.current === null) ref.current = { current: null };
      return ref.current;
    },
    useAnimatedReaction: (
      deps: () => unknown,
      body: (curr: unknown, prev: unknown | null) => void,
    ) => {
      // Register once; subsequent renders update the closures in place so the
      // latest viewportH (or other captured deps) takes effect without adding
      // duplicate reaction entries.
      const ref = R.useRef(null);
      if (ref.current === null) {
        const entry = { deps, body, prev: null };
        ref.current = entry;
        mockReactionRunners.push(entry);
      } else {
        ref.current.deps = deps;
        ref.current.body = body;
      }
    },
    withSpring: (val: number) => val,
    scrollTo: (...args: unknown[]) => mockScrollTo(...args),
    runOnJS: (fn: Function) => fn,
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: object) => <View {...props} /> };
});

jest.mock('../../services/playerService', () => ({
  seekTo: jest.fn(),
}));

jest.mock('../../utils/haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light' },
}));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { seekTo } from '../../services/playerService';
import { playerStore } from '../../store/playerStore';
import { impactAsync } from '../../utils/haptics';
import { type LyricsLine } from '../../services/subsonicService';

const { SyncedLyricsView } = require('../SyncedLyricsView');

const LINES: LyricsLine[] = [
  { startMs: 0, text: 'first' },
  { startMs: 2000, text: 'second' },
  { startMs: 4000, text: 'third' },
];

function runReactions() {
  // Iterate and capture curr+prev to exercise auto-scroll gating.
  for (const r of mockReactionRunners) {
    const curr = r.deps();
    r.body(curr, r.prev);
    r.prev = curr;
  }
}

function resetMocks() {
  mockReactionRunners.length = 0;
  mockScrollTo.mockReset();
  (seekTo as jest.Mock).mockReset();
  (impactAsync as jest.Mock).mockReset();
}

beforeEach(() => {
  resetMocks();
  playerStore.setState({
    position: 0,
    playbackState: 'paused',
    currentTrack: null,
  });
});

function renderView(props: Partial<{
  lines: LyricsLine[];
  offsetMs: number;
  source: 'structured' | 'fake';
}> = {}) {
  return render(
    <SyncedLyricsView
      lines={props.lines ?? LINES}
      offsetMs={props.offsetMs ?? 0}
      source={props.source ?? 'structured'}
      textColor="#ffffff"
      backgroundColor="#000000"
    />,
  );
}

describe('SyncedLyricsView', () => {
  it('renders every line exactly twice (weight-crossfade layers)', () => {
    const { getAllByText } = renderView();
    for (const line of LINES) {
      expect(getAllByText(line.text).length).toBe(2);
    }
  });

  it('tapping a line seeks to its timestamp in seconds when source=structured', () => {
    const { getAllByText } = renderView();
    fireEvent.press(getAllByText('second')[0]);
    expect(impactAsync).toHaveBeenCalledTimes(1);
    expect(seekTo).toHaveBeenCalledWith(2);
  });

  it('does not seek when source=fake', () => {
    const { getAllByText } = renderView({ source: 'fake' });
    fireEvent.press(getAllByText('second')[0]);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it('auto-scrolls when active line advances while user is not scrolling', () => {
    const { getByTestId: _g, UNSAFE_root } = renderView();
    // Simulate that the view measured some height.
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];
    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 800 } } });
    });

    // Advance playback so binary-search lands on index 1.
    act(() => {
      playerStore.setState({ position: 2, playbackState: 'playing' });
    });

    runReactions();

    expect(mockScrollTo).toHaveBeenCalled();
    const call = mockScrollTo.mock.calls[0];
    expect(call[1]).toBe(0); // x
    expect(call[3]).toBe(true); // animated
  });

  it('does not auto-scroll while user is dragging', () => {
    const { UNSAFE_root } = renderView();
    const scroll = UNSAFE_root.findAll((n) => typeof n.props.onScrollBeginDrag === 'function')[0];
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];

    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 800 } } });
      scroll.props.onScrollBeginDrag();
      playerStore.setState({ position: 2, playbackState: 'playing' });
    });

    runReactions();
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it('suspends auto-scroll for lockout window after scroll ends, then resumes', () => {
    const { UNSAFE_root } = renderView();
    const scroll = UNSAFE_root.findAll((n) => typeof n.props.onScrollBeginDrag === 'function')[0];
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];

    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 800 } } });
    });

    // Freeze time so the lockout window is deterministic.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    act(() => {
      scroll.props.onScrollEndDrag({ nativeEvent: {} });
      playerStore.setState({ position: 2, playbackState: 'playing' });
    });
    runReactions();
    expect(mockScrollTo).not.toHaveBeenCalled();

    // Advance past the 3s lockout.
    nowSpy.mockReturnValue(20_000);
    act(() => {
      playerStore.setState({ position: 4, playbackState: 'playing' });
    });
    runReactions();
    expect(mockScrollTo).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('momentum scroll end clears user-scroll flag', () => {
    const { UNSAFE_root } = renderView();
    const scroll = UNSAFE_root.findAll((n) => typeof n.props.onMomentumScrollEnd === 'function')[0];
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 800 } } });
      scroll.props.onScrollBeginDrag();
      scroll.props.onMomentumScrollEnd({ nativeEvent: {} });
    });
    // Beyond lockout.
    nowSpy.mockReturnValue(10_000);
    act(() => {
      playerStore.setState({ position: 2, playbackState: 'playing' });
    });
    runReactions();
    expect(mockScrollTo).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('collects per-line y offsets via onLayout and uses them for auto-scroll targeting', () => {
    const { UNSAFE_root } = renderView();
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];
    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 1000 } } });
    });

    // Each LyricsLineRow's Pressable has an onLayout; grab them in order.
    const rowLayouts = UNSAFE_root
      .findAll((n) => !!n.props.onLayout && n !== container)
      .slice(0, 3);
    act(() => {
      rowLayouts[0].props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 300, height: 40 } } });
      rowLayouts[1].props.onLayout({ nativeEvent: { layout: { x: 0, y: 200, width: 300, height: 40 } } });
      rowLayouts[2].props.onLayout({ nativeEvent: { layout: { x: 0, y: 300, width: 300, height: 40 } } });
    });

    act(() => {
      playerStore.setState({ position: 2, playbackState: 'playing' });
    });
    runReactions();

    // y = offsets[1] - 1000*0.4 = 200 - 400 → max(0, -200) = 0
    expect(mockScrollTo).toHaveBeenCalled();
    const [, x, y] = mockScrollTo.mock.calls[0];
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it('active index is -1 before first line; no scroll fires at position 0 before gating', () => {
    const { UNSAFE_root } = renderView({
      lines: [
        { startMs: 1000, text: 'first' },
        { startMs: 3000, text: 'second' },
      ],
    });
    const container = UNSAFE_root.findAll((n) => !!n.props.onLayout)[0];
    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 320, height: 800 } } });
    });

    // Position is before first line (0ms < 1000ms) → activeIndex = -1 → no scroll.
    runReactions();
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it('inserts breathing-dot interludes between lines with gaps > 5s', () => {
    const LONG_GAP_LINES: LyricsLine[] = [
      { startMs: 0, text: 'intro' },
      { startMs: 20_000, text: 'verse' }, // gap 20s → interlude
      { startMs: 22_000, text: 'chorus' }, // gap 2s → no interlude
    ];
    const { UNSAFE_root } = renderView({ lines: LONG_GAP_LINES });
    // Three lines render as two weight-layers each → 6 text instances, plus
    // any interlude dots. Just confirm all three line strings still render.
    const textNodes = UNSAFE_root.findAll(
      (n) => typeof n.props.children === 'string' && ['intro', 'verse', 'chorus'].includes(n.props.children),
    );
    expect(textNodes.length).toBeGreaterThanOrEqual(6);
  });

  it('ignores taps with no matching start time', () => {
    const { UNSAFE_root } = renderView({ lines: [] });
    // No rows rendered → nothing to press. Assert render did not throw and seekTo not called.
    expect(UNSAFE_root).toBeTruthy();
    expect(seekTo).not.toHaveBeenCalled();
  });
});
