jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    View,
    useSharedValue: (init: unknown) => ({ value: init }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withSpring: (val: number) => val,
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';

const { LyricsInterludeRow } = require('../LyricsInterludeRow');

function setup({
  pairIndex = 0,
  activeIndex = 0,
  extrapolatedMs = 0,
  fromMs = 0,
  toMs = 10_000,
}: {
  pairIndex?: number;
  activeIndex?: number;
  extrapolatedMs?: number;
  fromMs?: number;
  toMs?: number;
} = {}) {
  return render(
    <LyricsInterludeRow
      pairIndex={pairIndex}
      activeIndex={{ value: activeIndex }}
      fromMs={fromMs}
      toMs={toMs}
      extrapolatedMs={{ value: extrapolatedMs }}
      textColor="#ffffff"
    />,
  );
}

describe('LyricsInterludeRow', () => {
  it('renders three dots', () => {
    const { UNSAFE_root } = setup();
    // Flatten style arrays and count views whose style resolves to include a backgroundColor.
    const viewsWithBg = UNSAFE_root.findAll((n) => {
      const style = n.props.style;
      if (!style) return false;
      const list = Array.isArray(style) ? style.flat(Infinity) : [style];
      return list.some(
        (s: unknown) =>
          typeof s === 'object' && s !== null && 'backgroundColor' in (s as object),
      );
    });
    expect(viewsWithBg.length).toBeGreaterThanOrEqual(3);
  });

  it('renders without crashing when activeIndex is not this pair (inactive state)', () => {
    const { UNSAFE_root } = setup({ pairIndex: 2, activeIndex: 0 });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders without crashing when gap span is zero', () => {
    const { UNSAFE_root } = setup({ fromMs: 1000, toMs: 1000 });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('clamps progress above 1 without crashing', () => {
    const { UNSAFE_root } = setup({
      fromMs: 0,
      toMs: 5000,
      extrapolatedMs: 100_000, // far past toMs
      activeIndex: 0,
      pairIndex: 0,
    });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('clamps progress below 0 without crashing', () => {
    const { UNSAFE_root } = setup({
      fromMs: 10_000,
      toMs: 15_000,
      extrapolatedMs: 0, // before fromMs
      activeIndex: 0,
      pairIndex: 0,
    });
    expect(UNSAFE_root).toBeTruthy();
  });
});
