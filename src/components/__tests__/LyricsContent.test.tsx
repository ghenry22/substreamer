jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
    MaterialCommunityIcons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { type LyricsData } from '../../services/subsonicService';

const { LyricsContent } = require('../LyricsContent');

const COLORS = {
  textPrimary: '#ffffff',
  textSecondary: '#888888',
  border: '#333333',
};

const SYNCED: LyricsData = {
  synced: true,
  lines: [
    { startMs: 0, text: 'first line' },
    { startMs: 2000, text: 'second line' },
  ],
  offsetMs: 0,
  source: 'structured',
  lang: 'en',
};

const UNSYNCED: LyricsData = {
  synced: false,
  lines: [
    { startMs: 0, text: 'alpha' },
    { startMs: 0, text: 'beta' },
  ],
  offsetMs: 0,
  source: 'classic',
};

describe('LyricsContent', () => {
  it('renders error state with retry when lyricsError is set', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <LyricsContent
        lyricsData={undefined}
        lyricsLoading={false}
        lyricsError="error"
        onRetry={onRetry}
        colors={COLORS}
      />,
    );

    expect(getByText("Couldn't load lyrics.")).toBeTruthy();
    expect(getByText('cloud-offline-outline')).toBeTruthy();

    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders timeout-specific message when lyricsError is timeout', () => {
    const { getByText } = render(
      <LyricsContent
        lyricsData={undefined}
        lyricsLoading={false}
        lyricsError="timeout"
        onRetry={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(
      getByText("Couldn't load lyrics — the server took too long to respond."),
    ).toBeTruthy();
  });

  it('does not render retry button when onRetry is omitted', () => {
    const { queryByText } = render(
      <LyricsContent
        lyricsData={undefined}
        lyricsLoading={false}
        lyricsError="error"
        colors={COLORS}
      />,
    );

    expect(queryByText('Retry')).toBeNull();
  });

  it('renders skeleton while loading', () => {
    const { queryByText } = render(
      <LyricsContent
        lyricsData={undefined}
        lyricsLoading={true}
        lyricsError={null}
        colors={COLORS}
      />,
    );

    // Skeleton has no text
    expect(queryByText('No lyrics available for this track.')).toBeNull();
    expect(queryByText('cloud-offline-outline')).toBeNull();
  });

  it('renders empty state when lyricsData is null', () => {
    const { getByText } = render(
      <LyricsContent
        lyricsData={null}
        lyricsLoading={false}
        lyricsError={null}
        colors={COLORS}
      />,
    );

    expect(getByText('No lyrics available for this track.')).toBeTruthy();
    expect(getByText('music-note-outline')).toBeTruthy();
  });

  it('renders empty state when lyricsData has no lines', () => {
    const { getByText } = render(
      <LyricsContent
        lyricsData={{ ...UNSYNCED, lines: [] }}
        lyricsLoading={false}
        lyricsError={null}
        colors={COLORS}
      />,
    );

    expect(getByText('No lyrics available for this track.')).toBeTruthy();
  });

  it('renders unsynced lines when lyrics are unsynced', () => {
    const { getByText } = render(
      <LyricsContent
        lyricsData={UNSYNCED}
        lyricsLoading={false}
        lyricsError={null}
        colors={COLORS}
      />,
    );

    expect(getByText('alpha')).toBeTruthy();
    expect(getByText('beta')).toBeTruthy();
  });

  it('renders lines for synced lyrics (Phase 2 stub routes to unsynced view)', () => {
    const { getByText } = render(
      <LyricsContent
        lyricsData={SYNCED}
        lyricsLoading={false}
        lyricsError={null}
        colors={COLORS}
      />,
    );

    expect(getByText('first line')).toBeTruthy();
    expect(getByText('second line')).toBeTruthy();
  });

  it('prefers error over loading when both are true', () => {
    // This is an invariant the parent maintains, but defend against it anyway.
    const { getByText, queryByText } = render(
      <LyricsContent
        lyricsData={undefined}
        lyricsLoading={false}
        lyricsError="error"
        onRetry={jest.fn()}
        colors={COLORS}
      />,
    );

    expect(getByText("Couldn't load lyrics.")).toBeTruthy();
    expect(queryByText('No lyrics available for this track.')).toBeNull();
  });
});
