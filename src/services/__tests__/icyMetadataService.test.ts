jest.mock('expo/fetch', () => ({
  fetch: jest.fn(),
}));

import { appStateStore } from '../../store/appStateStore';
import { radioNowPlayingStore } from '../../store/radioNowPlayingStore';
import {
  ICY_MAX_BYTES_PER_POLL,
  IcyTitleParser,
  decodeIcyBytes,
  extractStreamTitle,
  fetchStreamTitle,
  startIcyPolling,
  stopIcyPolling,
} from '../icyMetadataService';

const { fetch: mockFetch } = jest.requireMock('expo/fetch') as { fetch: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see playerService.test.ts: the
// global __mocks__/react-native-queue-player.js is used automatically; requiring it directly (rather
// than jest.requireMock) is what resolves to the SAME instance the source module imports.
const { __castManager: mockCastManager } = require('react-native-queue-player') as {
  __castManager: { getCurrentAudioRoute: jest.Mock };
};

const encoder = new TextEncoder();

/** Build one ICY window: `metaint` zero audio bytes + length byte + padded metadata. */
function icyWindow(metaint: number, metadata: string): Uint8Array {
  const metaBytes = encoder.encode(metadata);
  const paddedLen = Math.ceil(metaBytes.length / 16) * 16;
  const out = new Uint8Array(metaint + 1 + paddedLen);
  out[metaint] = paddedLen / 16;
  out.set(metaBytes, metaint + 1);
  return out;
}

/** Fake streaming Response for the mocked expo/fetch. */
function fakeResponse(metaint: string | null, chunks: Uint8Array[]) {
  let index = 0;
  return {
    headers: { get: (name: string) => (name === 'icy-metaint' ? metaint : null) },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { value: chunks[index++], done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

afterEach(() => {
  stopIcyPolling();
  radioNowPlayingStore.getState().clear();
  mockFetch.mockReset();
  mockCastManager.getCurrentAudioRoute.mockReturnValue({ kind: 'speaker', name: '' });
  jest.useRealTimers();
});

describe('extractStreamTitle', () => {
  it('pulls the title out of a metadata block', () => {
    expect(extractStreamTitle("StreamTitle='Artist - Song';StreamUrl='';")).toBe(
      'Artist - Song',
    );
  });

  it('returns null for empty or absent titles', () => {
    expect(extractStreamTitle("StreamTitle='';")).toBeNull();
    expect(extractStreamTitle("StreamUrl='x';")).toBeNull();
    expect(extractStreamTitle('')).toBeNull();
  });
});

describe('decodeIcyBytes', () => {
  it('decodes UTF-8', () => {
    expect(decodeIcyBytes(encoder.encode('Zażółć'))).toBe('Zażółć');
  });

  it('falls back to Latin-1 on malformed UTF-8', () => {
    // 0xE9 alone is invalid UTF-8 but é in Latin-1.
    expect(decodeIcyBytes(new Uint8Array([0x43, 0xe9]))).toBe('Cé');
  });
});

describe('IcyTitleParser', () => {
  it('parses a title from a single chunk', () => {
    const parser = new IcyTitleParser(8);
    expect(parser.push(icyWindow(8, "StreamTitle='Hit';"))).toBe('Hit');
  });

  it('parses a title split across many small chunks', () => {
    const window = icyWindow(8, "StreamTitle='Split Song';");
    const parser = new IcyTitleParser(8);
    let title: string | null = null;
    for (const byte of window) {
      title = parser.push(new Uint8Array([byte]));
      if (title) break;
    }
    expect(title).toBe('Split Song');
  });

  it('rolls over an empty metadata block to the next window', () => {
    const empty = new Uint8Array(9); // 8 audio bytes + zero length byte
    const parser = new IcyTitleParser(8);
    expect(parser.push(empty)).toBeNull();
    expect(parser.push(icyWindow(8, "StreamTitle='Later';"))).toBe('Later');
  });
});

describe('fetchStreamTitle', () => {
  it('reports unsupported without an icy-metaint header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(null, []));
    const result = await fetchStreamTitle('https://s/live', fetchImpl as never);
    expect(result).toEqual({ title: null, unsupported: true });
  });

  it('reports unsupported for an absurd metaint', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(fakeResponse(String(ICY_MAX_BYTES_PER_POLL + 1), []));
    const result = await fetchStreamTitle('https://s/live', fetchImpl as never);
    expect(result.unsupported).toBe(true);
  });

  it('sends the Icy-MetaData header and parses the stream', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(fakeResponse('8', [icyWindow(8, "StreamTitle='Live One';")]));
    const result = await fetchStreamTitle('https://s/live', fetchImpl as never);
    expect(result).toEqual({ title: 'Live One', unsupported: false });
    expect(fetchImpl.mock.calls[0][1].headers['Icy-MetaData']).toBe('1');
  });

  it('gives up cleanly when the stream ends without a title', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(fakeResponse('8', [new Uint8Array(9)]));
    const result = await fetchStreamTitle('https://s/live', fetchImpl as never);
    expect(result).toEqual({ title: null, unsupported: false });
  });
});

describe('startIcyPolling / stopIcyPolling', () => {
  it('polls immediately and publishes the title for the active track', async () => {
    appStateStore.setState({ isActive: true });
    mockFetch.mockResolvedValue(fakeResponse('8', [icyWindow(8, "StreamTitle='Now';")]));
    startIcyPolling('internet-radio:ir-1', 'https://s/live');
    await new Promise((r) => setTimeout(r, 0));
    expect(radioNowPlayingStore.getState().title).toBe('Now');
    expect(radioNowPlayingStore.getState().trackId).toBe('internet-radio:ir-1');
  });

  it('skips polling while backgrounded', async () => {
    appStateStore.setState({ isActive: false });
    startIcyPolling('internet-radio:ir-1', 'https://s/live');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
    appStateStore.setState({ isActive: true });
  });

  it('skips polling while routed over Bluetooth', async () => {
    appStateStore.setState({ isActive: true });
    mockCastManager.getCurrentAudioRoute.mockReturnValue({ kind: 'bluetoothA2DP', name: 'Headset' });
    startIcyPolling('internet-radio:ir-1', 'https://s/live');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stops polling for unsupported stations', async () => {
    appStateStore.setState({ isActive: true });
    mockFetch.mockResolvedValue(fakeResponse(null, []));
    startIcyPolling('internet-radio:ir-2', 'https://s/live');
    await new Promise((r) => setTimeout(r, 0));
    expect(radioNowPlayingStore.getState().title).toBeNull();
    // A later manual restart for the SAME station is allowed again (fresh state).
    stopIcyPolling();
  });

  it('ignores results landing after the station changed', async () => {
    appStateStore.setState({ isActive: true });
    let resolveFetch!: (v: unknown) => void;
    mockFetch.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    startIcyPolling('internet-radio:ir-1', 'https://s/live');
    stopIcyPolling();
    resolveFetch(fakeResponse('8', [icyWindow(8, "StreamTitle='Stale';")]));
    await new Promise((r) => setTimeout(r, 0));
    expect(radioNowPlayingStore.getState().title).toBeNull();
  });
});
