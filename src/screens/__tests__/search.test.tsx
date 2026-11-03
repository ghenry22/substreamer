jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      border: '#222',
      label: '#888',
      primary: '#007AFF',
      textPrimary: '#fff',
      textSecondary: '#888',
    },
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
jest.mock('../../services/musicCacheService', () => ({ getLocalTrackUri: () => null }));
jest.mock('../../services/playerService', () => ({ playTrack: jest.fn() }));

// The rows have their own suites; stub them to whatever id reached them.
const stubRow =
  (kind: string) =>
  ({ artist, album, song }: Record<string, { id: string } | undefined>) => {
    const { Text } = require('react-native');
    const React = require('react');
    const item = artist ?? album ?? song;
    return React.createElement(Text, { testID: `${kind}:${item?.id ?? ''}` }, kind);
  };
jest.mock('../../components/ArtistRow', () => ({ ArtistRow: stubRow('artist') }));
jest.mock('../../components/AlbumRow', () => ({ AlbumRow: stubRow('album') }));
jest.mock('../../components/SongRow', () => ({ SongRow: stubRow('song') }));
jest.mock('../../components/RecentSearches', () => ({ RecentSearches: () => null }));

import React from 'react';
import { act, render, waitFor, waitForElementToBeRemoved } from '@testing-library/react-native';

import type { AlbumID3, ArtistID3, Child } from 'subsonic-api';

import { ensureNormalizedSchema } from '../../db/createNormalizedTables';
import { getDb } from '../../store/persistence/db';
import { favoritesStore } from '../../store/favoritesStore';
import { filterBarStore } from '../../store/filterBarStore';
import { layoutPreferencesStore } from '../../store/layoutPreferencesStore';
import { musicCacheStore } from '../../store/musicCacheStore';
import { searchStore } from '../../store/searchStore';
import { SearchScreen } from '../search';

const artist = (id: string): ArtistID3 => ({ id, name: `Artist ${id}`, albumCount: 1 });
const album = (id: string): AlbumID3 =>
  ({ id, name: `Album ${id}`, duration: 0, songCount: 0 }) as AlbumID3;
const song = (id: string): Child => ({ id, title: `Song ${id}`, isDir: false }) as Child;

const db = () => getDb()!;

/**
 * A downloaded album as the MEMBERSHIP read sees it: a `cached_items` row and nothing
 * else. Deliberately NO `cached_albums` component row — search already holds the album's
 * metadata, so requiring one here would hide downloaded albums from search.
 * `present.length < expected` makes it a PARTIAL download.
 */
const seedDownloadedAlbum = (id: string, expected = 0, present: string[] = []): void => {
  db().runSync(
    'INSERT INTO cached_items (item_id, type, name, expected_song_count, last_sync_at, ' +
      'downloaded_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'album', `Album ${id}`, expected, 0, 0],
  );
  present.forEach((songId, i) => {
    db().runSync(
      'INSERT INTO cached_songs (song_id, album_id, suffix, bytes, format_captured_at, ' +
        'downloaded_at, title, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [songId, id, 'mp3', 1, 0, 0, 'T', 100],
    );
    db().runSync('INSERT INTO cached_item_songs (item_id, position, song_id) VALUES (?, ?, ?)', [
      id,
      i,
      songId,
    ]);
  });
};

/** What a completing download does to the store: bump the counter the SQL read keys on. */
const bumpRevision = (): void => {
  act(() => {
    musicCacheStore.setState((s) => ({ revision: s.revision + 1 }));
  });
};

beforeAll(() => ensureNormalizedSchema(db()));

beforeEach(() => {
  for (const t of ['cached_item_songs', 'cached_items', 'cached_songs']) {
    db().runSync(`DELETE FROM ${t}`);
  }
  musicCacheStore.setState({ revision: 0 });
  layoutPreferencesStore.setState({ includePartialInDownloadedFilter: false });
  searchStore.setState({
    query: 'a',
    loading: false,
    results: {
      artists: [artist('ar1'), artist('ar2')],
      albums: [album('al1'), album('al2')],
      songs: [song('s1'), song('s2')],
    },
  });
  filterBarStore.setState({ favoritesOnly: false, downloadedOnly: false });
  favoritesStore.setState({
    songIds: new Set(['s1']),
    albumIds: new Set(['al1']),
    artistIds: new Set(['ar1']),
  });
});

const rowIds = (r: ReturnType<typeof render>): string[] =>
  r.queryAllByTestId(/^(artist|album|song):/).map((n) => String(n.props.testID));

describe('SearchScreen — downloaded filter drops artists entirely', () => {
  // Artists cannot be downloaded. Keeping an artist who merely owns a matching downloaded
  // album would disagree with the library tab (hides artists) and with offline search
  // (returns none). All three agree: no artists under the Downloaded filter.
  it('renders no artist rows when the Downloaded filter is on', async () => {
    filterBarStore.setState({ downloadedOnly: true });
    seedDownloadedAlbum('al1'); // so the screen has content once the read lands
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());
    expect(rowIds(r).filter((id) => id.startsWith('artist:'))).toEqual([]);
  });

  it('still renders artists when the filter is off', () => {
    expect(rowIds(render(<SearchScreen />))).toEqual(
      expect.arrayContaining(['artist:ar1', 'artist:ar2']),
    );
  });
});

/**
 * The album half of the Downloaded filter answers from SQL (`listDownloadedAlbumIds`)
 * instead of walking `musicCacheStore.cachedItems`. The read is asynchronous, which is
 * what most of this suite is about: a filter that means "only what's on this device"
 * must never render a row it has not confirmed.
 */
describe('SearchScreen — downloaded album filter reads SQL', () => {
  beforeEach(() => filterBarStore.setState({ downloadedOnly: true }));

  it('keeps only downloaded albums — including one with no cached_albums row', async () => {
    seedDownloadedAlbum('al1');
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());
    expect(r.queryByTestId('album:al2')).toBeNull();
  });

  it('shows NO albums on the first frame, before the id set is known', async () => {
    // The failure this guards: falling through to "show everything" while the read is in
    // flight, which flashes undownloaded albums under a Downloaded filter.
    seedDownloadedAlbum('al1');
    seedDownloadedAlbum('al2');
    const r = render(<SearchScreen />);
    expect(rowIds(r)).toEqual([]);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());
    expect(r.queryByTestId('album:al2')).not.toBeNull();
  });

  it('shows the searching spinner, not a placeholder, while the set is loading', async () => {
    // Nothing downloaded, so the answer really is "nothing to show" — but only once it IS
    // the answer. Claiming it a frame early is the empty-state flash. The query DID match
    // (the seeded results are non-empty), so the placeholder blames the filter.
    const r = render(<SearchScreen />);
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
    expect(r.getByText('Searching…')).toBeTruthy();
    await waitFor(() => expect(r.queryByText('Nothing matches your filters')).not.toBeNull());
  });

  it('re-reads when a download completes on screen (musicCacheStore.revision)', async () => {
    seedDownloadedAlbum('al1');
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());

    seedDownloadedAlbum('al2');
    // Without the bump the row is on disk and invisible — the silent-staleness bug.
    expect(r.queryByTestId('album:al2')).toBeNull();

    bumpRevision();
    await waitFor(() => expect(r.queryByTestId('album:al2')).not.toBeNull());
  });

  it('does not blank a populated list while the re-read is in flight', async () => {
    // The other half of "not yet known": a REFRESH is not unknown. Treating it as such
    // would empty the album section on every completing download. `null` is reserved for
    // "no answer has ever arrived"; a refresh keeps the previous one on screen.
    seedDownloadedAlbum('al1');
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());

    bumpRevision();
    expect(r.queryByTestId('album:al1')).not.toBeNull(); // the frame right after the bump
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());
  });

  it('drops a deleted download on the next bump', async () => {
    seedDownloadedAlbum('al1');
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());

    db().runSync('DELETE FROM cached_items');
    bumpRevision();
    await waitForElementToBeRemoved(() => r.queryByTestId('album:al1'));
  });

  it('honours the partial-download preference, and re-reads when it flips', async () => {
    seedDownloadedAlbum('al1', 3, ['s1']); // 1 of 3 on disk
    const r = render(<SearchScreen />);
    await waitFor(() => expect(r.queryByText('Nothing matches your filters')).not.toBeNull());
    expect(r.queryByTestId('album:al1')).toBeNull();

    act(() => {
      layoutPreferencesStore.setState({ includePartialInDownloadedFilter: true });
    });
    await waitFor(() => expect(r.queryByTestId('album:al1')).not.toBeNull());
  });

  it('does not read at all when the filter is off — undownloaded albums show', () => {
    filterBarStore.setState({ downloadedOnly: false });
    expect(rowIds(render(<SearchScreen />))).toEqual(
      expect.arrayContaining(['album:al1', 'album:al2']),
    );
  });
});

describe('SearchScreen — favourites filter', () => {
  it('shows unstarred results too when the filter is off', () => {
    // `arrayContaining`, not an exact list: SectionList only mounts its initial window,
    // so the tail of a long section legitimately isn't rendered yet.
    expect(rowIds(render(<SearchScreen />))).toEqual(
      expect.arrayContaining(['artist:ar1', 'artist:ar2', 'album:al1', 'album:al2', 'song:s1']),
    );
  });

  it('shows starred items only when the filter is on — across all three types', () => {
    // The Favourites filter reads the membership id sets, the same ones the heart
    // icons read, so search and the star state can never disagree.
    filterBarStore.setState({ favoritesOnly: true });
    expect(rowIds(render(<SearchScreen />))).toEqual(['artist:ar1', 'album:al1', 'song:s1']);
  });

  it('blames the FILTER when nothing in the results is starred', () => {
    filterBarStore.setState({ favoritesOnly: true });
    favoritesStore.setState({
      songIds: new Set(),
      albumIds: new Set(),
      artistIds: new Set(),
    });
    const r = render(<SearchScreen />);
    expect(rowIds(r)).toEqual([]);
    expect(r.getByText('Nothing matches your filters')).toBeTruthy();
    expect(r.getByText('Try adjusting your filters, or pull to refresh')).toBeTruthy();
  });
});

/**
 * Search is the one surface that can tell "the query matched nothing" from "a chip removed
 * every match" without a second query — it already holds the unfiltered result set. These
 * are different statements and must not collapse into one message.
 */
describe('SearchScreen — "no results" vs "filtered away"', () => {
  const noMatches = { artists: [], albums: [], songs: [] };

  it('says NO RESULTS when the query genuinely matched nothing, filter or not', () => {
    searchStore.setState({ results: noMatches });
    filterBarStore.setState({ favoritesOnly: true });
    const r = render(<SearchScreen />);
    expect(r.getByText('No results found')).toBeTruthy();
    expect(r.getByText('No results for "a"')).toBeTruthy();
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
  });

  it('says NO RESULTS with no filter on at all', () => {
    searchStore.setState({ results: noMatches });
    const r = render(<SearchScreen />);
    expect(r.getByText('No results found')).toBeTruthy();
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
  });

  it('recovers the NO RESULTS copy when the filter is switched back off', () => {
    // The results matched but nothing is starred → filter copy; drop the filter and the
    // rows come back, so this is really the guard that the two states stay independent.
    filterBarStore.setState({ favoritesOnly: true });
    favoritesStore.setState({ songIds: new Set(), albumIds: new Set(), artistIds: new Set() });
    const r = render(<SearchScreen />);
    expect(r.getByText('Nothing matches your filters')).toBeTruthy();

    act(() => filterBarStore.setState({ favoritesOnly: false }));
    expect(r.queryByText('Nothing matches your filters')).toBeNull();
    expect(rowIds(r)).toEqual(expect.arrayContaining(['artist:ar1', 'album:al1']));
  });
});
