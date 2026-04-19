jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));
jest.mock('../../services/subsonicService', () => ({
  __esModule: true,
  getLyricsForTrack: jest.fn(),
}));

import { getLyricsForTrack, type LyricsData } from '../../services/subsonicService';
import { lyricsStore } from '../lyricsStore';

const mockGetLyrics = getLyricsForTrack as jest.MockedFunction<typeof getLyricsForTrack>;

const sample: LyricsData = {
  synced: true,
  lines: [
    { startMs: 0, text: 'one' },
    { startMs: 2000, text: 'two' },
  ],
  offsetMs: 0,
  source: 'structured',
  lang: 'en',
};

beforeEach(() => {
  jest.clearAllMocks();
  lyricsStore.getState().clearLyrics();
});

describe('lyricsStore.fetchLyrics', () => {
  it('populates entries on successful fetch and clears loading', async () => {
    mockGetLyrics.mockResolvedValue(sample);

    const result = await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');

    expect(result).toBe(sample);
    expect(lyricsStore.getState().entries['t1']).toBe(sample);
    expect(lyricsStore.getState().loading['t1']).toBeUndefined();
    expect(lyricsStore.getState().errors['t1']).toBeUndefined();
    expect(mockGetLyrics).toHaveBeenCalledWith('t1', 'A', 'B', expect.any(AbortSignal));
  });

  it('sets loading true during fetch and clears on success', async () => {
    let resolveFn: (value: LyricsData | null) => void;
    mockGetLyrics.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const pending = lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    expect(lyricsStore.getState().loading['t1']).toBe(true);

    resolveFn!(sample);
    await pending;

    expect(lyricsStore.getState().loading['t1']).toBeUndefined();
  });

  it('no error + no entry when service returns null ("no lyrics for this track")', async () => {
    mockGetLyrics.mockResolvedValue(null);

    const result = await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    expect(result).toBeNull();
    expect(lyricsStore.getState().entries['t1']).toBeUndefined();
    expect(lyricsStore.getState().errors['t1']).toBeUndefined();
    expect(lyricsStore.getState().loading['t1']).toBeUndefined();
  });

  it('sets error: "timeout" when withTimeout returns timeout sentinel', async () => {
    // Hang past the 15s budget. Use fake timers so we do not actually wait.
    jest.useFakeTimers();
    mockGetLyrics.mockImplementation(() => new Promise(() => {}));

    const pending = lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    jest.advanceTimersByTime(15_000);
    const result = await pending;

    expect(result).toBeNull();
    expect(lyricsStore.getState().errors['t1']).toBe('timeout');
    expect(lyricsStore.getState().entries['t1']).toBeUndefined();
    expect(lyricsStore.getState().loading['t1']).toBeUndefined();
    jest.useRealTimers();
  });

  it('sets error: "error" when service throws', async () => {
    mockGetLyrics.mockRejectedValue(new Error('boom'));

    const result = await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    expect(result).toBeNull();
    expect(lyricsStore.getState().errors['t1']).toBe('error');
    expect(lyricsStore.getState().loading['t1']).toBeUndefined();
  });

  it('retry after error clears previous error before new fetch', async () => {
    mockGetLyrics.mockRejectedValueOnce(new Error('boom'));
    await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    expect(lyricsStore.getState().errors['t1']).toBe('error');

    mockGetLyrics.mockResolvedValueOnce(sample);
    await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');

    expect(lyricsStore.getState().errors['t1']).toBeUndefined();
    expect(lyricsStore.getState().entries['t1']).toBe(sample);
  });

  it('preserves entries for other tracks when fetching a different one', async () => {
    mockGetLyrics.mockResolvedValue(sample);
    await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');

    const other: LyricsData = { ...sample, lines: [{ startMs: 0, text: 'other' }] };
    mockGetLyrics.mockResolvedValue(other);
    await lyricsStore.getState().fetchLyrics('t2', 'A', 'B');

    expect(lyricsStore.getState().entries['t1']).toBe(sample);
    expect(lyricsStore.getState().entries['t2']).toBe(other);
  });
});

describe('lyricsStore.clearLyrics', () => {
  it('wipes entries, loading, and errors', async () => {
    mockGetLyrics.mockRejectedValue(new Error('boom'));
    await lyricsStore.getState().fetchLyrics('t1', 'A', 'B');
    mockGetLyrics.mockResolvedValue(sample);
    await lyricsStore.getState().fetchLyrics('t2', 'A', 'B');

    lyricsStore.getState().clearLyrics();

    expect(lyricsStore.getState().entries).toEqual({});
    expect(lyricsStore.getState().loading).toEqual({});
    expect(lyricsStore.getState().errors).toEqual({});
  });
});
