/**
 * The cached-lyrics browser: what it lists, what the two swipe directions do, and
 * that tapping a row shows the STATIC lyrics view. The real-SQL side of the same
 * feature lives in `store/persistence/__tests__/lyricsWritePath.test.ts`.
 *
 * Chrome is stubbed down to the point where `renderItem` runs; `SwipeableRow` is
 * replaced by a stub that exposes each action as a pressable, since the gesture
 * itself belongs to `SwipeableRow`'s own suite.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) => (
      <View>
        {data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) => <View key={index}>{renderItem({ item, index })}</View>)}
      </View>
    ),
  };
});

jest.mock('expo-router/react-navigation', () => {
  const ReactModule = require('react');
  return { HeaderHeightContext: ReactModule.createContext(0) };
});

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      border: '#333',
      primary: '#1D9BF0',
      red: '#e91429',
    },
  }),
}));

jest.mock('../../components/GradientBackground', () => {
  const { View } = require('react-native');
  return {
    GradientBackground: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});
jest.mock('../../components/BottomChrome', () => ({ BottomChrome: () => null }));
jest.mock('../../components/BottomSheet', () => {
  const { View } = require('react-native');
  return {
    BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="lyrics-sheet">{children}</View> : null,
  };
});

interface StubAction {
  icon: string;
  label?: string;
  onPress: () => void;
}
jest.mock('../../components/SwipeableRow', () => {
  const { Pressable, View } = require('react-native');
  return {
    SwipeableRow: ({
      children,
      rightActions = [],
      leftActions = [],
      onPress,
    }: {
      children: React.ReactNode;
      rightActions?: StubAction[];
      leftActions?: StubAction[];
      onPress?: () => void;
    }) => (
      <View>
        <Pressable testID="row-body" onPress={onPress}>
          {children}
        </Pressable>
        {[...rightActions, ...leftActions].map((action) => (
          <Pressable key={action.icon} testID={`action-${action.icon}`} onPress={action.onPress} />
        ))}
      </View>
    ),
    closeOpenRow: jest.fn(),
  };
});

jest.mock('../../store/persistence/lyricsTable', () => ({
  __esModule: true,
  listCachedLyrics: jest.fn(),
  loadLyrics: jest.fn(),
  saveLyrics: jest.fn(),
  deleteLyrics: jest.fn(),
  clearAllLyrics: jest.fn(),
}));
jest.mock('../../services/subsonicService', () => ({
  __esModule: true,
  getLyricsForTrack: jest.fn(),
}));

let mockOfflineMode = false;
jest.mock('../../store/offlineModeStore', () => ({
  offlineModeStore: Object.assign(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode: mockOfflineMode }),
    { getState: () => ({ offlineMode: mockOfflineMode }) },
  ),
}));

jest.mock('../../store/processingOverlayStore', () => ({
  // Same contract as the real helper: the task's value, or undefined when it throws.
  runWithOverlay: async (task: () => Promise<unknown>) => {
    try {
      return await task();
    } catch {
      return undefined;
    }
  },
}));

import { getLyricsForTrack, type LyricsData } from '../../services/subsonicService';
import {
  deleteLyrics,
  listCachedLyrics,
  loadLyrics,
  saveLyrics,
  type CachedLyricsEntry,
} from '../../store/persistence/lyricsTable';
import { lyricsStore } from '../../store/lyricsStore';
import { LyricsBrowserScreen } from '../lyrics-browser';

const mockList = listCachedLyrics as jest.MockedFunction<typeof listCachedLyrics>;
const mockLoad = loadLyrics as jest.MockedFunction<typeof loadLyrics>;
const mockSave = saveLyrics as jest.MockedFunction<typeof saveLyrics>;
const mockDelete = deleteLyrics as jest.MockedFunction<typeof deleteLyrics>;
const mockGetLyrics = getLyricsForTrack as jest.MockedFunction<typeof getLyricsForTrack>;

const syncedEntry: CachedLyricsEntry = {
  songId: 's1',
  title: 'Zebra',
  artist: 'Artist Z',
  synced: true,
};
const plainEntry: CachedLyricsEntry = {
  songId: 's2',
  title: 'Apple',
  artist: 'Artist A',
  synced: false,
};

const storedLyrics: LyricsData = {
  synced: true,
  lines: [
    { startMs: 0, text: 'first line' },
    { startMs: 1500, text: 'second line' },
  ],
  offsetMs: 0,
  source: 'structured',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOfflineMode = false;
  mockList.mockResolvedValue([syncedEntry, plainEntry]);
  mockLoad.mockResolvedValue(storedLyrics);
  mockSave.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  lyricsStore.setState({ entries: {}, loading: {}, errors: {}, revision: 0 });
});

describe('LyricsBrowserScreen — listing', () => {
  it('lists every cached song with its synced state, collated by name', async () => {
    const { findByText, getAllByTestId } = render(<LyricsBrowserScreen />);

    expect(await findByText('Zebra')).toBeTruthy();
    expect(await findByText('Apple')).toBeTruthy();
    expect(await findByText('Artist A')).toBeTruthy();
    expect(await findByText('Synced lyrics')).toBeTruthy();
    expect(await findByText('Unsynced lyrics')).toBeTruthy();
    // defaultCollator, so "Apple" sorts before "Zebra".
    expect(getAllByTestId('icon-document-text-outline').length).toBe(1);
    expect(getAllByTestId('icon-time-outline').length).toBe(1);
  });

  it('falls back to the song id when the row has no captured title', async () => {
    mockList.mockResolvedValue([{ songId: 'id-only', title: null, artist: null, synced: false }]);

    const { findByText } = render(<LyricsBrowserScreen />);

    expect(await findByText('id-only')).toBeTruthy();
  });

  it('renders the empty state when nothing is cached', async () => {
    mockList.mockResolvedValue([]);

    const { findByText } = render(<LyricsBrowserScreen />);

    expect(await findByText('No cached lyrics')).toBeTruthy();
  });
});

describe('LyricsBrowserScreen — tapping a row', () => {
  it('opens the sheet with the stored lines rendered statically', async () => {
    const { findAllByTestId, findByTestId, findByText, queryByTestId } = render(
      <LyricsBrowserScreen />,
    );
    expect(queryByTestId('lyrics-sheet')).toBeNull();

    const rows = await findAllByTestId('row-body');
    // "Apple" sorts first, so index 1 is the SYNCED entry — the one a player-style
    // view would try to highlight against an unrelated playback position.
    fireEvent.press(rows[1]);

    expect(await findByTestId('lyrics-sheet')).toBeTruthy();
    expect(mockLoad).toHaveBeenCalledWith('s1');
    expect(await findByText('first line')).toBeTruthy();
    expect(await findByText('second line')).toBeTruthy();
  });

  it('says so when the row turns out to have no lines', async () => {
    mockLoad.mockResolvedValue(null);
    const { findAllByTestId, findByText } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('row-body'))[0]);

    expect(await findByText('No lyrics available for this track.')).toBeTruthy();
  });
});

describe('LyricsBrowserScreen — swipe left→right: delete', () => {
  it('removes the row and deletes it from the table', async () => {
    const { findAllByTestId, queryByText } = render(<LyricsBrowserScreen />);

    const deletes = await findAllByTestId('action-trash-outline');
    fireEvent.press(deletes[0]); // "Apple"

    expect(queryByText('Apple')).toBeNull();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('s2'));
    expect(queryByText('Zebra')).toBeTruthy();
  });

  it('drops the deleted track from the session cache too', async () => {
    lyricsStore.setState({ entries: { s2: storedLyrics } });
    const { findAllByTestId } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('action-trash-outline'))[0]);

    await waitFor(() => expect(lyricsStore.getState().entries['s2']).toBeUndefined());
  });
});

describe('LyricsBrowserScreen — swipe right→left: refresh', () => {
  it('refetches from the server by artist + title and overwrites the row', async () => {
    mockGetLyrics.mockResolvedValue({ ...storedLyrics, synced: false, source: 'classic' });
    const { findAllByTestId, findByText } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('action-refresh-outline'))[0]); // "Apple"

    await waitFor(() => expect(mockGetLyrics).toHaveBeenCalledWith('s2', 'Artist A', 'Apple'));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        's2',
        expect.objectContaining({ source: 'classic' }),
        'Apple',
        'Artist A',
      ),
    );
    expect(await findByText('Apple')).toBeTruthy();
  });

  it('flips the row indicator when the server copy is now synced', async () => {
    mockGetLyrics.mockResolvedValue(storedLyrics);
    const { findAllByTestId, findAllByText } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('action-refresh-outline'))[0]); // "Apple", unsynced

    await waitFor(async () => expect(await findAllByText('Synced lyrics')).toHaveLength(2));
  });

  it('ignores a server that returns no lyrics and leaves the row as it was', async () => {
    mockGetLyrics.mockResolvedValue(null);
    const { findAllByTestId, findByText } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('action-refresh-outline'))[0]);

    await waitFor(() => expect(mockGetLyrics).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
    expect(await findByText('Unsynced lyrics')).toBeTruthy();
  });

  it('is not offered at all offline, while delete still is', async () => {
    mockOfflineMode = true;
    const { findAllByTestId, queryAllByTestId } = render(<LyricsBrowserScreen />);

    // Delete is local, so it survives offline — and awaiting it proves the rows rendered.
    expect(await findAllByTestId('action-trash-outline')).toHaveLength(2);
    // Refresh needs the server; the whole side is withdrawn rather than silently ignored.
    expect(queryAllByTestId('action-refresh-outline')).toHaveLength(0);
  });

  it('deletes offline without reaching the server', async () => {
    mockOfflineMode = true;
    const { findAllByTestId } = render(<LyricsBrowserScreen />);

    fireEvent.press((await findAllByTestId('action-trash-outline'))[0]);

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('s2'));
    expect(mockGetLyrics).not.toHaveBeenCalled();
  });
});
