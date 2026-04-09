jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

jest.mock('../../utils/genreHelpers', () => ({
  getGenreNames: jest.fn(() => []),
}));

jest.mock('../../utils/effectiveFormat', () => ({
  getEffectiveFormat: jest.fn(() => null),
}));

jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View, Path: View };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
    MaterialCommunityIcons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { getEffectiveFormat } from '../../utils/effectiveFormat';
import { getGenreNames } from '../../utils/genreHelpers';
import { type Child } from '../../services/subsonicService';

// Must import after mocks
const { AlbumInfoContent } = require('../AlbumInfoContent');

jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

const COLORS = {
  textPrimary: '#ffffff',
  textSecondary: '#888888',
  primary: '#ff6600',
  card: '#1e1e1e',
  label: '#aaaaaa',
  border: '#333333',
};

const MOCK_TRACK = {
  id: 'track-1',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  albumId: 'album-1',
  coverArt: 'cover-1',
  year: 2024,
  suffix: 'flac',
  bitRate: 1411,
  playCount: 42,
} as Child;

describe('AlbumInfoContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getGenreNames as jest.Mock).mockReturnValue([]);
    (getEffectiveFormat as jest.Mock).mockReturnValue(null);
  });

  it('renders track metadata rows', () => {
    const { getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    // Credits section
    expect(getByText('Album')).toBeTruthy();
    expect(getByText('Test Album')).toBeTruthy();
    expect(getByText('Artist')).toBeTruthy();
    expect(getByText('Test Artist')).toBeTruthy();
    // Quick stats section
    expect(getByText('Year')).toBeTruthy();
    expect(getByText('2024')).toBeTruthy();
    expect(getByText('Play Count')).toBeTruthy();
    expect(getByText('42')).toBeTruthy();
  });

  it('renders genre row when genres are available', () => {
    (getGenreNames as jest.Mock).mockReturnValue(['Rock', 'Alternative']);

    const { getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('Genres')).toBeTruthy();
    // Genres are rendered as individual pills, not comma-separated
    expect(getByText('Rock')).toBeTruthy();
    expect(getByText('Alternative')).toBeTruthy();
  });

  it('renders singular Genre label for single genre', () => {
    (getGenreNames as jest.Mock).mockReturnValue(['Jazz']);

    const { getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('Genre')).toBeTruthy();
  });

  it('renders skeleton loading state', () => {
    const { queryByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={true}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    // Metadata rows should not be rendered during loading
    expect(queryByText('Album')).toBeNull();
    expect(queryByText('Test Album')).toBeNull();
  });

  it('renders album description notes', () => {
    const { getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes="This is a great album about testing."
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('This is a great album about testing.')).toBeTruthy();
  });

  it('renders external links when albumInfo has URLs', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={{ lastFmUrl: 'https://last.fm/test', musicBrainzId: 'mb-123' }}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl="https://en.wikipedia.org/wiki/Test"
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByLabelText('View on Last.fm')).toBeTruthy();
    expect(getByLabelText('View on MusicBrainz')).toBeTruthy();
    expect(getByLabelText('View on Wikipedia')).toBeTruthy();
  });

  it('opens Last.fm URL when link is pressed', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={{ lastFmUrl: 'https://last.fm/test' }}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    fireEvent.press(getByLabelText('View on Last.fm'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://last.fm/test');
  });

  it('opens MusicBrainz URL with release ID when no override', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={{ musicBrainzId: 'mb-release-123' }}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    fireEvent.press(getByLabelText('View on MusicBrainz'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://musicbrainz.org/release/mb-release-123');
  });

  it('opens MusicBrainz URL with release-group ID when override MBID is set', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={{ musicBrainzId: 'mb-release-123' }}
        overrideMbid="rg-override-456"
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    fireEvent.press(getByLabelText('View on MusicBrainz'));
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://musicbrainz.org/release-group/rg-override-456',
    );
  });

  it('does not render external links when none available', () => {
    const { queryByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(queryByLabelText('View on Last.fm')).toBeNull();
    expect(queryByLabelText('View on MusicBrainz')).toBeNull();
    expect(queryByLabelText('View on Wikipedia')).toBeNull();
  });

  it('renders FormatBadge when effective format is available', () => {
    (getEffectiveFormat as jest.Mock).mockReturnValue({
      suffix: 'flac',
      bitRate: 1411,
      capturedAt: Date.now(),
    });

    const { getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('FLAC \u00B7 1411 kbps')).toBeTruthy();
  });

  it('does not render FormatBadge when no effective format', () => {
    (getEffectiveFormat as jest.Mock).mockReturnValue(null);

    const { queryByText } = render(
      <AlbumInfoContent
        track={{ ...MOCK_TRACK, suffix: undefined, bitRate: undefined } as Child}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(queryByText('FLAC')).toBeNull();
  });

  it('does not render play count when zero', () => {
    const trackNoPlays = { ...MOCK_TRACK, playCount: 0 } as Child;

    const { queryByText } = render(
      <AlbumInfoContent
        track={trackNoPlays}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(queryByText('Play Count')).toBeNull();
  });

  it('renders skeleton during refresh', () => {
    const { queryByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={true}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    // Skeleton should show, metadata should not
    expect(queryByText('Test Album')).toBeNull();
  });

  it('renders displayAlbumArtist when different from artist', () => {
    const trackWithAlbumArtist = {
      ...MOCK_TRACK,
      displayAlbumArtist: 'Various Artists',
    } as Child;

    const { getByText } = render(
      <AlbumInfoContent
        track={trackWithAlbumArtist}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('Album Artist')).toBeTruthy();
    expect(getByText('Various Artists')).toBeTruthy();
  });

  it('does not render album artist row when same as artist', () => {
    const trackSameArtist = {
      ...MOCK_TRACK,
      displayAlbumArtist: 'Test Artist',
    } as Child;

    const { queryByText } = render(
      <AlbumInfoContent
        track={trackSameArtist}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(queryByText('Album Artist')).toBeNull();
  });

  it('renders Wikipedia attribution when notes come from enrichment', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes="Wikipedia description of the album."
        notesAttributionUrl="https://en.wikipedia.org/wiki/Test_Album"
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByLabelText('Source: Wikipedia')).toBeTruthy();
  });

  it('opens Wikipedia URL when attribution pressed', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes="Wikipedia description."
        notesAttributionUrl="https://en.wikipedia.org/wiki/Test"
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    fireEvent.press(getByLabelText('Source: Wikipedia'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/Test');
  });

  it('opens Wikipedia link chip', () => {
    const { getByLabelText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl="https://en.wikipedia.org/wiki/Test"
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    fireEvent.press(getByLabelText('View on Wikipedia'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/Test');
  });

  it('resets notes state when sanitizedNotes changes between renders', () => {
    const { rerender, getByText } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes="First album description."
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('First album description.')).toBeTruthy();

    // Re-render with different notes (simulating album change)
    rerender(
      <AlbumInfoContent
        track={{ ...MOCK_TRACK, id: 'track-2', album: 'Other Album' } as Child}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes="Second album description."
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('Second album description.')).toBeTruthy();
  });

  it('renders BPM row when track has bpm', () => {
    const trackWithBpm = { ...MOCK_TRACK, bpm: 120 } as Child;

    const { getByText } = render(
      <AlbumInfoContent
        track={trackWithBpm}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('BPM')).toBeTruthy();
    expect(getByText('120')).toBeTruthy();
  });

  it('triggers onTextLayout and handles truncation/show more', () => {
    const { getByText, rerender } = render(
      <AlbumInfoContent
        track={MOCK_TRACK}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={"A".repeat(2000)}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    // The notes text should be rendered
    const longText = "A".repeat(2000);
    const notesText = getByText(longText);
    expect(notesText).toBeTruthy();

    // Simulate onTextLayout with > 15 lines to trigger truncation
    fireEvent(notesText, 'textLayout', {
      nativeEvent: {
        lines: Array(20).fill({ text: 'line' }),
      },
    });

    // After truncation is detected, "Show more" should appear
    const showMore = getByText('Show more');
    expect(showMore).toBeTruthy();

    // Press "Show more" to expand
    fireEvent.press(showMore);
    expect(getByText('Show less')).toBeTruthy();

    // Press "Show less" to collapse
    fireEvent.press(getByText('Show less'));
    expect(getByText('Show more')).toBeTruthy();
  });

  it('renders composer row when displayComposer is set', () => {
    const trackWithComposer = { ...MOCK_TRACK, displayComposer: 'J.S. Bach' } as Child;

    const { getByText } = render(
      <AlbumInfoContent
        track={trackWithComposer}
        albumInfo={null}
        overrideMbid={null}
        sanitizedNotes={null}
        notesAttributionUrl={null}
        albumInfoLoading={false}
        refreshing={false}
        onRefresh={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText('Composer')).toBeTruthy();
    expect(getByText('J.S. Bach')).toBeTruthy();
  });
});
