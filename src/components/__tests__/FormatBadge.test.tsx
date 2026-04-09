jest.mock('../../store/sqliteStorage', () => require('../../store/__mocks__/sqliteStorage'));

jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: View,
    Path: View,
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';

import { FormatBadge } from '../FormatBadge';
import { type EffectiveFormat } from '../../types/audio';

const makeFmt = (overrides: Partial<EffectiveFormat>): EffectiveFormat => ({
  suffix: 'mp3',
  capturedAt: Date.now(),
  ...overrides,
});

describe('FormatBadge', () => {
  it('renders format details text', () => {
    const { getByText } = render(
      <FormatBadge format={makeFmt({ suffix: 'flac', bitDepth: 24, samplingRate: 96000 })} />,
    );
    expect(getByText('FLAC \u00B7 24-bit/96kHz')).toBeTruthy();
  });

  it('renders HR pill for hi-res content', () => {
    const { getByText } = render(
      <FormatBadge format={makeFmt({ suffix: 'flac', bitDepth: 24, samplingRate: 96000 })} />,
    );
    expect(getByText('HR')).toBeTruthy();
  });

  it('does not render HR pill for standard lossless', () => {
    const { queryByText } = render(
      <FormatBadge format={makeFmt({ suffix: 'flac', bitDepth: 16, samplingRate: 44100 })} />,
    );
    expect(queryByText('HR')).toBeNull();
  });

  it('renders lossy format with bitrate', () => {
    const { getByText } = render(
      <FormatBadge format={makeFmt({ suffix: 'mp3', bitRate: 320 })} />,
    );
    expect(getByText('MP3 \u00B7 320 kbps')).toBeTruthy();
  });

  it('renders suffix-only when no additional info', () => {
    const { getByText } = render(
      <FormatBadge format={makeFmt({ suffix: 'opus' })} />,
    );
    expect(getByText('OPUS')).toBeTruthy();
  });
});
