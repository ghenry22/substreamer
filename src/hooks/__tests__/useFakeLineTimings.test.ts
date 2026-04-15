import { renderHook } from '@testing-library/react-native';

import { useFakeLineTimings } from '../useFakeLineTimings';
import { type LyricsLine } from '../../services/subsonicService';

const LINES: LyricsLine[] = [
  { startMs: 0, text: 'a' },
  { startMs: 0, text: 'b' },
  { startMs: 0, text: 'c' },
  { startMs: 0, text: 'd' },
  { startMs: 0, text: 'e' },
];

describe('useFakeLineTimings', () => {
  it('returns null when durationSec is falsy', () => {
    const { result } = renderHook(() => useFakeLineTimings(LINES, null));
    expect(result.current).toBeNull();
  });

  it('returns null when durationSec is below the 60s floor', () => {
    const { result } = renderHook(() => useFakeLineTimings(LINES, 59));
    expect(result.current).toBeNull();
  });

  it('returns null when fewer than 4 lines', () => {
    const lines: LyricsLine[] = [
      { startMs: 0, text: 'a' },
      { startMs: 0, text: 'b' },
      { startMs: 0, text: 'c' },
    ];
    const { result } = renderHook(() => useFakeLineTimings(lines, 120));
    expect(result.current).toBeNull();
  });

  it('distributes lines evenly for a 120s track with 5 lines (ratio-bound lead-in/out)', () => {
    // leadIn = min(8, 120*0.15) = 8; leadOut = min(12, 120*0.2) = 12
    // span = 100; step = 20; starts: 8, 28, 48, 68, 88 (s) → ms
    const { result } = renderHook(() => useFakeLineTimings(LINES, 120));
    expect(result.current).not.toBeNull();
    const starts = result.current!.map((l) => l.startMs);
    expect(starts).toEqual([8_000, 28_000, 48_000, 68_000, 88_000]);
  });

  it('clamps lead-in at 8s and lead-out at 12s for a long track (600s)', () => {
    // leadIn = min(8, 600*0.15 = 90) = 8; leadOut = min(12, 600*0.2 = 120) = 12
    // span = 580; step = 116
    const { result } = renderHook(() => useFakeLineTimings(LINES, 600));
    expect(result.current).not.toBeNull();
    const starts = result.current!.map((l) => l.startMs);
    expect(starts[0]).toBe(8_000);
    // Each subsequent line should advance by ~116_000 ms.
    expect(starts[1] - starts[0]).toBe(116_000);
    expect(starts[4] - starts[0]).toBe(4 * 116_000);
  });

  it('uses ratio-bound lead-in/out when track is short enough (60s)', () => {
    // 60s: leadIn = min(8, 9) = 8; leadOut = min(12, 12) = 12; span = 40; step = 8
    const { result } = renderHook(() => useFakeLineTimings(LINES, 60));
    expect(result.current).not.toBeNull();
    const starts = result.current!.map((l) => l.startMs);
    expect(starts).toEqual([8_000, 16_000, 24_000, 32_000, 40_000]);
  });

  it('preserves line text unchanged', () => {
    const { result } = renderHook(() => useFakeLineTimings(LINES, 120));
    expect(result.current!.map((l) => l.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns null when lines is empty', () => {
    const { result } = renderHook(() => useFakeLineTimings([], 120));
    expect(result.current).toBeNull();
  });
});
