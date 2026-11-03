jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      border: '#222',
      card: '#111',
      inputBg: '#181818',
      primary: '#007AFF',
      textPrimary: '#fff',
      textSecondary: '#888',
    },
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));

/**
 * Two recorders, both driven by RENDER rather than final state — the regression this
 * suite exists for is a single frame.
 *
 * `emptyStateRenders` — the whole-screen "No downloaded music" state.
 * `placeholderRenders` — `SectionPlaceholder`, which is the only thing in `home.tsx`
 *   that draws a `WaveformLogo`, so mocking the logo counts placeholder frames without
 *   reaching into a component the screen doesn't export.
 */
const emptyStateRenders: unknown[] = [];
const placeholderRenders: unknown[] = [];
jest.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => {
    emptyStateRenders.push(1);
    // The real component has its own suite; the title is enough to tell the whole-screen
    // states apart (`noDownloadedMusic` vs. the generic filter message).
    const { Text } = require('react-native');
    const React = require('react');
    return React.createElement(Text, null, title);
  },
}));
jest.mock('../../components/WaveformLogo', () => ({
  __esModule: true,
  default: () => {
    placeholderRenders.push(1);
    return null;
  },
}));

// Cards have their own suites; stub them down to the id that reached them.
const stubCard =
  (kind: string) =>
  ({ album, playlist }: Record<string, { id: string } | undefined>) => {
    const { Text } = require('react-native');
    const React = require('react');
    const item = album ?? playlist;
    return React.createElement(Text, { testID: `${kind}:${item?.id ?? ''}` }, kind);
  };
jest.mock('../../components/AlbumCard', () => ({ AlbumCard: stubCard('album') }));
jest.mock('../../components/PlaylistCard', () => ({ PlaylistCard: stubCard('playlist') }));
jest.mock('../../components/GenreChipSection', () => ({ GenreChipSection: () => null }));
jest.mock('../../components/ResumeBookmarksSection', () => ({
  ResumeBookmarksSection: () => null,
}));
jest.mock('../../components/AnimatedNumber', () => ({ AnimatedNumber: () => null }));
jest.mock('../../components/DownloadedIcon', () => ({ DownloadedIcon: () => null }));

// Reanimated's real entry point pulls in the worklets native module, which has no Jest
// bridge. Only the stat-icon pop uses it here, and that is not what this suite tests.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (init: number) => {
      const ref = React.useRef({ value: init });
      return ref.current;
    },
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (val: number) => val,
    withSequence: (val: number) => val,
    withSpring: (val: number) => val,
  };
});

// The horizontal section lists: render every row synchronously so `renderItem` runs.
jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  const React = require('react');
  return {
    FlashList: ({
      data,
      renderItem,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        data.map((item, index) =>
          React.createElement(View, { key: index }, renderItem({ item, index })),
        ),
      ),
  };
});

import React from 'react';
import { act, render, waitFor, waitForElementToBeRemoved } from '@testing-library/react-native';

import { ensureNormalizedSchema } from '../../db/createNormalizedTables';
import { getDb } from '../../store/persistence/db';
import { upsertCachedItem } from '../../store/persistence/musicCacheTables';
import { albumListsStore } from '../../store/albumListsStore';
import { favoritesStore } from '../../store/favoritesStore';
import { filterBarStore } from '../../store/filterBarStore';
import { layoutPreferencesStore } from '../../store/layoutPreferencesStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { offlineModeStore } from '../../store/offlineModeStore';
import { HomeScreen } from '../home';

const db = () => getDb()!;

/** A complete (non-partial) downloaded album: the membership row plus the component row
 *  that makes it renderable. */
const seedDownloadedAlbum = (id: string): void => {
  db().runSync(
    'INSERT INTO cached_items (item_id, type, name, expected_song_count, last_sync_at, ' +
      'downloaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'album', `Album ${id}`, 0, 0, 0],
  );
  db().runSync('INSERT INTO cached_albums (item_id, name) VALUES (?, ?)', [id, `Album ${id}`]);
};

const seedDownloadedPlaylist = (id: string): void => {
  db().runSync(
    'INSERT INTO cached_items (item_id, type, name, expected_song_count, last_sync_at, ' +
      'downloaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'playlist', `Playlist ${id}`, 0, 0, 0],
  );
  db().runSync('INSERT INTO cached_playlists (item_id, name, song_count) VALUES (?, ?, ?)', [
    id,
    `Playlist ${id}`,
    2,
  ]);
};

/** MEMBERSHIP only: a `cached_items` row with NO `cached_albums` component row. The curated
 *  lists carry their own metadata, so this is all "downloaded" means for them — the
 *  asymmetry that keeps downloaded albums visible in lists sourced from elsewhere. */
const seedDownloadedItemOnly = (id: string): void => {
  db().runSync(
    'INSERT INTO cached_items (item_id, type, name, expected_song_count, last_sync_at, ' +
      'downloaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'album', `Album ${id}`, 0, 0, 0],
  );
};

const curated = (id: string) => ({ id, name: `Album ${id}`, songCount: 1, duration: 1 });

/** What a completing download does to the store: bump the counter the SQL readers key on. */
const bumpRevision = (): void => {
  act(() => {
    musicCacheStore.setState((s) => ({ revision: s.revision + 1 }));
  });
};

beforeAll(() => ensureNormalizedSchema(db()));

beforeEach(() => {
  emptyStateRenders.length = 0;
  placeholderRenders.length = 0;
  for (const t of ['cached_albums', 'cached_playlists', 'cached_items']) {
    db().runSync(`DELETE FROM ${t}`);
  }
  musicCacheStore.setState({ cachedItems: {}, revision: 0 });
  filterBarStore.setState({ downloadedOnly: true, favoritesOnly: false });
  layoutPreferencesStore.setState({ albumSortOrder: 'artist' });
  offlineModeStore.setState({ offlineMode: false });
  favoritesStore.setState({ albumIds: new Set() });
  albumListsStore.setState({
    recentlyAdded: [],
    recentlyPlayed: [],
    frequentlyPlayed: [],
    randomSelection: [],
  });
});

describe('HomeScreen — Downloaded sections read SQL without flashing an empty state', () => {
  it('shows neither the empty state nor a section placeholder before the read resolves', async () => {
    seedDownloadedAlbum('dl1');
    seedDownloadedPlaylist('pl1');

    const r = render(<HomeScreen />);
    // The reads run in an effect. Claiming "nothing downloaded" here would replace the
    // whole screen for a frame with content that is about to arrive.
    expect(emptyStateRenders).toEqual([]);
    expect(placeholderRenders).toEqual([]);

    await waitFor(() => expect(r.queryByTestId('album:dl1')).not.toBeNull());
    expect(r.queryByTestId('playlist:pl1')).not.toBeNull();
    // Across EVERY frame, not just the last one.
    expect(emptyStateRenders).toEqual([]);
    expect(placeholderRenders).toEqual([]);
  });

  it('holds the section placeholder back until the playlist read has answered', async () => {
    seedDownloadedAlbum('dl1'); // albums downloaded, no playlists

    const r = render(<HomeScreen />);
    expect(placeholderRenders).toEqual([]);

    await waitFor(() => expect(r.queryByTestId('album:dl1')).not.toBeNull());
    // Correct once the answer is known — it just must not appear before it.
    expect(placeholderRenders.length).toBeGreaterThan(0);
    expect(emptyStateRenders).toEqual([]);
  });

  it('reports a genuinely empty downloaded set only AFTER the reads complete', async () => {
    render(<HomeScreen />);
    expect(emptyStateRenders).toEqual([]);
    await waitFor(() => expect(emptyStateRenders.length).toBeGreaterThan(0));
  });

  it('hides downloads whose component rows were never populated', async () => {
    db().runSync(
      'INSERT INTO cached_items (item_id, type, name, expected_song_count, last_sync_at, ' +
        'downloaded_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['dl1', 'album', 'Album dl1', 0, 0, 0],
    );
    const r = render(<HomeScreen />);
    await waitFor(() => expect(emptyStateRenders.length).toBeGreaterThan(0));
    expect(r.queryByTestId('album:dl1')).toBeNull();
  });

  it('does not read at all when the Downloaded filter is off', async () => {
    seedDownloadedAlbum('dl1');
    filterBarStore.setState({ downloadedOnly: false });
    const r = render(<HomeScreen />);
    await waitFor(() => expect(placeholderRenders.length).toBeGreaterThan(0)); // curated lists
    expect(r.queryByTestId('album:dl1')).toBeNull();
    expect(emptyStateRenders).toEqual([]);
  });
});

/**
 * The curated lists (Recently Added etc.) come from `albumListsStore` and are filtered to
 * downloaded by `composeHomeAlbumSections`, which now takes an id SET read from SQL rather
 * than walking `cachedItems`. Same async hazards as the section reads above.
 */
describe('HomeScreen — curated lists filter on the downloaded id set', () => {
  beforeEach(() => {
    albumListsStore.setState({ recentlyAdded: [curated('ra1'), curated('ra2')] as never });
  });

  it('keeps only downloaded albums — membership needs no cached_albums row', async () => {
    seedDownloadedItemOnly('ra1');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:ra1')).not.toBeNull());
    expect(r.queryByTestId('album:ra2')).toBeNull();
    // …and it is NOT in the Downloaded Albums body, which needs renderable metadata.
    expect(r.queryAllByTestId('album:ra1')).toHaveLength(1);
  });

  it('shows no curated albums on the first frame, before the id set is known', async () => {
    // Falling through to "show everything" while the read is in flight would flash
    // undownloaded albums under the Downloaded filter.
    seedDownloadedItemOnly('ra1');
    seedDownloadedItemOnly('ra2');
    const r = render(<HomeScreen />);
    expect(r.queryByTestId('album:ra1')).toBeNull();
    expect(r.queryByTestId('album:ra2')).toBeNull();
    await waitFor(() => expect(r.queryByTestId('album:ra1')).not.toBeNull());
    expect(r.queryByTestId('album:ra2')).not.toBeNull();
  });

  it('re-filters when a download completes on screen', async () => {
    seedDownloadedItemOnly('ra1');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:ra1')).not.toBeNull());

    seedDownloadedItemOnly('ra2');
    expect(r.queryByTestId('album:ra2')).toBeNull();
    bumpRevision();
    await waitFor(() => expect(r.queryByTestId('album:ra2')).not.toBeNull());
  });

  it('shows every curated album when the Downloaded filter is off', async () => {
    filterBarStore.setState({ downloadedOnly: false });
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:ra1')).not.toBeNull());
    expect(r.queryByTestId('album:ra2')).not.toBeNull();
  });
});

/**
 * Whole-screen empty state. The per-section placeholders needed nothing — a curated
 * section emptied by a filter is HIDDEN, never placeheld with "albums you listen to will
 * appear here" — but the whole-screen state only ever fired for the Downloaded filter, so
 * the Favourites filter emptying everything left a screen with no album sections and no
 * explanation.
 */
describe('HomeScreen — whole-screen empty state under a filter', () => {
  beforeEach(() => {
    albumListsStore.setState({ recentlyAdded: [curated('ra1')] as never });
  });

  it('keeps the "no downloaded music" copy under the Downloaded filter', async () => {
    const r = render(<HomeScreen />); // downloadedOnly, nothing seeded
    await waitFor(() => expect(r.queryByText('No downloaded music')).not.toBeNull());
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
  });

  it('says the FILTER emptied it under Favourites, where nothing was said before', async () => {
    filterBarStore.setState({ downloadedOnly: false, favoritesOnly: true });
    const r = render(<HomeScreen />); // no starred album ids → every section empties
    await waitFor(() => expect(r.queryByText('Nothing matches your filters')).not.toBeNull());
    expect(r.queryByText('No downloaded music')).toBeNull();
  });

  it('shows no whole-screen empty state when a filtered section still has albums', async () => {
    filterBarStore.setState({ downloadedOnly: false, favoritesOnly: true });
    favoritesStore.setState({ albumIds: new Set(['ra1']) });
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:ra1')).not.toBeNull());
    expect(emptyStateRenders).toEqual([]);
  });

  it('shows no whole-screen empty state with NO filter on, however empty the lists', async () => {
    // The regression guard. Unfiltered, empty curated lists get their own placeholders
    // ("New albums added to your server will appear here") — not a filter message.
    filterBarStore.setState({ downloadedOnly: false, favoritesOnly: false });
    albumListsStore.setState({ recentlyAdded: [] });
    const r = render(<HomeScreen />);
    await waitFor(() => expect(placeholderRenders.length).toBeGreaterThan(0));
    expect(emptyStateRenders).toEqual([]);
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
  });
});

/** SQL has no Zustand subscription, so without keying on `revision` both sections go
 *  stale under a completing download. */
describe('HomeScreen — Downloaded sections track musicCacheStore.revision', () => {
  it('re-reads albums AND playlists when a download completes on screen', async () => {
    seedDownloadedAlbum('dl1');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:dl1')).not.toBeNull());

    seedDownloadedAlbum('dl2');
    seedDownloadedPlaylist('pl1');
    // Without the bump the rows are on disk and invisible — the silent-staleness bug.
    expect(r.queryByTestId('album:dl2')).toBeNull();

    bumpRevision();
    await waitFor(() => expect(r.queryByTestId('album:dl2')).not.toBeNull());
    expect(r.queryByTestId('playlist:pl1')).not.toBeNull();
  });

  it('drops a deleted download on the next bump', async () => {
    seedDownloadedAlbum('dl1');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:dl1')).not.toBeNull());

    db().runSync('DELETE FROM cached_items');
    db().runSync('DELETE FROM cached_albums');
    bumpRevision();
    await waitForElementToBeRemoved(() => r.queryByTestId('album:dl1'));
  });
});

/** The Downloaded sections come back ORDERED from SQL, on the same stored keys the
 *  library browse pages through — the Home screen no longer re-sorts them. */
describe('HomeScreen — the Downloaded sections are SQL-ordered', () => {
  const seedAlbum = (itemId: string, name: string, artist?: string): Promise<void> =>
    upsertCachedItem({
      itemId,
      type: 'album',
      name,
      expectedSongCount: 0,
      lastSyncAt: 0,
      downloadedAt: 0,
      albumMeta: { name, artist },
    });

  const seedPlaylist = (itemId: string, name: string): Promise<void> =>
    upsertCachedItem({
      itemId,
      type: 'playlist',
      name,
      expectedSongCount: 0,
      lastSyncAt: 0,
      downloadedAt: 0,
      playlistMeta: { name },
    });

  const idsFor = (r: ReturnType<typeof render>, kind: string): string[] =>
    r
      .queryAllByText(kind)
      .map((n) => String(n.props.testID ?? ''))
      .map((id) => id.slice(kind.length + 1));

  it('renders downloaded albums in artist order, punctuation-stripped', async () => {
    // Ids run opposite to the artist keys, so an unordered read gives the other answer.
    await seedAlbum('a-zulu', 'Zulu', 'Zebra');
    await seedAlbum('z-quoted', 'Quoted', '"Alpaca"');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('album:a-zulu')).not.toBeNull());
    expect(idsFor(r, 'album')).toEqual(['z-quoted', 'a-zulu']);
  });

  it('re-reads when the album-sort preference changes', async () => {
    await seedAlbum('a-zulu', 'Zulu', 'Alpaca');
    await seedAlbum('z-alpha', 'Alpha', 'Zebra');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(idsFor(r, 'album')).toEqual(['a-zulu', 'z-alpha']));

    act(() => {
      layoutPreferencesStore.setState({ albumSortOrder: 'title' });
    });
    // Nothing re-sorts in JS any more, so this only moves if the read ran again.
    await waitFor(() => expect(idsFor(r, 'album')).toEqual(['z-alpha', 'a-zulu']));
  });

  it('renders downloaded playlists A–Z', async () => {
    // Ids run opposite to the names, so an unordered read gives the other answer.
    await seedPlaylist('a-zulu', 'Zulu Mix');
    await seedPlaylist('z-alpha', 'The Alpha Mix');
    const r = render(<HomeScreen />);
    await waitFor(() => expect(r.queryByTestId('playlist:a-zulu')).not.toBeNull());
    expect(idsFor(r, 'playlist')).toEqual(['z-alpha', 'a-zulu']);
  });
});
