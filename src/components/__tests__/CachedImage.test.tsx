/**
 * Tests for CachedImage render + recovery behaviour.
 *
 * Invariant under test: the placeholder is ALWAYS in the view tree.
 * The Image is drawn on top and covers the placeholder when it
 * paints; if it isn't present or is hidden, the placeholder shows
 * through. We never end up with a blank rectangle.
 *
 * Scenarios:
 *   1. Placeholder is always rendered. A cached URI is rendered on
 *      top; the placeholder shows through wherever the image isn't
 *      painted yet.
 *   2. Broken local file: deleteCachedVariant is called on error and
 *      the 2.5s backoff retry sets a new URI with cache-buster.
 *   3. Remote 503: first load errors, backoff fires new setUri.
 *   4. Second failure after retry clears uri so the placeholder is
 *      visible with no Image layer.
 *   5. Navigation recovery: remount resets retry state.
 *   6. Sentinel coverArtId never triggers deleteCachedVariant.
 *   7. Offline preserves the cached file on error (no delete).
 *   8. Offline with valid cache renders the Image layer.
 *   9. No cache + no coverArtId + no fallback: only the placeholder
 *      renders. No Image element, no blank square possible.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('../../store/persistence/kvStorage', () => require('../../store/persistence/__mocks__/kvStorage'));

import React from 'react';
import { Image as RNImage } from 'react-native';
import { act, render } from '@testing-library/react-native';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetCachedImageUri = jest.fn<string | null, [string, number]>();
const mockCacheAllSizes = jest.fn<Promise<void>, [string]>();
const mockDeleteCachedVariant = jest.fn<void, [string, number]>();

jest.mock('../../services/imageCacheService', () => ({
  getCachedImageUri: (id: string, size: number) => mockGetCachedImageUri(id, size),
  cacheAllSizes: (id: string) => mockCacheAllSizes(id),
  deleteCachedVariant: (id: string, size: number) => mockDeleteCachedVariant(id, size),
}));

const mockGetCoverArtUrl = jest.fn<string | null, [string, number]>();

jest.mock('../../services/subsonicService', () => ({
  getCoverArtUrl: (id: string, size: number) => mockGetCoverArtUrl(id, size),
  VARIOUS_ARTISTS_COVER_ART_ID: '__VA__',
}));

jest.mock('../../services/musicCacheService', () => ({
  STARRED_COVER_ART_ID: '__STARRED__',
}));

let mockOfflineMode = false;

jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: {
    getState: () => ({ offlineMode: mockOfflineMode }),
  },
}));

jest.mock('../WaveformLogo', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { size: number; color: string }) => (
      <View testID="waveform-placeholder" style={{ width: props.size, height: props.size }} />
    ),
  };
});

jest.mock('react-native-reanimated', () => {
  const { View, Image } = require('react-native');
  const ReactActual = require('react');
  return {
    __esModule: true,
    default: { View, Image },
    // Real reanimated returns a stable shared value across renders via
    // internal caching. Our mock must do the same — otherwise the
    // returned object is a fresh reference every render, which would
    // invalidate any useEffect/useLayoutEffect dep array that includes
    // it and cause infinite effect re-runs.
    useSharedValue: (init: number) => {
      const ref = ReactActual.useRef({ value: init });
      return ref.current;
    },
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (val: number, _cfg?: object, cb?: (finished: boolean) => void) => {
      if (cb) cb(true);
      return val;
    },
    cancelAnimation: () => {},
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

const originalResolveAssetSource = RNImage.resolveAssetSource;
// @ts-expect-error — override for tests
RNImage.resolveAssetSource = () => ({ uri: 'file:///bundled/asset.jpg' });

afterAll(() => {
  RNImage.resolveAssetSource = originalResolveAssetSource;
});

const { CachedImage } = require('../CachedImage');

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Walk the JSON snapshot (reflects the currently-committed render only). */
function findImagesInJSON(toJSON: () => unknown): Array<{ type: string; props: any }> {
  const out: Array<{ type: string; props: any }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; props?: any; children?: unknown };
    if (n.type === 'Image' && typeof n.props?.source?.uri === 'string') {
      out.push({ type: n.type, props: n.props });
    }
    if (Array.isArray(n.children)) for (const c of n.children) visit(c);
  };
  visit(toJSON());
  return out;
}

/**
 * Resolve the onError/onLoad callback for the currently-rendered image
 * whose URI contains `substring`. Uses the fiber tree (UNSAFE_root) to
 * get live handler references, but filters by props.source.uri which is
 * the latest prop of mounted components.
 */
function getRenderedImageHandlers(
  toJSON: () => unknown,
  UNSAFE_root: any,
  substring: string,
): { onLoad?: () => void; onError?: () => void; source: { uri: string } } | null {
  // Confirm via the JSON snapshot that an image matching `substring` is
  // actually rendered.
  const inJson = findImagesInJSON(toJSON).find((n) =>
    n.props.source.uri.includes(substring),
  );
  if (!inJson) return null;
  // Then pick up the fiber for its handler refs.
  const fiber = UNSAFE_root.findAll((n: any) =>
    n.type === 'Image' &&
    typeof n.props?.source?.uri === 'string' &&
    n.props.source.uri === inJson.props.source.uri,
  )[0];
  if (!fiber) return null;
  return {
    onLoad: fiber.props?.onLoad,
    onError: fiber.props?.onError,
    source: fiber.props.source,
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockGetCachedImageUri.mockReset();
  mockCacheAllSizes.mockReset();
  mockDeleteCachedVariant.mockReset();
  mockGetCoverArtUrl.mockReset();
  mockOfflineMode = false;

  mockGetCachedImageUri.mockReturnValue(null);
  mockCacheAllSizes.mockResolvedValue(undefined);
  mockGetCoverArtUrl.mockReturnValue('https://example.com/cover.jpg?t=abc&s=600');

  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('CachedImage', () => {
  it('1. placeholder is always rendered; a cached URI is drawn on top at full opacity', async () => {
    mockGetCachedImageUri.mockReturnValue('file:///cache/abc/600.jpg');

    const { queryByTestId, toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="album1" size={600} />,
    );
    await flushEffects();

    // Placeholder is always part of the tree — the never-blank invariant.
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();

    // Image is rendered with the cached URI on the first frame.
    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/abc/600.jpg');
    expect(img).not.toBeNull();

    // Placeholder stays in the tree after onLoad too — the Image just
    // covers it visually.
    await act(async () => {
      img!.onLoad?.();
      await Promise.resolve();
    });
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
  });

  it('2. broken local file on error: deletes variant and retries with cache-buster after 2.5s', async () => {
    mockGetCachedImageUri
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValue(null);

    const { toJSON, UNSAFE_root } = render(<CachedImage coverArtId="album1" size={600} />);
    await flushEffects();

    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/abc/600.jpg');
    expect(img).not.toBeNull();

    await act(async () => {
      img!.onError?.();
      await Promise.resolve();
    });

    expect(mockDeleteCachedVariant).toHaveBeenCalledWith('album1', 600);

    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    const retried = findImagesInJSON(toJSON).find((n) => n.props.source.uri.includes('_r='));
    expect(retried).toBeTruthy();
    expect(mockCacheAllSizes).toHaveBeenCalledWith('album1');
  });

  it('3. remote 503-style error retries after backoff', async () => {
    mockGetCachedImageUri.mockReturnValue(null);

    const { toJSON, UNSAFE_root } = render(<CachedImage coverArtId="album1" size={600} />);
    await flushEffects();

    await act(async () => {
      jest.advanceTimersByTime(150);
      await Promise.resolve();
    });

    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'https://example.com/cover.jpg');
    expect(img).not.toBeNull();

    await act(async () => {
      img!.onError?.();
      await Promise.resolve();
    });

    // Remote URL did not start with file:// → no deletion.
    expect(mockDeleteCachedVariant).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    const retried = findImagesInJSON(toJSON).find((n) => n.props.source.uri.includes('_r='));
    expect(retried).toBeTruthy();
  });

  it('4. second failure after retry surfaces placeholder (uri cleared)', async () => {
    mockGetCachedImageUri
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValueOnce('file:///cache/abc/600.jpg')
      .mockReturnValue(null);

    const { queryByTestId, toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="album1" size={600} />,
    );
    await flushEffects();

    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/abc/600.jpg');
    expect(img).not.toBeNull();

    await act(async () => {
      img!.onError?.();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    const retryImg = getRenderedImageHandlers(toJSON, UNSAFE_root, '_r=');
    expect(retryImg).not.toBeNull();

    await act(async () => {
      retryImg!.onError?.();
      await Promise.resolve();
    });

    // Placeholder is still in the tree (always is) and the Image layer
    // is suppressed so the placeholder shows through with nothing on top.
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
    expect(findImagesInJSON(toJSON)).toHaveLength(0);
  });

  it('5. navigation recovery: remounting with a new id resets retry state', async () => {
    mockGetCachedImageUri.mockReturnValue('file:///cache/a/600.jpg');

    const { rerender, toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="albumA" size={600} />,
    );
    await flushEffects();

    const imgA = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/a/600.jpg');
    await act(async () => {
      imgA!.onError?.();
      await Promise.resolve();
    });

    mockGetCachedImageUri.mockReturnValue('file:///cache/b/600.jpg');
    rerender(<CachedImage coverArtId="albumB" size={600} />);
    await flushEffects();

    const imgB = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/b/600.jpg');
    expect(imgB).not.toBeNull();

    await act(async () => {
      imgB!.onError?.();
      await Promise.resolve();
    });
    expect(mockDeleteCachedVariant).toHaveBeenLastCalledWith('albumB', 600);
  });

  it('6. sentinel coverArtId never triggers deleteCachedVariant', async () => {
    mockGetCachedImageUri.mockReturnValue(null);

    const { toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="__STARRED__" size={600} />,
    );
    await flushEffects();

    const anyImg = findImagesInJSON(toJSON)[0];
    expect(anyImg).toBeTruthy();
    const handlers = getRenderedImageHandlers(toJSON, UNSAFE_root, anyImg.props.source.uri);
    expect(handlers).not.toBeNull();

    await act(async () => {
      handlers!.onError?.();
      await Promise.resolve();
    });

    expect(mockDeleteCachedVariant).not.toHaveBeenCalled();
  });

  it('7. offline preserves the cached file on error (no delete) and shows placeholder', async () => {
    mockOfflineMode = true;
    mockGetCachedImageUri.mockReturnValue('file:///cache/abc/600.jpg');

    const { queryByTestId, toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="album1" size={600} />,
    );
    await flushEffects();

    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/abc/600.jpg');
    await act(async () => {
      img!.onError?.();
      await Promise.resolve();
    });

    expect(mockDeleteCachedVariant).not.toHaveBeenCalled();
    // Placeholder is always there; the Image layer is suppressed after
    // the decode error so the placeholder shows through.
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
    expect(findImagesInJSON(toJSON)).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockCacheAllSizes).not.toHaveBeenCalled();
  });

  it('8. offline with valid cache renders the image layer on top of the placeholder', async () => {
    mockOfflineMode = true;
    mockGetCachedImageUri.mockReturnValue('file:///cache/abc/600.jpg');

    const { queryByTestId, toJSON, UNSAFE_root } = render(
      <CachedImage coverArtId="album1" size={600} />,
    );
    await flushEffects();

    // Placeholder is always present; Image renders on top from the first
    // frame because the URI is a trusted cached file.
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
    const img = getRenderedImageHandlers(toJSON, UNSAFE_root, 'file:///cache/abc/600.jpg');
    expect(img).not.toBeNull();

    // onLoad is idempotent for cached files (fadeAnim already 1).
    await act(async () => {
      img!.onLoad?.();
      await Promise.resolve();
    });
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
    // Image still rendered.
    expect(findImagesInJSON(toJSON).some((n) => n.props.source.uri.startsWith('file://'))).toBe(true);
  });

  it('9. no cache + no coverArtId + no fallback: only the placeholder renders (never blank)', async () => {
    const { queryByTestId, toJSON } = render(
      <CachedImage coverArtId={undefined} size={600} />,
    );
    await flushEffects();

    // Placeholder is always in the tree — this is the never-blank invariant.
    expect(queryByTestId('waveform-placeholder')).not.toBeNull();
    // No Image layer (nothing to render on top).
    expect(findImagesInJSON(toJSON)).toHaveLength(0);
  });
});
