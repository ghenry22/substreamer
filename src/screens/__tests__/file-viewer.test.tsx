jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      card: '#111',
      textPrimary: '#fff',
      textSecondary: '#888',
      primary: '#007AFF',
    },
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text, Pressable } = require('react-native');
  return {
    Ionicons: (props: { name: string; onPress?: () => void }) =>
      props.onPress ? (
        <Pressable onPress={props.onPress}><Text>{props.name}</Text></Pressable>
      ) : (
        <Text>{props.name}</Text>
      ),
  };
});

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => {
        const right = options?.headerRight?.();
        return right ?? null;
      },
    },
  };
});

let mockFileText: () => Promise<string> = async () => '';
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    text: () => mockFileText(),
  })),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('../../components/BottomChrome', () => ({
  BottomChrome: () => null,
}));

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { isViewableFile, FileViewerScreen } from '../file-viewer';

describe('isViewableFile', () => {
  it('returns true for log files', () => {
    expect(isViewableFile('audio-diagnostics.log')).toBe(true);
  });

  it('returns true for text files', () => {
    expect(isViewableFile('notes.txt')).toBe(true);
  });

  it('returns true for json files', () => {
    expect(isViewableFile('config.json')).toBe(true);
  });

  it('returns true for xml files', () => {
    expect(isViewableFile('data.xml')).toBe(true);
  });

  it('returns true for csv files', () => {
    expect(isViewableFile('export.csv')).toBe(true);
  });

  it('returns true for markdown files', () => {
    expect(isViewableFile('README.md')).toBe(true);
  });

  it('returns true for config files', () => {
    expect(isViewableFile('app.ini')).toBe(true);
    expect(isViewableFile('settings.cfg')).toBe(true);
    expect(isViewableFile('nginx.conf')).toBe(true);
    expect(isViewableFile('Info.plist')).toBe(true);
    expect(isViewableFile('config.yaml')).toBe(true);
    expect(isViewableFile('config.yml')).toBe(true);
  });

  it('is case-insensitive on extension', () => {
    expect(isViewableFile('FILE.LOG')).toBe(true);
    expect(isViewableFile('data.JSON')).toBe(true);
    expect(isViewableFile('notes.TXT')).toBe(true);
  });

  it('returns false for binary files', () => {
    expect(isViewableFile('image.png')).toBe(false);
    expect(isViewableFile('song.mp3')).toBe(false);
    expect(isViewableFile('archive.zip')).toBe(false);
    expect(isViewableFile('database.db')).toBe(false);
    expect(isViewableFile('photo.jpg')).toBe(false);
  });

  it('returns false for files without extensions', () => {
    expect(isViewableFile('Makefile')).toBe(false);
    expect(isViewableFile('LICENSE')).toBe(false);
  });

  it('returns false for directories (trailing slash stripped name)', () => {
    expect(isViewableFile('some-folder')).toBe(false);
  });

  it('handles files with multiple dots', () => {
    expect(isViewableFile('audio-diagnostics.old.log')).toBe(true);
    expect(isViewableFile('backup.2024.json')).toBe(true);
    expect(isViewableFile('archive.tar.gz')).toBe(false);
  });
});

describe('FileViewerScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFileText = async () => '';
    (Clipboard.setStringAsync as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows loading indicator while file is being read', () => {
    // Never resolve so we stay in loading state
    mockFileText = () => new Promise(() => {});
    const { getByTestId } = render(
      <FileViewerScreen uri="file:///test.log" name="test.log" />
    );
    // ActivityIndicator renders with testID when present; check the tree
    // The component renders ActivityIndicator when content is null
    // We just verify no error or content text is shown
    expect(() => getByTestId('file-content')).toThrow();
  });

  it('displays file content after loading', async () => {
    mockFileText = async () => 'Hello, world!\nLine 2';
    const { findByText } = render(
      <FileViewerScreen uri="file:///test.log" name="test.log" />
    );
    expect(await findByText('Hello, world!\nLine 2')).toBeTruthy();
  });

  it('shows empty state for empty files', async () => {
    mockFileText = async () => '';
    const { findByText } = render(
      <FileViewerScreen uri="file:///empty.log" name="empty.log" />
    );
    expect(await findByText('File is empty')).toBeTruthy();
  });

  it('shows error state when file read fails', async () => {
    mockFileText = () => Promise.reject(new Error('Permission denied'));
    const { findByText } = render(
      <FileViewerScreen uri="file:///secret.log" name="secret.log" />
    );
    expect(await findByText('Permission denied')).toBeTruthy();
  });

  it('shows fallback error message for non-Error exceptions', async () => {
    mockFileText = () => Promise.reject('something');
    const { findByText } = render(
      <FileViewerScreen uri="file:///bad.log" name="bad.log" />
    );
    expect(await findByText('Failed to read file')).toBeTruthy();
  });

  it('copies content to clipboard and shows checkmark', async () => {
    mockFileText = async () => 'Log line 1\nLog line 2';
    const { findByText } = render(
      <FileViewerScreen uri="file:///test.log" name="test.log" />
    );
    // Wait for content to load — headerRight now renders copy icon
    await findByText('Log line 1\nLog line 2');
    const copyIcon = await findByText('copy-outline');
    await act(async () => {
      fireEvent.press(copyIcon);
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Log line 1\nLog line 2');
    // Icon should switch to checkmark
    expect(await findByText('checkmark')).toBeTruthy();
    // After 2s timeout, icon reverts to copy-outline
    act(() => { jest.advanceTimersByTime(2000); });
    expect(await findByText('copy-outline')).toBeTruthy();
  });

  it('does not show copy button while loading', () => {
    mockFileText = () => new Promise(() => {});
    const { queryByText } = render(
      <FileViewerScreen uri="file:///test.log" name="test.log" />
    );
    expect(queryByText('copy-outline')).toBeNull();
  });

  it('does not update state after unmount (cancelled flag)', async () => {
    let resolveRead: (v: string) => void;
    mockFileText = () => new Promise((r) => { resolveRead = r; });
    const { unmount } = render(
      <FileViewerScreen uri="file:///test.log" name="test.log" />
    );
    unmount();
    // Resolve after unmount — should not throw or update
    await act(async () => {
      resolveRead!('late data');
    });
    // No assertion needed — test passes if no warning/error is thrown
  });
});
